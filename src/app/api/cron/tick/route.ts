import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runTick } from "@/server/services/jobs";

/**
 * Run every periodic job once: analysis queue, audit sealing, meter-offline alerts,
 * clean-up, IEX prices. For an external scheduler (Render cron, GitHub Actions,
 * cron-job.org …) when the server sleeps or runs serverless. Needs CRON_SECRET.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not enabled. Set CRON_SECRET to use this endpoint." }, { status: 404 });
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  const report = await runTick(getDb());
  return NextResponse.json({ ok: true, ...report }, { headers: { "cache-control": "no-store" } });
}

export const POST = handle;
export const GET = handle;
