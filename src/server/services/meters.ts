import Papa from "papaparse";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { importBatches, meterReadings, meters, users } from "@/db/schema";
import { classifyReading, completeReading, findDuplicateTimestamps } from "@/domain/quality";
import { localToUtc } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { can } from "../permissions";
import { audit } from "../audit";
import { validation } from "../errors";
import { newId } from "../ids";
import { requireFurnace } from "./common";
import { insertReadings } from "./demo";
import { analyseFactory } from "./analysis";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;

export type RowStatus = "ACCEPT" | "SUSPECT" | "REJECT" | "DUPLICATE_IN_FILE" | "DUPLICATE_EXISTING";

export interface ParsedRow {
  line: number;
  raw: Record<string, string>;
  ts: number | null;
  powerKw: number | null;
  energyKwh: number | null;
  status: RowStatus;
  message: string | null;
}

export interface CsvPreview {
  meterId: string;
  filename: string;
  rows: ParsedRow[];
  counts: Record<RowStatus, number>;
  columns: string[];
  firstTs: number | null;
  lastTs: number | null;
  fatal: string | null;
}

const TS_KEYS = ["timestamp", "ts", "time", "datetime", "date_time"];
const KW_KEYS = ["power_kw", "kw", "power"];
const KWH_KEYS = ["energy_kwh", "kwh", "energy", "interval_kwh"];

/** Parse a timestamp. ISO with offset is taken as-is; a naive "YYYY-MM-DD HH:MM[:SS]" is factory-local time. */
export function parseTimestamp(v: string, tz: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s.replace(" ", "T"));
    return Number.isFinite(t) ? t : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, d, hh, mm, ss] = m;
  const h = Number(hh);
  const mi = Number(mm);
  if (h > 23 || mi > 59 || (ss && Number(ss) > 59)) return null;
  const base = localToUtc(d, h * 60 + mi, tz);
  return Number.isFinite(base) ? base + Number(ss ?? 0) * 1000 : null;
}

function parseNumber(v: string | undefined): number | null | "bad" {
  if (v === undefined) return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : "bad";
}

export async function previewCsv(db: DB, actor: Actor, meterId: string, filename: string, text: string): Promise<CsvPreview> {
  requirePerm(actor, "meter.import");
  const meter = await db.query.meters.findFirst({ where: and(eq(meters.id, meterId), eq(meters.factoryId, actor.factory.id)) });
  if (!meter) throw validation("Choose a meter that belongs to this factory.");
  const furnace = await requireFurnace(db, actor.factory.id);
  const empty: CsvPreview = {
    meterId,
    filename,
    rows: [],
    counts: { ACCEPT: 0, SUSPECT: 0, REJECT: 0, DUPLICATE_IN_FILE: 0, DUPLICATE_EXISTING: 0 },
    columns: [],
    firstTs: null,
    lastTs: null,
    fatal: null,
  };
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) return { ...empty, fatal: `File is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it by day.` };
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const cols = parsed.meta.fields ?? [];
  const tsKey = cols.find((c) => TS_KEYS.includes(c));
  const kwKey = cols.find((c) => KW_KEYS.includes(c));
  const kwhKey = cols.find((c) => KWH_KEYS.includes(c));
  if (!tsKey) return { ...empty, columns: cols, fatal: `No timestamp column. Expected one of: ${TS_KEYS.join(", ")}.` };
  if (!kwKey && !kwhKey) return { ...empty, columns: cols, fatal: "Need a power_kw or energy_kwh column." };
  if (parsed.data.length > MAX_CSV_ROWS) return { ...empty, columns: cols, fatal: `More than ${MAX_CSV_ROWS.toLocaleString()} rows. Split the file.` };

  const rows: ParsedRow[] = parsed.data.map((r, i) => {
    const line = i + 2;
    const ts = parseTimestamp(r[tsKey] ?? "", actor.factory.timeZone);
    const kw = kwKey ? parseNumber(r[kwKey]) : null;
    const kwh = kwhKey ? parseNumber(r[kwhKey]) : null;
    if (ts === null) return { line, raw: r, ts: null, powerKw: null, energyKwh: null, status: "REJECT", message: "Unreadable timestamp." };
    if (kw === "bad" || kwh === "bad") return { line, raw: r, ts, powerKw: null, energyKwh: null, status: "REJECT", message: "Value is not a number." };
    if (ts % (meter.intervalSeconds * 1000) !== 0)
      return { line, raw: r, ts, powerKw: kw, energyKwh: kwh, status: "REJECT", message: `Timestamp not aligned to the meter's ${meter.intervalSeconds}s interval.` };
    const q = classifyReading({ ts, powerKw: kw, energyKwh: kwh }, { ratedKw: furnace.ratedKw, intervalSeconds: meter.intervalSeconds });
    if (q.quality === "INVALID") return { line, raw: r, ts, powerKw: kw, energyKwh: kwh, status: "REJECT", message: q.reason };
    const full = completeReading({ ts, powerKw: kw, energyKwh: kwh }, meter.intervalSeconds)!;
    return { line, raw: r, ts, powerKw: full.powerKw, energyKwh: full.energyKwh, status: q.quality === "SUSPECT" ? "SUSPECT" : "ACCEPT", message: q.reason };
  });

  // Duplicates inside the file: keep the first, flag the rest.
  const candidates = rows.filter((r) => r.status === "ACCEPT" || r.status === "SUSPECT") as (ParsedRow & { ts: number })[];
  const dups = findDuplicateTimestamps(candidates);
  for (const list of dups.values()) {
    for (const r of list.slice(1)) {
      r.status = "DUPLICATE_IN_FILE";
      r.message = `Same timestamp as line ${list[0].line}.`;
    }
  }
  // Duplicates against stored readings.
  const tsList = candidates.filter((r) => r.status === "ACCEPT" || r.status === "SUSPECT").map((r) => r.ts);
  const existing = new Set<number>();
  for (let i = 0; i < tsList.length; i += 500) {
    const chunk = tsList.slice(i, i + 500);
    const found = await db
      .select({ ts: meterReadings.ts })
      .from(meterReadings)
      .where(and(eq(meterReadings.meterId, meterId), inArray(meterReadings.ts, chunk)));
    for (const f of found) existing.add(f.ts);
  }
  for (const r of candidates) {
    if ((r.status === "ACCEPT" || r.status === "SUSPECT") && existing.has(r.ts)) {
      r.status = "DUPLICATE_EXISTING";
      r.message = "A reading for this meter and time is already stored; the stored value is kept.";
    }
  }
  const counts = { ...empty.counts };
  for (const r of rows) counts[r.status]++;
  const okTs = rows.filter((r) => r.ts !== null).map((r) => r.ts!);
  return {
    meterId,
    filename,
    rows,
    counts,
    columns: cols,
    firstTs: okTs.length ? Math.min(...okTs) : null,
    lastTs: okTs.length ? Math.max(...okTs) : null,
    fatal: null,
  };
}

