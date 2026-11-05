import { describe, expect, it } from "vitest";
import { clientAddress, createRateLimiter } from "@/server/ratelimit";

describe("rate limiter", () => {
  it("allows up to max hits per window, then blocks, then resets", () => {
    const rl = createRateLimiter(3, 1000);
    expect([1, 2, 3].map(() => rl.hit("a", 0))).toEqual([true, true, true]);
    expect(rl.hit("a", 10)).toBe(false);
    expect(rl.blocked("a", 10)).toBe(true);
    expect(rl.hit("a", 1000)).toBe(true);
    expect(rl.blocked("a", 1001)).toBe(false);
  });

  it("is bounded when keys are rotated", () => {
    const rl = createRateLimiter(1, 60_000, 100);
    for (let i = 0; i < 5000; i++) rl.hit(`k${i}`, 0);
    expect(rl.size()).toBeLessThanOrEqual(100);
  });

  it("takes the first forwarded address", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
