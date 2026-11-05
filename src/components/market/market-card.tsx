import { ArrowUpRight, PlugZap } from "lucide-react";
import { IEX_DAM_URL, summariseMarketDay } from "@/domain/iex";
import type { latestMarketDay } from "@/server/services/market";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Photo } from "@/components/ui/photo";
import { dayLabel, fmt, hhmm, localTime } from "@/lib/format";
import { requestNow } from "@/lib/clock";
import { MarketCurve } from "./market-curve";
import { RefreshMarket } from "./refresh-market";

type Day = NonNullable<Awaited<ReturnType<typeof latestMarketDay>>>;

const STALE_MS = 6 * 3600_000;

/**
 * Live India power-market view: today's IEX day-ahead prices, the cheapest and
 * dearest hours, and how they line up with the plant's own solar-hour tariff window.
 */
export function MarketCard({ day, solar, timeZone, feedOn }: { day: Day | null; solar: { startMin: number; endMin: number } | null; timeZone: string; feedOn: boolean }) {
  if (!day) {
    return (
      <Panel className="mb-5">
        <PanelHeader title="India power market today" subtitle="IEX Day-Ahead Market, 96 fifteen-minute prices" actions={feedOn ? <RefreshMarket /> : null} />
        <EmptyState icon={PlugZap} title={feedOn ? "Waiting for the first price update" : "Live market feed is off"}>
          {feedOn
            ? "The server reads IEX's public day-ahead prices shortly after it starts and every 30 minutes. If this stays empty, check that the server can reach www.iexindia.com."
            : "Set INDIA_MARKET_FEED=iex (or remove it) to show today's exchange prices here."}
        </EmptyState>
      </Panel>
    );
  }
  const s = summariseMarketDay(day, 4);
  const stale = requestNow() - day.fetchedAt > STALE_MS;
  const inSolar = solar !== null && s.cheapest.startMin >= solar.startMin && s.cheapest.endMin <= solar.endMin;
  const overlapsSolar = solar !== null && s.cheapest.startMin < solar.endMin && s.cheapest.endMin > solar.startMin;
  const spread = s.dearest.avgRsPerKwh - s.cheapest.avgRsPerKwh;
  const stats = [
    { k: "Day average", v: `₹${fmt(s.avgRsPerKwh, 2)}`, sub: "per kWh, 96 blocks" },
    { k: "Cheapest 4 hours", v: `${hhmm(s.cheapest.startMin)}–${hhmm(s.cheapest.endMin % 1440)}`, sub: `₹${fmt(s.cheapest.avgRsPerKwh, 2)}/kWh average`, tone: "text-teal" },
    { k: "Dearest 4 hours", v: `${hhmm(s.dearest.startMin)}–${hhmm(s.dearest.endMin % 1440)}`, sub: `₹${fmt(s.dearest.avgRsPerKwh, 2)}/kWh average`, tone: "text-red" },
    { k: "Spread", v: `₹${fmt(spread, 2)}`, sub: "per kWh, dearest vs cheapest" },
  ];
  return (
    <Panel className="mb-5 overflow-hidden">
      <PanelHeader
        title="India power market today"
        subtitle={`IEX Day-Ahead Market · delivery ${dayLabel(day.date)} · read ${localTime(day.fetchedAt, timeZone, true)} IST`}
        actions={
          <>
            <Badge tone={stale ? "amber" : "teal"}>{stale ? "Not updated recently" : "Live data"}</Badge>
            <RefreshMarket />
          </>
        }
      />
      <div className="grid xl:grid-cols-[1fr_260px]">
        <PanelBody>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {stats.map((x) => (
              <div key={x.k}>
                <dt className="text-[12px] text-ink-3">{x.k}</dt>
                <dd className={`num mt-0.5 text-[20px] font-semibold leading-tight tracking-tight ${x.tone ?? "text-ink"}`}>{x.v}</dd>
                <dd className="text-[11.5px] text-ink-3">{x.sub}</dd>
              </div>
            ))}
          </dl>
          <MarketCurve points={day.blocks.map((b) => ({ m: b.startMin, rs: b.mcpRsPerMwh / 1000, mw: b.mcvMw }))} cheapest={s.cheapest} dearest={s.dearest} solar={solar} />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-teal-soft ring-1 ring-teal/50" aria-hidden /> cheapest 4 h
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-red-soft ring-1 ring-red/40" aria-hidden /> dearest 4 h
            </span>
            {solar ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm bg-[var(--band-solar)] ring-1 ring-amber-mark/40" aria-hidden /> your tariff&apos;s solar window
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            {solar
              ? inSolar
                ? `Today India's cheapest exchange hours fall inside your tariff's solar window (${hhmm(solar.startMin)}–${hhmm(solar.endMin)}). Melting then is cheap for the grid as well as for you.`
                : overlapsSolar
                  ? `Today's cheapest exchange hours overlap your tariff's solar window (${hhmm(solar.startMin)}–${hhmm(solar.endMin)}).`
                  : `Today's cheapest exchange hours fall outside your tariff's solar window (${hhmm(solar.startMin)}–${hhmm(solar.endMin)}). Your bill follows your tariff, not the exchange.`
              : "Your tariff has no solar window; your bill follows your tariff order, not the exchange."}{" "}
            Exchange prices are wholesale prices, not your bill.
          </p>
          <p className="mt-2 text-[11.5px] text-ink-3">
            Source:{" "}
            <a href={IEX_DAM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-blue hover:underline">
              Indian Energy Exchange, Day-Ahead Market snapshot <ArrowUpRight className="size-3" aria-hidden />
            </a>{" "}
            · unconstrained market clearing price (MCP), public data, read by the server at most every 30 minutes.
          </p>
        </PanelBody>
        <Photo name="gridTamilNadu" credit="overlay" className="hidden min-h-72 border-l border-line xl:block" />
      </div>
    </Panel>
  );
}
