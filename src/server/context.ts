import { and, eq, gt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { factories, memberships, sessions, users, type Role } from "@/db/schema";
import { AppError, forbidden } from "./errors";
import { assertCan, type Permission } from "./permissions";
import { hashToken } from "./auth/password";

export type FactoryRow = typeof factories.$inferSelect;

export interface Actor {
  userId: string;
  name: string;
  email: string;
  role: Role;
  factory: FactoryRow;
  memberships: { factoryId: string; factoryName: string; role: Role; isSimulation: boolean }[];
  /** The account was created or reset with a one-time password that must be changed. */
  mustChangePassword?: boolean;
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export async function sessionFromToken(db: DB, token: string | undefined | null) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, Date.now()), eq(users.disabled, false)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Build the actor for a user in a factory. The factory must be one the user is a
 * member of; otherwise the first membership is used. This is the tenant boundary:
 * every service receives an Actor and only ever touches actor.factory.id.
 */
export async function resolveActor(db: DB, userId: string, preferredFactoryId?: string | null): Promise<Actor> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.disabled) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  const rows = await db
    .select({ m: memberships, f: factories })
    .from(memberships)
    .innerJoin(factories, eq(factories.id, memberships.factoryId))
    .where(eq(memberships.userId, userId))
    .orderBy(factories.name);
  if (rows.length === 0) throw forbidden("Your account is not a member of any factory.");
  const chosen = rows.find((r) => r.f.id === preferredFactoryId) ?? rows[0];
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: chosen.m.role,
    factory: chosen.f,
    memberships: rows.map((r) => ({ factoryId: r.f.id, factoryName: r.f.name, role: r.m.role, isSimulation: r.f.isSimulation })),
    mustChangePassword: user.mustChangePassword,
  };
}

/** Strict variant for tests and APIs: the user must belong to exactly this factory. */
export async function actorForFactory(db: DB, userId: string, factoryId: string): Promise<Actor> {
  const actor = await resolveActor(db, userId, factoryId);
  if (actor.factory.id !== factoryId) throw forbidden("You do not have access to this factory.");
  return actor;
}

export function requirePerm(actor: Actor, perm: Permission): void {
  assertCan(actor.role, perm);
}
