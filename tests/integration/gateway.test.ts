import { createServer, type Server } from "node:http";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { meterReadings, meters } from "@/db/schema";
import { hashToken } from "@/server/auth/password";
import { ingestReadings } from "@/server/services/ingest";
import { readRegisters, ModbusError } from "../../gateway/modbus";
import { alignDown, decode, FileBuffer, flush, localIso, type GatewayConfig } from "../../gateway/core";
import { freshDb, IDS } from "../helpers/db";

/** A tiny Modbus TCP server: holding registers 0–9, two float32 values (power kW, energy kWh). */
function fakeMeter(state: { kw: number; kwh: number }) {
  const regs = () => {
    const b = Buffer.alloc(8);
    b.writeFloatBE(state.kw, 0);
    b.writeFloatBE(state.kwh, 4);
    return [b.readUInt16BE(0), b.readUInt16BE(2), b.readUInt16BE(4), b.readUInt16BE(6)];
  };
  return net.createServer((sock) =>
    sock.on("data", (req) => {
      const tid = req.readUInt16BE(0);
      const unit = req.readUInt8(6);
      const fn = req.readUInt8(7);
      const addr = req.readUInt16BE(8);
      const count = req.readUInt16BE(10);
      if (fn !== 3 || addr + count > 4) {
        const ex = Buffer.alloc(9);
        ex.writeUInt16BE(tid, 0);
        ex.writeUInt16BE(3, 4);
        ex.writeUInt8(unit, 6);
        ex.writeUInt8(fn | 0x80, 7);
        ex.writeUInt8(2, 8); // illegal data address
        return sock.write(ex);
      }
      const words = regs().slice(addr, addr + count);
      const res = Buffer.alloc(9 + count * 2);
      res.writeUInt16BE(tid, 0);
      res.writeUInt16BE(3 + count * 2, 4);
      res.writeUInt8(unit, 6);
      res.writeUInt8(fn, 7);
      res.writeUInt8(count * 2, 8);
      words.forEach((w, i) => res.writeUInt16BE(w, 9 + i * 2));
      sock.write(res);
    }),
  );
}

let t: Awaited<ReturnType<typeof freshDb>>;
let meterSrv: net.Server;
let meterPort = 0;
let ingestSrv: Server;
let ingestUrl = "";
let ingestUp = true;
const TOKEN = "eos_gateway_test_token_0123456789";
const state = { kw: 512.25, kwh: 104000 };
const dir = mkdtempSync(path.join(tmpdir(), "gw-"));

beforeAll(async () => {
  t = await freshDb();
  const m = (await t.db.select().from(meters).where(eq(meters.factoryId, IDS.facB)))[0];
  await t.db.update(meters).set({ ingestTokenHash: hashToken(TOKEN), ingestTokenIssuedAt: Date.now() }).where(eq(meters.id, m.id));
  meterSrv = fakeMeter(state);
  await new Promise<void>((r) => meterSrv.listen(0, "127.0.0.1", r));
  meterPort = (meterSrv.address() as net.AddressInfo).port;
  // The real ingest logic behind a plain HTTP server (what /api/ingest runs).
  ingestSrv = createServer((req, res) => {
    if (!ingestUp) return res.writeHead(503).end("down");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const out = await ingestReadings(t.db, (req.headers.authorization ?? "").replace("Bearer ", ""), JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(401).end(String((e as Error).message));
      }
    });
  });
  await new Promise<void>((r) => ingestSrv.listen(0, "127.0.0.1", r));
  ingestUrl = `http://127.0.0.1:${(ingestSrv.address() as net.AddressInfo).port}/api/ingest`;
});
afterAll(async () => {
  meterSrv.close();
  ingestSrv.close();
  rmSync(dir, { recursive: true, force: true });
  await t.cleanup();
});

