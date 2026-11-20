import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { heats, memberships, users } from "@/db/schema";
import { actorForFactory, resolveActor } from "@/server/context";
import { verifyPassword } from "@/server/auth/password";
import { DUPLICATE_MESSAGE, registerSandbox, registrationEnabled } from "@/server/services/registration";
import { listHeats } from "@/server/services/heats";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

const good = {
  name: "Priya Rao",
  email: "Priya@Example.com",
  password: "long-enough-pass",
  factoryName: "Shree Castings",
};

describe("self-service registration", () => {
  it("creates an owner with a private, seeded simulation factory", async () => {
    const r = await registerSandbox(t.db, good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = await t.db.query.users.findFirst({
      where: eq(users.id, r.userId),
    });
    expect(u?.email).toBe("priya@example.com");
    expect(await verifyPassword(good.password, u!.passwordHash)).toBe(true);
    const actor = await resolveActor(t.db, r.userId);
    expect(actor.role).toBe("OWNER");
    expect(actor.factory.id).toBe(r.factoryId);
    expect(actor.factory.isSimulation).toBe(true);
    expect(actor.memberships).toHaveLength(1);
    const own = await t.db.select().from(heats).where(eq(heats.factoryId, r.factoryId));
    expect(own.length).toBeGreaterThan(300);
    expect(own.every((h) => h.provenance === "SIMULATED")).toBe(true);
  });

  it("is isolated from the shared demo factories in both directions", async () => {
    const u = await t.db.query.users.findFirst({
      where: eq(users.email, "priya@example.com"),
    });
    const mine = await t.db.select().from(memberships).where(eq(memberships.userId, u!.id));
    await expect(actorForFactory(t.db, u!.id, IDS.facA)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(actorForFactory(t.db, IDS.ownerA, mine[0].factoryId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const a = await t.actor(IDS.supervisorA);
    const list = await listHeats(t.db, a, { pageSize: 100 });
    const sandboxIds = new Set((await t.db.select({ id: heats.id }).from(heats).where(eq(heats.factoryId, mine[0].factoryId))).map((h) => h.id));
    expect(list.rows.length).toBeGreaterThan(0);
    expect(list.rows.some((h) => sandboxIds.has(h.id))).toBe(false);
  });

  it("rejects a duplicate email with a message that does not confirm the account exists", async () => {
    const r = await registerSandbox(t.db, {
      ...good,
      email: "priya@example.com",
    });
    expect(r).toEqual({
      ok: false,
      field: "email",
      message: DUPLICATE_MESSAGE,
    });
    const demo = await registerSandbox(t.db, {
      ...good,
      email: "owner@foundry-a.test",
    });
    expect(demo.ok).toBe(false);
  });

  it("validates input", async () => {
    expect(
      await registerSandbox(t.db, {
        ...good,
        email: "a@b.co",
        password: "short",
      }),
    ).toMatchObject({ ok: false, field: "password" });
    expect(await registerSandbox(t.db, { ...good, email: "not-an-email" })).toMatchObject({ ok: false, field: "email" });
    expect(
      await registerSandbox(t.db, {
        ...good,
        email: "x@y.co",
        factoryName: " ",
      }),
    ).toMatchObject({ ok: false, field: "factoryName" });
  });

  it("can be turned off with ALLOW_REGISTRATION=false", () => {
    expect(registrationEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(
      registrationEnabled({
        ALLOW_REGISTRATION: "false",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
