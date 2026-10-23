import type { Metadata } from "next";
import { requestNow } from "@/lib/clock";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { listTariffVersions } from "@/server/services/tariffs";
import { rateAtMinute, type TariffVersion } from "@/domain/tariff";
import { localDate } from "@/domain/time";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge, Evidence } from "@/components/ui/badge";
import { RatePreview, TariffForm } from "@/components/tariffs/tariff-form";
import { hhmm, localTime } from "@/lib/format";

export const metadata: Metadata = { title: "Tariffs" };

const FILL: Record<string, string> = { SOLAR: "var(--band-solar)", PEAK: "var(--band-peak)", OFFPEAK: "var(--band-offpeak)", NORMAL: "var(--surface-3)" };

function segments(v: TariffVersion) {
  const out: { s: number; e: number; kind: string; label: string; rate: number }[] = [];
  let cur = rateAtMinute(v, 0);
  let s = 0;
  for (let m = 1; m <= 1440; m++) {
    const r = m < 1440 ? rateAtMinute(v, m) : null;
    if (!r || r.label !== cur.label || r.ratePaise !== cur.ratePaise) {
      out.push({ s, e: m, kind: cur.kind, label: cur.label, rate: cur.ratePaise });
      if (r) {
        cur = r;
        s = m;
      }
    }
  }
  return out;
}

function DayStrip({ v }: { v: TariffVersion }) {
  const segs = segments(v);
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-md border border-line" role="img" aria-label={`Rates over the day: ${segs.map((x) => `${hhmm(x.s)}–${hhmm(x.e)} ₹${(x.rate / 100).toFixed(2)}`).join(", ")}`}>
        {segs.map((x, i) => (
          <div key={i} className="num flex items-center justify-center border-r border-surface text-[11px] font-medium text-ink-2 last:border-r-0" style={{ width: `${((x.e - x.s) / 1440) * 100}%`, background: FILL[x.kind] }} title={`${x.label} ${hhmm(x.s)}–${hhmm(x.e)} ₹${(x.rate / 100).toFixed(2)}/kWh`}>
            {x.e - x.s >= 120 ? `₹${(x.rate / 100).toFixed(2)}` : ""}
          </div>
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}:00</span>
        ))}
      </div>
    </div>
  );
}

export default async function TariffsPage() {
  const actor = await requireActor();
  const tz = actor.factory.timeZone;
  const versions = await listTariffVersions(getDb(), actor);
  const latest = versions[0];
  const now = requestNow();
  const inForce = versions.find((v) => v.effectiveFrom <= now);
  const tomorrow = localDate(now + 86400_000, tz);

  return (
    <>
      <PageHeader
        title="Tariffs"
        crumbs={[{ label: actor.factory.name }, { label: "Tariffs" }]}
        description="Time-of-day electricity rates. Every change creates a new version; costs for past readings always use the version that was in force at the time."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-4">
          {versions.map((v) => (
            <Panel key={v.id}>
              <PanelHeader
                title={`v${v.version} · ${v.name}`}
                subtitle={`Effective from ${localTime(v.effectiveFrom, tz, true)} · created ${localTime(v.createdAt, tz, true)}${v.by ? ` by ${v.by}` : ""}`}
                actions={
                  <>
                    {v.id === inForce?.id ? <Badge tone="teal">in force</Badge> : v.effectiveFrom > now ? <Badge tone="blue">scheduled</Badge> : <Badge>superseded</Badge>}
                    <Evidence label={v.evidence} />
                  </>
                }
              />
              <PanelBody className="flex flex-col gap-3">
                <DayStrip v={v} />
                <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                  <li className="flex justify-between gap-2 border-b border-line py-1">
                    <span className="text-ink-3">Normal (outside windows)</span>
                    <span className="num">₹{(v.normalRatePaise / 100).toFixed(2)}/kWh</span>
                  </li>
                  {v.periods.map((p, i) => (
                    <li key={i} className="flex justify-between gap-2 border-b border-line py-1">
                      <span className="text-ink-3">
                        {p.label} {hhmm(p.startMin)}–{p.endMin === 1440 ? "24:00" : hhmm(p.endMin)}
                      </span>
                      <span className="num">₹{(p.ratePaise / 100).toFixed(2)}/kWh</span>
                    </li>
                  ))}
                </ul>
                {v.sourceNote ? <p className="text-[12px] text-ink-3">Source: {v.sourceNote}</p> : null}
              </PanelBody>
            </Panel>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader title="Rate at a time" subtitle="Which rate applies to a given minute." />
            <PanelBody>
              <RatePreview defaultValue={`${tomorrow}T18:00`} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="New tariff version" subtitle={can(actor.role, "tariff.write") ? "Starts from the latest version." : "Owners and analysts can add tariff versions."} />
            {can(actor.role, "tariff.write") ? (
              <PanelBody>
                <TariffForm
                  defaultEffective={`${tomorrow}T00:00`}
                  initial={{
                    name: latest ? `${latest.name.replace(/ \(rev \d+\)$/, "")} (rev ${latest.version + 1})` : "Industrial ToD tariff",
                    normalRate: latest ? latest.normalRatePaise / 100 : 8,
                    periods: (latest?.periods ?? []).map((p) => ({ kind: p.kind, label: p.label, start: hhmm(p.startMin), end: p.endMin === 1440 ? "00:00" : hhmm(p.endMin), rate: String(p.ratePaise / 100) })),
                  }}
                />
              </PanelBody>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
