import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions } from "@/db/schema";
import { resolveActor, sessionFromToken, SESSION_TTL_MS, type Actor } from "../context";
import { hashToken, newToken } from "./password";

export const SESSION_COOKIE = "energyos_session";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function startSession(userId: string) {
  const token = newToken();
  const db = getDb();
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt: Date.now() + SESSION_TTL_MS });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** The signed-in actor for this request, or null. Memoised per request. */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = getDb();
  const s = await sessionFromToken(db, token);
  if (!s) return null;
  try {
    return await resolveActor(db, s.user.id, s.session.activeFactoryId);
  } catch {
    return null;
  }
});

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect("/login");
  return a;
}

/** Hash (database id) of this request's session, or null. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function setActiveFactory(factoryId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await getDb().update(sessions).set({ activeFactoryId: factoryId }).where(eq(sessions.id, hashToken(token)));
}
