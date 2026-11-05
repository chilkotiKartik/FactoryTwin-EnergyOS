import { describe, expect, it } from "vitest";
import { isLocale, LOCALES, MESSAGES, translate, type MessageKey } from "@/lib/i18n/messages";

describe("i18n", () => {
  const keys = Object.keys(MESSAGES.en) as MessageKey[];
  it("every locale defines every key with non-empty text", () => {
    for (const l of LOCALES) {
      expect(Object.keys(MESSAGES[l]).sort()).toEqual([...keys].sort());
      for (const k of keys) expect(MESSAGES[l][k].trim().length, `${l}:${k}`).toBeGreaterThan(0);
    }
  });
  it("placeholders match across locales", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const l of LOCALES) for (const k of keys) expect(ph(MESSAGES[l][k]), `${l}:${k}`).toBe(ph(MESSAGES.en[k]));
  });
  it("translates, fills placeholders and validates locales", () => {
    expect(translate("hi", "heat.capacity", { n: 500 })).toBe("क्षमता 500 किग्रा");
    expect(translate("en", "heat.capacity", { n: 500 })).toBe("Capacity 500 kg");
    expect(isLocale("mr")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });
});
