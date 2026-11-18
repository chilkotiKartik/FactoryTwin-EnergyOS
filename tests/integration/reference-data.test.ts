import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { factories, tariffVersions } from "@/db/schema";
import { ensureReferenceTariffs } from "@/server/bootstrap";
import { previewRate } from "@/server/services/tariffs";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("reference data", () => {
  it("new factories use CEA v22.0 (FY 2025-26) for grid emissions", async () => {
    const f = await t.db.query.factories.findFirst({ where: eq(factories.id, IDS.facB) });
    expect(f!.emissionFactor).toBe(0.675);
    expect(f!.emissionFactorSource).toMatch(/v22\.0/);
  });

  it("Foundry B (Maharashtra) gets the MSEDCL HT I(A) FY 2026-27 tariff, both seasons, VERIFIED", async () => {
    const v = await t.db.select().from(tariffVersions).where(eq(tariffVersions.factoryId, IDS.facB));
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.evidence === "VERIFIED" && x.sourceNote.includes("Case No. 75 of 2025"))).toBe(true);
    const b = await t.actor(IDS.ownerB, IDS.facB);
    // November is in the October–March season: solar rebate 25 % of EC, at PF 0.95.
    const noon = await previewRate(t.db, b, "2026-11-18T12:00");
    expect(noon.rate).toMatchObject({ kind: "SOLAR", ratePaise: 752 }); // (9.25 − 0.25 × 8.44) / 0.95
    const evening = await previewRate(t.db, b, "2026-11-18T19:00");
    expect(evening.rate).toMatchObject({ kind: "PEAK", ratePaise: 1151 }); // (9.25 + 0.20 × 8.44) / 0.95 = 11.514
    const morning = await previewRate(t.db, b, "2026-11-18T07:00");
    expect(morning.rate).toMatchObject({ kind: "NORMAL", ratePaise: 974 });
    const july = await previewRate(t.db, b, "2026-07-15T12:00");
    expect(july.rate).toMatchObject({ kind: "SOLAR", ratePaise: 840 }); // April–September: 15 %
    const f = await t.db.query.factories.findFirst({ where: eq(factories.id, IDS.facB) });
    expect(f!.demandRatePaisePerKvaMonth).toBe(65000);
  });

  it("is idempotent", async () => {
    await ensureReferenceTariffs(t.db);
    await ensureReferenceTariffs(t.db);
    expect(await t.db.select().from(tariffVersions).where(eq(tariffVersions.factoryId, IDS.facB))).toHaveLength(2);
  });
});