describe("Modbus TCP client", () => {
  it("reads and decodes float32 registers in both word orders", async () => {
    const w = await readRegisters({ host: "127.0.0.1", port: meterPort, unitId: 1, fn: 3, address: 0, count: 4 });
    expect(decode(w.slice(0, 2), { function: 3, address: 0, type: "float32" })).toBeCloseTo(512.25, 3);
    expect(decode(w.slice(2, 4), { function: 3, address: 2, type: "float32" })).toBeCloseTo(104000, 0);
    expect(decode([w[1], w[0]], { function: 3, address: 0, type: "float32", wordOrder: "CDAB" })).toBeCloseTo(512.25, 3);
    expect(decode([0x0001, 0x86a0], { function: 3, address: 0, type: "uint32", scale: 0.001 })).toBeCloseTo(100, 6);
  });
  it("reports a Modbus exception and an unreachable meter clearly", async () => {
    await expect(readRegisters({ host: "127.0.0.1", port: meterPort, unitId: 1, fn: 3, address: 100, count: 2 })).rejects.toThrow(/exception 2/);
    await expect(readRegisters({ host: "127.0.0.1", port: 1, unitId: 1, fn: 3, address: 0, count: 2, timeoutMs: 500 })).rejects.toBeInstanceOf(ModbusError);
  });
});

describe("gateway → ingest", () => {
  it("timestamps carry the plant's offset and sit on the interval grid", () => {
    expect(localIso(Date.UTC(2026, 10, 18, 3, 45), "+05:30")).toBe("2026-11-18T09:15:00+05:30");
    expect(alignDown(Date.UTC(2026, 10, 18, 3, 45, 41), 60)).toBe(Date.UTC(2026, 10, 18, 3, 45));
  });

  it("buffers while the server is down, then delivers everything once, as MEASURED", async () => {
    const cfg: GatewayConfig = { url: ingestUrl, token: TOKEN, meter: { host: "127.0.0.1", port: meterPort }, power: { function: 3, address: 0, type: "float32" }, energy: { function: 3, address: 2, type: "float32" } };
    const buffer = new FileBuffer(path.join(dir, "buf.jsonl"));
    const start = alignDown(Date.now(), 60) - 10 * 60_000;
    ingestUp = false;
    for (let i = 0; i < 5; i++) {
      state.kwh += 8.5;
      const w = await readRegisters({ host: "127.0.0.1", port: meterPort, unitId: 1, fn: 3, address: 0, count: 4 });
      buffer.add({ timestamp: localIso(start + i * 60_000, "+05:30"), power_kw: decode(w.slice(0, 2), cfg.power), energy_kwh_total: decode(w.slice(2, 4), cfg.energy) });
    }
    const down = await flush(cfg, buffer);
    expect(down).toMatchObject({ sent: 0, pending: 5 });
    expect(down.error).toMatch(/503/);
    ingestUp = true;
    const up = await flush(cfg, buffer);
    expect(up).toMatchObject({ sent: 5, pending: 0, error: null });
    const rows = await t.db.select().from(meterReadings).where(and(eq(meterReadings.factoryId, IDS.facB)));
    // Five counter readings give four complete intervals of 8.5 kWh each.
    const withEnergy = rows.filter((r) => r.energyKwh > 0);
    expect(withEnergy.length).toBeGreaterThanOrEqual(4);
    expect(withEnergy[0].energyKwh).toBeCloseTo(8.5, 1);
    expect(rows.every((r) => r.provenance === "MEASURED")).toBe(true);
    expect(rows[0].powerKw).toBeCloseTo(512.25, 2);
    // Delivered readings left the buffer; a second flush sends nothing again.
    expect(await flush(cfg, buffer)).toMatchObject({ sent: 0, pending: 0 });
  });

  it("keeps the data when the token is wrong (a person must fix it)", async () => {
    const buffer = new FileBuffer(path.join(dir, "buf2.jsonl"));
    buffer.add({ timestamp: localIso(alignDown(Date.now(), 60), "+05:30"), power_kw: 1, energy_kwh_total: 1 });
    const r = await flush({ url: ingestUrl, token: "eos_wrong", meter: { host: "x" }, power: { function: 3, address: 0, type: "float32" }, energy: { function: 3, address: 2, type: "float32" } }, buffer);
    expect(r.pending).toBe(1);
    expect(r.error).toMatch(/401/);
  });
});