export type DeclaredSource = "GENUINE_METER_EXPORT" | "UNVERIFIED";

/**
 * Commit an import. The file is re-validated on the server (the preview is never
 * trusted). Only ACCEPT and SUSPECT rows are stored; rejected and duplicate rows
 * are reported and skipped, so invalid rows cannot corrupt accepted data.
 */
export async function commitCsv(db: DB, actor: Actor, meterId: string, filename: string, text: string, declared: DeclaredSource) {
  requirePerm(actor, "meter.import");
  const preview = await previewCsv(db, actor, meterId, filename, text);
  if (preview.fatal) throw validation(preview.fatal);
  const provenance = actor.factory.isSimulation ? "SIMULATED" : declared === "GENUINE_METER_EXPORT" ? "MEASURED" : "IMPORTED_UNVERIFIED";
  const batchId = newId("imp");
  const keep = preview.rows.filter((r) => r.status === "ACCEPT" || r.status === "SUSPECT");
  await db.transaction(async (tx) => {
    await tx.insert(importBatches).values({
      id: batchId,
      factoryId: actor.factory.id,
      meterId,
      filename: filename.slice(0, 200),
      provenance,
      rowsTotal: preview.rows.length,
      rowsAccepted: keep.length,
      rowsRejected: preview.counts.REJECT,
      rowsDuplicate: preview.counts.DUPLICATE_IN_FILE + preview.counts.DUPLICATE_EXISTING,
      issues: preview.rows.filter((r) => r.message).slice(0, 500).map((r) => ({ row: r.line, message: `${r.status}: ${r.message}` })),
      createdBy: actor.userId,
    });
    await insertReadings(
      tx,
      keep.map((r) => ({
        factoryId: actor.factory.id,
        meterId,
        ts: r.ts!,
        powerKw: r.powerKw!,
        energyKwh: r.energyKwh!,
        quality: r.status === "SUSPECT" ? ("SUSPECT" as const) : ("OK" as const),
        qualityNote: r.status === "SUSPECT" ? r.message : null,
        provenance,
        importBatchId: batchId,
      })),
    );
    await audit(tx, actor, "meter.import", "import_batch", batchId, {
      filename,
      provenance,
      accepted: keep.length,
      rejected: preview.counts.REJECT,
      duplicates: preview.counts.DUPLICATE_IN_FILE + preview.counts.DUPLICATE_EXISTING,
    });
  });
  if (keep.length > 0 && can(actor.role, "analysis.run")) await analyseFactory(db, actor, "meter.import");
  return { batchId, accepted: keep.length, counts: preview.counts, provenance };
}

export async function listImports(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  return db
    .select({ b: importBatches, by: users.name })
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.createdBy))
    .where(eq(importBatches.factoryId, actor.factory.id))
    .orderBy(desc(importBatches.createdAt))
    .limit(20);
}

export async function listMeters(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  return db.select().from(meters).where(eq(meters.factoryId, actor.factory.id)).orderBy(asc(meters.name));
}

export async function readingsPage(db: DB, actor: Actor, opts: { from: number; to: number; page: number; pageSize: number; quality?: string }) {
  requirePerm(actor, "view");
  const conds = [eq(meterReadings.factoryId, actor.factory.id), gte(meterReadings.ts, opts.from), lt(meterReadings.ts, opts.to)];
  if (opts.quality && ["OK", "SUSPECT", "INVALID"].includes(opts.quality)) conds.push(eq(meterReadings.quality, opts.quality as "OK"));
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(meterReadings)
      .where(where)
      .orderBy(asc(meterReadings.ts))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ c: sql<number>`count(*)` }).from(meterReadings).where(where),
  ]);
  return { rows, total: Number(total[0]?.c ?? 0) };
}
