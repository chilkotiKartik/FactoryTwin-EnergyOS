import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Outbound requests to user-supplied URLs (alert webhooks) without SSRF holes.
 * The host name is resolved once, every address it resolves to must be public, and
 * the connection goes to that checked address: a DNS answer that changes between the
 * check and the connection (DNS rebinding) cannot point the request inside the network.
 */
const V4_BLOCKED = [
  "0.0.0.0/8", // "this" network
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local (cloud metadata lives here)
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved and broadcast
];

const v4ToInt = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0) >>> 0;

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsS] = cidr.split("/");
  const bits = Number(bitsS);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((v4ToInt(ip) & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
}

/** Loopback, private, link-local, CGNAT, multicast, reserved or unique-local (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return V4_BLOCKED.some((c) => inCidr(ip, c));
  if (kind === 6) {
    const a = ip.toLowerCase();
    if (a === "::" || a === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a);
  }
  return true; // not an address: refuse
}

type Resolver = (host: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (host) =>
  new Promise((resolve, reject) => dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));

/** A `lookup` for http(s).request that refuses private answers and pins the first checked address. */
export function makeSafeLookup(allowPrivate: boolean, resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean }, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
    resolver(hostname)
      .then((addrs) => {
        if (!addrs.length) throw new Error(`${hostname} did not resolve.`);
        if (!allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`${hostname} resolves to a private address; refused.`);
        const first = addrs[0];
        if (options?.all) cb(null, [first]);
        else cb(null, first.address, first.family);
      })
      .catch((e: Error) => cb(e, "", 0));
  };
}

export interface PostResult {
  status: number;
}

/** POST a body to a checked URL with a pinned, checked address. Never follows redirects. */
export function postPinned(url: string, headers: Record<string, string>, body: string, opts: { allowPrivate: boolean; timeoutMs: number; resolver?: Resolver }): Promise<PostResult> {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup: makeSafeLookup(opts.allowPrivate, opts.resolver) as never,
        // A fresh connection every time: a pooled socket would skip the checked lookup.
        agent: false,
        timeout: opts.timeoutMs,
      },
      (res) => {
        res.resume(); // the body is not used
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out.")));
    req.on("error", reject);
    req.end(body);
  });
}
