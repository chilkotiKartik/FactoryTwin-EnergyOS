import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { AppError } from "@/server/errors";
import { clientAddress, createRateLimiter } from "@/server/ratelimit";
import { ingestReadings } from "@/server/services/ingest";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 400, NOT_FOUND: 404 };

const MAX_BODY = 512 * 1024;
const tooLarge = () => NextResponse.json({ error: "Body too large (max 512 KB)." }, { status: 413 });

async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// 120 requests per minute per token (a 1-minute meter needs 1), and 20 failed
// authentications per minute per client address so rotating random tokens is throttled.
const tokenLimit = createRateLimiter(120, 60_000);
const failLimit = createRateLimiter(20, 60_000);

/** POST /api/ingest — read-only meter data intake (Bearer meter token). */
export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return tooLarge();
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const ip = clientAddress(req.headers);
  if (failLimit.blocked(ip) || !tokenLimit.hit(token ?? `ip:${ip}`)) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429, headers: { "retry-after": "60" } });
  }
  // Content-Length can be missing (chunked upload), so the cap is enforced on the stream.
  const text = await readCapped(req, MAX_BODY);
  if (text === null) return tooLarge();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  try {
    const r = await ingestReadings(getDb(), token, body);
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHENTICATED") failLimit.hit(ip);
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 400 });
    console.error("[energyos] ingest error", e);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
