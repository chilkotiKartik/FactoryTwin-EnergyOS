import { existsSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";

/** How one value is stored in the meter (from the meter's Modbus register manual). */
export interface RegisterSpec {
  /** 3 = holding registers, 4 = input registers. */
  function: 3 | 4;
  /** Zero-based register address (manuals often list 1-based or 3xxxx/4xxxx numbers: subtract accordingly). */
  address: number;
  type: "float32" | "uint32" | "int32" | "uint16";
  /** ABCD = high word first; CDAB = low word first (word-swapped). */
  wordOrder?: "ABCD" | "CDAB";
  /** Multiply the raw value by this to get kW (power) or kWh (energy). */
  scale?: number;
}

export interface GatewayConfig {
  /** https://<server>/api/ingest */
  url: string;
  /** Meter ingest token (eos_…) from Factory settings. */
  token: string;
  meter: { host: string; port?: number; unitId?: number; intervalSeconds?: number; utcOffset?: string };
  power: RegisterSpec;
  /** Cumulative energy register (kWh counter). */
  energy: RegisterSpec;
  bufferFile?: string;
}

export interface Reading {
  timestamp: string;
  power_kw: number | null;
  energy_kwh_total: number | null;
}

export const registerCount = (s: RegisterSpec) => (s.type === "uint16" ? 1 : 2);

export function decode(words: number[], s: RegisterSpec): number {
  const scale = s.scale ?? 1;
  if (s.type === "uint16") return words[0] * scale;
  const [hi, lo] = (s.wordOrder ?? "ABCD") === "ABCD" ? [words[0], words[1]] : [words[1], words[0]];
  const b = Buffer.alloc(4);
  b.writeUInt16BE(hi, 0);
  b.writeUInt16BE(lo, 2);
  const raw = s.type === "float32" ? b.readFloatBE(0) : s.type === "int32" ? b.readInt32BE(0) : b.readUInt32BE(0);
  return raw * scale;
}

/** "+05:30" → 330 minutes. */
export function offsetMinutes(utcOffset: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset);
  if (!m) throw new Error(`UTC offset must look like +05:30, got ${utcOffset}`);
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The interval boundary at or before `ms`. */
export const alignDown = (ms: number, intervalSeconds: number) => Math.floor(ms / (intervalSeconds * 1000)) * intervalSeconds * 1000;

/** ISO 8601 with the plant's UTC offset, e.g. 2026-11-18T09:15:00+05:30 (the ingest API requires an offset). */
export function localIso(ms: number, utcOffset: string): string {
  const d = new Date(ms + offsetMinutes(utcOffset) * 60_000);
  return `${d.toISOString().slice(0, 19)}${utcOffset}`;
}

/** Durable first-in-first-out buffer on disk (one JSON reading per line). */
export class FileBuffer {
  constructor(private readonly path: string) {}
  add(r: Reading) {
    appendFileSync(this.path, `${JSON.stringify(r)}\n`);
  }
  all(): Reading[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Reading];
        } catch {
          return []; // a torn last line after a power cut: skip it
        }
      });
  }
  /** Drop the first `n` readings (they were delivered). Atomic rewrite. */
  dropFirst(n: number) {
    const rest = this.all().slice(n);
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, rest.map((r) => `${JSON.stringify(r)}\n`).join(""));
    renameSync(tmp, this.path);
  }
}

export type SendOutcome = { ok: true; accepted: number; rejected: number } | { ok: false; retry: boolean; message: string };

/** POST up to `max` buffered readings, oldest first. */
export async function sendBatch(cfg: Pick<GatewayConfig, "url" | "token">, readings: Reading[], fetchImpl: typeof fetch = fetch): Promise<SendOutcome> {
  try {
    const res = await fetchImpl(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ readings }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { accepted?: number; rejected?: unknown[] };
      return { ok: true, accepted: Number(body.accepted ?? readings.length), rejected: Array.isArray(body.rejected) ? body.rejected.length : 0 };
    }
    // 401/403: wrong or revoked token — keep the data, a person has to fix the token.
    // 429/5xx: server busy or down — keep and retry.
    // 400: the batch itself is malformed — keep too; never silently drop measurements.
    return { ok: false, retry: true, message: `Server answered HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, retry: true, message: `Network: ${(e as Error).message}` };
  }
}

export const MAX_BATCH = 1440;

/** Deliver everything buffered, in batches, oldest first. Stops at the first failure. */
export async function flush(cfg: GatewayConfig, buffer: FileBuffer, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; pending: number; error: string | null }> {
  let sent = 0;
  for (;;) {
    const pending = buffer.all();
    if (!pending.length) return { sent, pending: 0, error: null };
    const batch = pending.slice(0, MAX_BATCH);
    const r = await sendBatch(cfg, batch, fetchImpl);
    if (!r.ok) return { sent, pending: pending.length, error: r.message };
    buffer.dropFirst(batch.length);
    sent += batch.length;
  }
}
