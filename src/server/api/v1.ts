import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import type { Actor } from "../context";
import { AppError } from "../errors";
import { clientAddress } from "../ratelimit";
import { authenticateApiKey } from "../services/apikeys";
import { hitLimit } from "../services/limits";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 400, NOT_FOUND: 404 };
/** Calls per key per minute. Shared across server instances. */
export const API_RATE_PER_MIN = 600;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function apiError(status: number, message: string, headers: Record<string, string> = {}) {
  return json({ error: message }, status, headers);
}

/**
 * Authenticate an integration request (Authorization: Bearer eosk_…), rate-limit it,
 * and run the handler as a read-only actor of the key's factory.
 */
export async function withApiKey(req: Request, handler: (actor: Actor) => Promise<unknown>) {
  const db = getDb();
  const auth = req.headers.get("authorization");
  const presented = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const key = await authenticateApiKey(db, presented);
  if (!key) {
    await hitLimit(db, `api:fail:${clientAddress(req.headers)}`, 30, 60_000);
    return apiError(401, "Missing, unknown or revoked API key. Create one under Factory settings → Integration API.");
  }
  const lim = await hitLimit(db, `api:key:${key.keyId}`, API_RATE_PER_MIN, 60_000);
  const rl = { "x-ratelimit-limit": String(API_RATE_PER_MIN), "x-ratelimit-remaining": String(Math.max(0, API_RATE_PER_MIN - lim.count)), "x-ratelimit-reset": String(Math.ceil(lim.resetAt / 1000)) };
  if (!lim.ok) return apiError(429, "Rate limit reached. Retry after the reset time.", { ...rl, "retry-after": String(Math.max(1, Math.ceil((lim.resetAt - Date.now()) / 1000))) });
  // Read-only: only read services are called from v1 handlers, and they check "view".
  const actor: Actor = { userId: `apikey:${key.keyId}`, name: "Integration API", email: "", role: "OPERATOR", factory: key.factory, memberships: [] };
  try {
    return json(await handler(actor), 200, rl);
  } catch (e) {
    if (e instanceof AppError) return apiError(STATUS[e.code] ?? 400, e.message, rl);
    console.error("[energyos] api v1 error", e);
    return apiError(500, "Internal error.", rl);
  }
}
