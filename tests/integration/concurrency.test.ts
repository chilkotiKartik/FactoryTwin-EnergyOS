import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { heats } from "@/db/schema";
import { createDb } from "@/db/client";
import { audit, sealAuditChain, verifyAuditChain } from "@/server/audit";
import { createHeat } from "@/server/services/heats";
import { freshDb, IDS } from "../helpers/db";

/**
 * Real concurrency: needs a PostgreSQL server (TEST_DATABASE_URL), where several
 * connections and pools write at once. PGlite is one connection in one process,
 * so these are skipped there.
 */
const server = !!process.env.TEST_DATABASE_URL;
let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  if (server) t = await freshDb();
});
afterAll(() => (server ? t.cleanup() : undefined));

describe.skipIf(!server)("concurrent writers (PostgreSQL)", () => {
  it("two tablets logging overlapping heats at the same moment: exactly one is accepted", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    // A second, independent connection pool, as a second server instance would have.
    const other = createDb(t.url);
    const b2 = { ...b };
    const heat = (no: string) => ({ heatNo: no, chargeKg: 450, startAt: "2026-11-10T09:00", tapAt: "2026-11-10T09:50", pouredKg: 440 });
    const results = await Promise.allSettled([createHeat(t.db, b, heat("C-1")), createHeat(other.db, b2, heat("C-2"))]);
    await other.close();
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const rows = await t.db.select().from(heats).where(and(eq(heats.factoryId, IDS.facB), eq(heats.dayDate, "2026-11-10")));
    expect(rows).toHaveLength(1);
  });

  it("the audit chain verifies even when events commit out of id order", async () => {
    const a = await t.actor(IDS.ownerB, IDS.facB);
    // Event A gets the lower id but commits last.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = t.db.transaction(async (tx) => {
      await audit(tx as never, a, "test.slow", "thing", "slow", {});
      await gate;
    });
    await new Promise((r) => setTimeout(r, 100));
    await audit(t.db, a, "test.fast", "thing", "fast", {});
    await sealAuditChain(t.db);
    release();
    await slow;
    await sealAuditChain(t.db);
    const check = await verifyAuditChain(t.db, IDS.facB);
    expect(check.ok).toBe(true);
    expect(check.unsealed).toBe(0);
  });
});
