import net from "node:net";

/**
 * Minimal Modbus TCP client: read holding (0x03) or input (0x04) registers.
 * Enough for an energy meter; no writes are implemented, on purpose.
 */
export class ModbusError extends Error {}

export async function readRegisters(opts: { host: string; port: number; unitId: number; fn: 3 | 4; address: number; count: number; timeoutMs?: number }): Promise<number[]> {
  const { host, port, unitId, fn, address, count } = opts;
  if (count < 1 || count > 125) throw new ModbusError("Register count must be 1–125.");
  const tid = Math.floor(Math.random() * 0xffff);
  const req = Buffer.alloc(12);
  req.writeUInt16BE(tid, 0); // transaction id
  req.writeUInt16BE(0, 2); // protocol id
  req.writeUInt16BE(6, 4); // length: unit + 5 bytes PDU
  req.writeUInt8(unitId, 6);
  req.writeUInt8(fn, 7);
  req.writeUInt16BE(address, 8);
  req.writeUInt16BE(count, 10);
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const done = (err: Error | null, val?: number[]) => {
      sock.destroy();
      if (err) reject(err);
      else resolve(val!);
    };
    sock.setTimeout(opts.timeoutMs ?? 3000, () => done(new ModbusError(`No answer from ${host}:${port} (timeout).`)));
    sock.on("error", (e) => done(new ModbusError(`Cannot reach meter ${host}:${port}: ${e.message}`)));
    sock.on("connect", () => sock.write(req));
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 9) return;
      const len = buf.readUInt16BE(4);
      if (buf.length < 6 + len) return;
      if (buf.readUInt16BE(0) !== tid) return done(new ModbusError("Answer for a different request."));
      const f = buf.readUInt8(7);
      if (f === (fn | 0x80)) return done(new ModbusError(`Meter refused the read (Modbus exception ${buf.readUInt8(8)}).`));
      if (f !== fn) return done(new ModbusError(`Unexpected function code ${f}.`));
      const bytes = buf.readUInt8(8);
      if (bytes !== count * 2) return done(new ModbusError("Answer has the wrong length."));
      const out: number[] = [];
      for (let i = 0; i < count; i++) out.push(buf.readUInt16BE(9 + i * 2));
      done(null, out);
    });
  });
}
