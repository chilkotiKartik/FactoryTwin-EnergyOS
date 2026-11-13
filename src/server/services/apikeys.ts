import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { apiKeys, factories } from "@/db/schema";
import type { Actor, FactoryRow } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { notFound, validation } from "../errors";
import { newId } from "../ids";
import { hashToken, newToken } from "../auth/password";

export const API_KEY_PREFIX = "eosk_";
const MAX_KEYS = 20;

export async function listApiKeys(db: DB, actor: Actor) {
  requirePerm(actor, "factory.configure");
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.factoryId, actor.factory.id))
    .orderBy(desc(apiKeys.createdAt));
}

const nameSchema = z.string().trim().min(2, "Give the key a name, e.g. the system that will use it.").max(60);

/** Create a read-only key for this factory. The plain key is returned once and never stored. */
export async function createApiKey(db: DB, actor: Actor, rawName: unknown): Promise<{ id: string; key: string }> {
  requirePerm(actor, "factory.configure");
  const parsed = nameSchema.safeParse(rawName);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Invalid name.");
  const active = await db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.factoryId, actor.factory.id), isNull(apiKeys.revokedAt)));
  if (active.length >= MAX_KEYS) throw validation(`At most ${MAX_KEYS} active keys per factory. Revoke one first.`);
  const key = `${API_KEY_PREFIX}${newToken()}`;
  const id = newId("key");
  await db.insert(apiKeys).values({ id, factoryId: actor.factory.id, name: parsed.data, tokenHash: hashToken(key), prefix: key.slice(0, 12), createdBy: actor.userId });
  await audit(db, actor, "api_key.create", "api_key", id, { name: parsed.data, prefix: key.slice(0, 12) });
  return { id, key };
}

export async function revokeApiKey(db: DB, actor: Actor, id: string) {
  requirePerm(actor, "factory.configure");
  const row = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, id), eq(apiKeys.factoryId, actor.factory.id)) });
  if (!row) throw notFound("API key");
  if (row.revokedAt) return;
  await db.update(apiKeys).set({ revokedAt: Date.now() }).where(eq(apiKeys.id, id));
  await audit(db, actor, "api_key.revoke", "api_key", id, { name: row.name });
}

/** Resolve a presented key to its factory. Null for unknown, malformed or revoked keys. */
export async function authenticateApiKey(db: DB, presented: string | null): Promise<{ keyId: string; factory: FactoryRow } | null> {
  if (!presented || !presented.startsWith(API_KEY_PREFIX) || presented.length > 120) return null;
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.tokenHash, hashToken(presented)) });
  if (!row || row.revokedAt) return null;
  const factory = await db.query.factories.findFirst({ where: eq(factories.id, row.factoryId) });
  if (!factory) return null;
  const now = Date.now();
  // Record use at most once a minute, so a busy integration does not write on every call.
  if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  return { keyId: row.id, factory };
}
