import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { isPrivateAddress, makeSafeLookup, postPinned } from "@/server/safe-http";

describe("isPrivateAddress", () => {
  it("blocks loopback, private, link-local, CGNAT, multicast and reserved ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("refuses things that are not addresses", () => {
    expect(isPrivateAddress("example.com")).toBe(true);
  });
});

const run = (lookup: ReturnType<typeof makeSafeLookup>) =>
  new Promise<string>((resolve, reject) => lookup("hooks.example", {}, (err, address) => (err ? reject(err) : resolve(address as string))));

describe("makeSafeLookup (DNS rebinding)", () => {
  it("refuses a name that resolves to a private address", async () => {
    await expect(run(makeSafeLookup(false, async () => [{ address: "10.0.0.5", family: 4 }]))).rejects.toThrow(/private address/);
  });
  it("refuses a name that resolves to public AND private addresses", async () => {
    await expect(run(makeSafeLookup(false, async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]))).rejects.toThrow(/private/);
  });
  it("pins the checked public address", async () => {
    await expect(run(makeSafeLookup(false, async () => [{ address: "93.184.216.34", family: 4 }]))).resolves.toBe("93.184.216.34");
  });
  it("allows private answers only when explicitly enabled (internal gateway)", async () => {
    await expect(run(makeSafeLookup(true, async () => [{ address: "10.0.0.5", family: 4 }]))).resolves.toBe("10.0.0.5");
  });
});

describe("postPinned", () => {
  it("connects to the address the checked lookup returned, whatever the name", async () => {
    const got: string[] = [];
    const server = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        got.push(`${req.headers.host} ${b}`);
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    // The name does not exist in DNS; the injected resolver pins it to the test server.
    const r = await postPinned(`http://alerts.invalid:${port}/x`, { "content-type": "application/json" }, '{"a":1}', { allowPrivate: true, timeoutMs: 2000, resolver: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(r.status).toBe(204);
    expect(got[0]).toBe(`alerts.invalid:${port} {"a":1}`);
    // Same server, private answers not allowed: refused before connecting.
    await expect(postPinned(`http://alerts.invalid:${port}/x`, {}, "{}", { allowPrivate: false, timeoutMs: 2000, resolver: async () => [{ address: "127.0.0.1", family: 4 }] })).rejects.toThrow(/private/);
    expect(got).toHaveLength(1);
    server.close();
  });
});
