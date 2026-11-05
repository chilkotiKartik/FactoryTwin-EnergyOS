import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseIexDamSnapshot, summariseMarketDay } from "@/domain/iex";

/** Real rows from the IEX Day-Ahead Market snapshot page (delivery 5 Nov 2026), as the page embeds them. */
const FIXTURE = readFileSync(path.join(__dirname, "../fixtures/iex-dam-snapshot.html"), "utf8");

describe("IEX day-ahead parser", () => {
  const day = parseIexDamSnapshot(FIXTURE)!;

  it("reads all 96 blocks of the delivery day and skips the summary rows", () => {
    expect(day.date).toBe("2026-11-05");
    expect(day.blocks).toHaveLength(96);
    expect(day.blocks[0]).toMatchObject({ block: 1, startMin: 0, mcpRsPerMwh: 7000.69, mcvMw: 4271 });
    expect(day.blocks[95].startMin).toBe(23 * 60 + 45);
    expect(new Set(day.blocks.map((b) => b.block)).size).toBe(96);
  });

  it("matches the page's own published average MCP", () => {
    const avg = day.blocks.reduce((s, b) => s + b.mcpRsPerMwh, 0) / 96;
    expect(avg).toBeCloseTo(5158.67, 1); // "Avg" row on the page
  });

  it("returns null rather than partial data when blocks are missing or the layout changes", () => {
    const cut = FIXTURE.replace(/\{\\"date\\":\\"05-11-2026\\",\\"period\\":\\"12:00 - 12:15\\"[^{}]*\},/, "");
    expect(parseIexDamSnapshot(cut)).toBeNull();
    expect(parseIexDamSnapshot("<html>maintenance</html>")).toBeNull();
    expect(parseIexDamSnapshot(FIXTURE.replace(/\\"mcp\\":\\"7000.69\\"/, '\\"mcp\\":\\"abc\\"'))).toBeNull();
  });

  it("summarises the day: min, max and the cheapest four-hour window", () => {
    const s = summariseMarketDay(day, 4);
    const p = day.blocks.map((b) => b.mcpRsPerMwh / 1000);
    expect(s.min.rsPerKwh).toBe(Math.min(...p));
    expect(s.max.rsPerKwh).toBe(Math.max(...p));
    expect(s.cheapest.endMin - s.cheapest.startMin).toBe(240);
    // Brute force the cheapest window.
    let best = Infinity;
    for (let i = 0; i + 16 <= 96; i++) best = Math.min(best, p.slice(i, i + 16).reduce((a, b) => a + b, 0) / 16);
    expect(s.cheapest.avgRsPerKwh).toBeCloseTo(best, 9);
    expect(s.dearest.avgRsPerKwh).toBeGreaterThanOrEqual(s.cheapest.avgRsPerKwh);
  });
});
