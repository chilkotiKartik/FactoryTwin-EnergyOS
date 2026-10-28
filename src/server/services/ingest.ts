import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { factories, furnaces, meters } from "@/db/schema";
import { classifyReading, completeReading } from "@/domain/quality";
import { audit } from "../audit";
import { hashToken } from "../auth/password";
import { AppError, validation } from "../errors";
import { insertReadings } from "./demo";
import { scheduleAnalysis } from "./jobs";

export const MAX_INGEST_READINGS = 1440;

const bodySchema = z.object({
  readings: z
    .array(
      z.object({
        timestamp: z.string().min(10).max(40),
        power_kw: z.number().nullable().optional(),
        /** Energy in the interval that starts at `timestamp`. */
        energy_kwh: z.number().nullable().optional(),
        /** Cumulative energy register (kWh counter). Interval energy is the difference to the previous interval. */
        energy_kwh_total: z.number().min(0).nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_INGEST_READINGS),
});

/** Timestamps within this many ms of the interval grid are snapped to it (meter clock drift). */
export function driftToleranceMs(intervalSeconds: number) {
  return Math.min(5000, intervalSeconds * 100);
}

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
  const tol = driftToleranceMs(meter.intervalSeconds);
  const rejected: { index: number; reason: string }[] = [];
  const notes: { index: number; note: string }[] = [];

  // 1. Timestamps: offset required, snapped to the grid when within the drift tolerance.
  const timed: { i: number; ts: number; r: (typeof parsed.data.readings)[number]; drift: number }[] = [];
  for (const [i, r] of parsed.data.readings.entries()) {
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(r.timestamp)) {
      rejected.push({ index: i, reason: "Timestamp must be ISO 8601 with a time-zone offset." });
      continue;
    }
    const ts = Math.round(t / step) * step;
    if (Math.abs(t - ts) > tol) {
      rejected.push({ index: i, reason: `Not aligned to the ${meter.intervalSeconds}s interval (more than ${tol / 1000}s off).` });
      continue;
    }
    if (ts > Date.now() + 5 * 60_000) {
      rejected.push({ index: i, reason: "Timestamp is in the future." });
      continue;
    }
    timed.push({ i, ts, r, drift: t - ts });
  }
  timed.sort((a, b) => a.ts - b.ts);

  // 2. Counter registers: interval energy = this total − total of the previous interval.
  const totals = new Map<number, number>();
  if (meter.lastCounterTs !== null && meter.lastCounterKwh !== null) totals.set(meter.lastCounterTs, meter.lastCounterKwh);
  for (const x of timed) if (x.r.energy_kwh_total != null) totals.set(x.ts, x.r.energy_kwh_total);

  const rows = [];
  for (const { i, ts, r, drift } of timed) {
    let energy = r.energy_kwh ?? null;
    let counterNote: string | null = null;
    if (energy === null && r.energy_kwh_total != null) {
      const next = totals.get(ts + step);
      if (next === undefined) {
        // The interval starting at ts closes with the next total; it is priced when that arrives.
        if (r.power_kw == null) {
          notes.push({ index: i, note: "Counter stored; this interval's energy is computed when the next reading arrives." });
          continue;
        }
      } else if (next < r.energy_kwh_total) {
        counterNote = "Counter went backwards (reset or rollover); interval energy taken from power.";
        if (r.power_kw == null) {
          rejected.push({ index: i, reason: "Counter went backwards (reset or rollover) and no power value was sent." });
          continue;
        }
      } else {
        energy = next - r.energy_kwh_total;
      }
    }
    const reading = { ts, powerKw: r.power_kw ?? null, energyKwh: energy };
    const q = classifyReading(reading, { ratedKw: furnace?.ratedKw ?? 1000, intervalSeconds: meter.intervalSeconds });
    if (q.quality === "INVALID") {
      rejected.push({ index: i, reason: q.reason ?? "Invalid." });
      continue;
    }
    const full = completeReading(reading, meter.intervalSeconds)!;
    const note = [q.reason, counterNote, drift !== 0 ? `Clock drift ${(drift / 1000).toFixed(1)}s, snapped to the interval.` : null].filter(Boolean).join(" ") || null;
    rows.push({
      factoryId: factory.id,
      meterId: meter.id,
      ts,
      powerKw: full.powerKw,
      energyKwh: full.energyKwh,
      quality: q.quality === "SUSPECT" ? ("SUSPECT" as const) : ("OK" as const),
      qualityNote: note,
      provenance: "MEASURED" as const,
    });
  }
  // Counter readings for an interval whose previous interval arrived in an earlier
  // request: fill the energy of that earlier interval now.
  const fill = meter.lastCounterTs !== null && meter.lastCounterKwh !== null ? totals.get(meter.lastCounterTs + step) : undefined;
  // Duplicates (same meter + timestamp) are ignored by the unique index; the first value wins.
  if (rows.length) await insertReadings(db, rows);
  if (fill !== undefined && meter.lastCounterTs !== null && meter.lastCounterKwh !== null && fill >= meter.lastCounterKwh) {
    const kwh = fill - meter.lastCounterKwh;
    await insertReadings(db, [{ factoryId: factory.id, meterId: meter.id, ts: meter.lastCounterTs, powerKw: (kwh * 3600) / meter.intervalSeconds, energyKwh: kwh, quality: "OK", qualityNote: "From counter difference.", provenance: "MEASURED" }]);
  }
  const latestTotal = timed.filter((x) => x.r.energy_kwh_total != null).at(-1);
  await db
    .update(meters)
    .set({
      ingestTokenLastUsedAt: Date.now(),
      ...(latestTotal && (meter.lastCounterTs === null || latestTotal.ts >= meter.lastCounterTs) ? { lastCounterKwh: latestTotal.r.energy_kwh_total!, lastCounterTs: latestTotal.ts } : {}),
    })
    .where(eq(meters.id, meter.id));
  await audit(db, null, "meter.ingest", "meter", meter.id, { received: parsed.data.readings.length, stored: rows.length, rejected: rejected.length }, factory.id);
  if (rows.length) scheduleAnalysis(db, factory.id);
  return { meterId: meter.id, received: parsed.data.readings.length, accepted: rows.length, rejected, notes };
}
