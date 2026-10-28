import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { memberships, ROLES, sessions, users } from "@/db/schema";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { conflict, forbidden, notFound, validation } from "../errors";
import { hashPassword, verifyPassword } from "../auth/password";
import { newId } from "../ids";

export const MIN_PASSWORD = 10;

export async function listTeam(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  return db
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, disabled: users.disabled, mustChangePassword: users.mustChangePassword })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.factoryId, actor.factory.id))
    .orderBy(users.name);
}

const addSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(200),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  role: z.enum(ROLES),
});

/**
 * Add someone to this factory. A new account gets a one-time password, shown once
 * to the owner and changed by the user at first sign-in. An existing account just
 * gets the membership (their password is untouched).
 */
export async function addMember(db: DB, actor: Actor, raw: unknown): Promise<{ userId: string; tempPassword: string | null }> {
  requirePerm(actor, "team.manage");
  const p = addSchema.safeParse(raw);
  if (!p.success) throw validation(p.error.issues[0]?.message ?? "Invalid member.");
  const { email, name, role } = p.data;
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  let tempPassword: string | null = null;
  const userId = existing?.id ?? newId("usr");
  await db.transaction(async (tx) => {
    if (!existing) {
      tempPassword = randomBytes(9).toString("base64url");
      await tx.insert(users).values({ id: userId, email, name, passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
    } else {
      const m = await tx.query.memberships.findFirst({ where: and(eq(memberships.userId, userId), eq(memberships.factoryId, actor.factory.id)) });
      if (m) throw conflict(`${email} is already a member of this factory.`);
    }
    await tx.insert(memberships).values({ id: newId("mem"), userId, factoryId: actor.factory.id, role });
    await audit(tx, actor, "team.add", "user", userId, { email, role, newAccount: !existing });
  });
  return { userId, tempPassword };
}

async function owners(db: DB, factoryId: string) {
  return db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.factoryId, factoryId), eq(memberships.role, "OWNER"), eq(users.disabled, false)));
}

async function membershipOf(db: DB, actor: Actor, userId: string) {
  const m = await db.query.memberships.findFirst({ where: and(eq(memberships.userId, userId), eq(memberships.factoryId, actor.factory.id)) });
  if (!m) throw notFound("Member");
  return m;
}

async function guardLastOwner(db: DB, actor: Actor, userId: string) {
  const o = await owners(db, actor.factory.id);
  if (o.length === 1 && o[0].userId === userId) throw conflict("A factory needs at least one active owner. Make someone else owner first.");
}

export async function changeRole(db: DB, actor: Actor, userId: string, role: unknown) {
  requirePerm(actor, "team.manage");
  const r = z.enum(ROLES).safeParse(role);
  if (!r.success) throw validation("Unknown role.");
  const m = await membershipOf(db, actor, userId);
  if (m.role === r.data) return;
  if (m.role === "OWNER") await guardLastOwner(db, actor, userId);
  await db.update(memberships).set({ role: r.data }).where(eq(memberships.id, m.id));
  await audit(db, actor, "team.role", "user", userId, { from: m.role, to: r.data });
}

export async function removeMember(db: DB, actor: Actor, userId: string) {
  requirePerm(actor, "team.manage");
  if (userId === actor.userId) throw forbidden("You cannot remove yourself.");
  const m = await membershipOf(db, actor, userId);
  if (m.role === "OWNER") await guardLastOwner(db, actor, userId);
  await db.transaction(async (tx) => {
    await tx.delete(memberships).where(eq(memberships.id, m.id));
    // Sessions pinned to this factory end; others fall back to the user's next factory.
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.activeFactoryId, actor.factory.id)));
    await audit(tx, actor, "team.remove", "user", userId, { role: m.role });
  });
}

/**
 * Disable or re-enable an account. Only for accounts whose every membership is in
 * this factory, so one tenant's owner cannot lock a user out of another tenant.
 */
export async function setDisabled(db: DB, actor: Actor, userId: string, disabled: boolean) {
  requirePerm(actor, "team.manage");
  if (userId === actor.userId) throw forbidden("You cannot disable your own account.");
  const m = await membershipOf(db, actor, userId);
  const elsewhere = await db.query.memberships.findFirst({ where: and(eq(memberships.userId, userId), ne(memberships.factoryId, actor.factory.id)) });
  if (elsewhere) throw forbidden("This person also belongs to another factory. Remove them from this factory instead.");
  if (disabled && m.role === "OWNER") await guardLastOwner(db, actor, userId);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ disabled }).where(eq(users.id, userId));
    if (disabled) await tx.delete(sessions).where(eq(sessions.userId, userId));
    await audit(tx, actor, disabled ? "team.disable" : "team.enable", "user", userId, {});
  });
}

/** Issue a new one-time password for a member (shown once). Ends their sessions. */
export async function resetPassword(db: DB, actor: Actor, userId: string): Promise<string> {
  requirePerm(actor, "team.manage");
  await membershipOf(db, actor, userId);
  const elsewhere = await db.query.memberships.findFirst({ where: and(eq(memberships.userId, userId), ne(memberships.factoryId, actor.factory.id)) });
  if (elsewhere) throw forbidden("This person also belongs to another factory; they can change their own password.");
  const temp = randomBytes(9).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await audit(tx, actor, "team.reset_password", "user", userId, {});
  });
  return temp;
}

const pwSchema = z.object({ current: z.string().min(1, "Enter your current password.").max(200), next: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`).max(200) });

/** Change your own password. Every other session of yours ends. */
export async function changeOwnPassword(db: DB, actor: Actor, raw: unknown, keepSessionId: string | null) {
  const p = pwSchema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw validation(i?.message ?? "Invalid password.", i?.path[0] ? { [String(i.path[0])]: i.message } : undefined);
  }
  const u = await db.query.users.findFirst({ where: eq(users.id, actor.userId) });
  if (!u || !(await verifyPassword(p.data.current, u.passwordHash))) throw validation("Current password is incorrect.", { current: "Incorrect" });
  if (p.data.next === p.data.current) throw validation("Choose a different password.", { next: "Same as current" });
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(p.data.next), mustChangePassword: false, passwordChangedAt: Date.now() }).where(eq(users.id, u.id));
    await tx.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, u.id), ne(sessions.id, keepSessionId)) : eq(sessions.userId, u.id));
    await audit(tx, actor, "auth.password_change", "user", u.id, {});
  });
}

/** End every session of the current user except this one. */
export async function signOutEverywhere(db: DB, actor: Actor, keepSessionId: string | null) {
  const res = await db.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, actor.userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, actor.userId));
  await audit(db, actor, "auth.sign_out_everywhere", "user", actor.userId, { ended: res.rowsAffected });
  return res.rowsAffected;
}
