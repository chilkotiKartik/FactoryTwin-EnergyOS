/**
 * Small in-process fixed-window rate limiter with a hard size bound.
 *
 * Single-process only: a multi-instance deployment should move this to a shared
 * store. The map can never grow past `maxKeys`: expired windows are pruned first,
 * then the oldest entries are dropped, so an attacker rotating keys cannot
 * exhaust memory.
 */
export interface RateLimiter {
  /** Count one hit; false when the key is over its limit for the current window. */
  hit(key: string, now?: number): boolean;
  /** Is the key already over its limit (without counting a hit)? */
  blocked(key: string, now?: number): boolean;
  size(): number;
}

export function createRateLimiter(max: number, windowMs: number, maxKeys = 10_000): RateLimiter {
  const hits = new Map<string, { n: number; reset: number }>();

  const prune = (now: number) => {
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    // Still too large (all windows live): drop the oldest insertions.
    for (const k of hits.keys()) {
      if (hits.size < maxKeys) break;
      hits.delete(k);
    }
  };

  return {
    hit(key, now = Date.now()) {
      const h = hits.get(key);
      if (!h || h.reset <= now) {
        if (hits.size >= maxKeys) prune(now);
        hits.set(key, { n: 1, reset: now + windowMs });
        return true;
      }
      h.n += 1;
      return h.n <= max;
    },
    blocked(key, now = Date.now()) {
      const h = hits.get(key);
      return !!h && h.reset > now && h.n >= max;
    },
    size: () => hits.size,
  };
}

/** Best-effort client address from proxy headers (trust these only behind your own proxy). */
export function clientAddress(h: Pick<Headers, "get">): string {
  return (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown").split(",")[0].trim().slice(0, 64) || "unknown";
}
