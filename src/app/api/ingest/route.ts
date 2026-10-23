import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { AppError } from "@/server/errors";
import { ingestReadings } from "@/server/services/ingest";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 400, NOT_FOUND: 404 };

/** POST /api/ingest — read-only meter data intake (Bearer meter token). */
export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 512 * 1024) return NextResponse.json({ error: "Body too large (max 512 KB)." }, { status: 413 });
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  try {
    const r = await ingestReadings(getDb(), token, body);
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 400 });
    console.error("[energyos] ingest error", e);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
