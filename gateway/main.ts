/**
 * FactoryTwin EnergyOS meter gateway.
 *
 *   node --experimental-strip-types gateway/main.ts gateway/config.json      (Node 22.6+)
 *   npx tsx gateway/main.ts gateway/config.json
 *
 * Reads an energy meter over Modbus TCP once per interval and pushes the readings
 * to /api/ingest. Every reading is written to a local buffer file first, so nothing is
 * lost while the internet or the server is down. Read-only towards the meter.
 */
import { readFileSync } from "node:fs";
import { readRegisters } from "./modbus";
import { alignDown, decode, FileBuffer, flush, localIso, registerCount, type GatewayConfig, type Reading, type RegisterSpec } from "./core";

const cfg = JSON.parse(readFileSync(process.argv[2] ?? "gateway/config.json", "utf8")) as GatewayConfig;
const interval = cfg.meter.intervalSeconds ?? 60;
const offset = cfg.meter.utcOffset ?? "+05:30";
const buffer = new FileBuffer(cfg.bufferFile ?? "gateway-buffer.jsonl");

async function readValue(spec: RegisterSpec): Promise<number | null> {
  try {
    const words = await readRegisters({ host: cfg.meter.host, port: cfg.meter.port ?? 502, unitId: cfg.meter.unitId ?? 1, fn: spec.function, address: spec.address, count: registerCount(spec) });
    const v = decode(words, spec);
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    console.error(`[gateway] ${(e as Error).message}`);
    return null;
  }
}

async function tick(at: number) {
  const [power, energy] = [await readValue(cfg.power), await readValue(cfg.energy)];
  if (power === null && energy === null) return; // meter unreachable: nothing to record (the server flags the gap)
  const r: Reading = { timestamp: localIso(at, offset), power_kw: power, energy_kwh_total: energy };
  buffer.add(r);
  const f = await flush(cfg, buffer);
  console.log(`[gateway] ${r.timestamp} ${power?.toFixed(1) ?? "—"} kW ${energy?.toFixed(1) ?? "—"} kWh · sent ${f.sent}, waiting ${f.pending}${f.error ? ` · ${f.error}` : ""}`);
}

function schedule() {
  const now = Date.now();
  const next = alignDown(now, interval) + interval * 1000;
  setTimeout(async () => {
    await tick(next).catch((e) => console.error("[gateway] tick failed", e));
    schedule();
  }, next - now);
}

console.log(`[gateway] meter ${cfg.meter.host}:${cfg.meter.port ?? 502} unit ${cfg.meter.unitId ?? 1}, every ${interval}s → ${cfg.url}`);
void flush(cfg, buffer).then((f) => f.pending && console.log(`[gateway] ${f.pending} readings waiting from before; will retry.`));
schedule();
