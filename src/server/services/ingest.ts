import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { factories, furnaces, meters } from "@/db/schema";
import { classifyReading, completeReading } from "@/domain/quality";
import { audit } from "../audit";
import { hashToken } from "../auth/password";
import { AppError, validation } from "../errors";
import { insertReadings } from "./demo";

export const MAX_INGEST_READINGS = 1440;

const bodySchema = z.object({
  readings: z
    .array(
      z.object({
        timestamp: z.string().min(10).max(40),
        power_kw: z.number().nullable().optional(),
        energy_kwh: z.number().nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_INGEST_READINGS),
});

/**
 * Read-only meter ingest. A meter pushes readings with its bearer token; they are
 * stored as MEASURED. This endpoint only receives data. It never sends anything
 * to plant equipment. Simulation factories refuse live data so the two never mix.
 */
export async function ingestReadings(db: DB, token: string | null, raw: unknown) {
  if (!token || !token.startsWith("eos_") || token.length > 200) throw new AppError("UNAUTHENTICATED", "Missing or malformed meter token.");
  const meter = await db.query.meters.findFirst({ where: eq(meters.ingestTokenHash, hashToken(token)) });
  if (!meter) throw new AppError("UNAUTHENTICATED", "Unknown meter token.");
  const factory = await db.query.factories.findFirst({ where: eq(factories.id, meter.factoryId) });
  if (!factory) throw new AppError("UNAUTHENTICATED", "Unknown meter token.");
  if (factory.isSimulation) throw new AppError("FORBIDDEN", "This is a simulation factory; live readings are not accepted.");
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Invalid body.");
  const furnace = await db.query.furnaces.findFirst({ where: eq(furnaces.factoryId, factory.id) });
  const step = meter.intervalSeconds * 1000;
  const rejected: { index: number; reason: string }[] = [];
  const rows = [];
  for (const [i, r] of parsed.data.readings.entries()) {
    const ts = Date.parse(r.timestamp);
    if (!Number.isFinite(ts) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(r.timestamp)) {
      rejected.push({ index: i, reason: "Timestamp must be ISO 8601 with a time-zone offset." });
      continue;
    }
    if (ts % step !== 0) {
      rejected.push({ index: i, reason: `Not aligned to the ${meter.intervalSeconds}s interval.` });
      continue;
    }
    if (ts > Date.now() + 5 * 60_000) {
      rejected.push({ index: i, reason: "Timestamp is in the future." });
      continue;
    }
    const raw = { ts, powerKw: r.power_kw ?? null, energyKwh: r.energy_kwh ?? null };
    const q = classifyReading(raw, { ratedKw: furnace?.ratedKw ?? 1000, intervalSeconds: meter.intervalSeconds });
    if (q.quality === "INVALID") {
      rejected.push({ index: i, reason: q.reason ?? "Invalid." });
      continue;
    }
    const full = completeReading(raw, meter.intervalSeconds)!;
    rows.push({
      factoryId: factory.id,
      meterId: meter.id,
      ts,
      powerKw: full.powerKw,
      energyKwh: full.energyKwh,
      quality: q.quality === "SUSPECT" ? ("SUSPECT" as const) : ("OK" as const),
      qualityNote: q.reason,
      provenance: "MEASURED" as const,
    });
  }
  // Duplicates (same meter + timestamp) are ignored by the unique index; the first value wins.
  if (rows.length) await insertReadings(db, rows);
  await audit(db, null, "meter.ingest", "meter", meter.id, { received: parsed.data.readings.length, stored: rows.length, rejected: rejected.length }, factory.id);
  return { meterId: meter.id, received: parsed.data.readings.length, accepted: rows.length, rejected };
}
