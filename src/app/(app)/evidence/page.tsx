import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { getDb } from "@/db/client";
import { productionPlans, recommendations } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { availableDays, rangeSummary } from "@/server/services/analytics";
import { AS_RUN_DATE, DECK_REFERENCE } from "@/domain/scenarios";
import { SOURCES } from "@/domain/evidence";
import { ANOMALY_RULE_TEXT } from "@/domain/anomaly";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Evidence } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import type { Predicted } from "@/components/optimizer/schedule-views";
import { fmt, hhmm, inr } from "@/lib/format";

export const metadata: Metadata = { title: "Evidence & assumptions" };

const LABELS = [
  ["MEASURED", "Observed by a genuine meter or documented field dataset. Only readings ingested with a meter token, or a CSV declared as a genuine meter export in a non-simulation factory, carry this label."],
  ["SIMULATED", "Produced by the deterministic scenario engine. Every figure derived from synthetic data inherits this label."],
  ["MODELLED", "A projection: optimiser predictions, expected-energy estimates, payback."],
  ["ASSUMPTION", "A configuration or business-case choice: tariff windows, emission factor, capex, operating days."],
  ["VERIFIED", "Supported by an identified external source (e.g. a tariff order). Requires a source note."],
] as const;

const ASSUMPTIONS = [
  "Tariff: ₹8.00/kWh normal; solar window 09:00–17:00 at 20% below normal (₹6.40); evening peak 18:00–22:00 at 1.20× (₹9.60). Illustrative, consistent with the 2023 ToD rules; not a specific state tariff order.",
  "Furnace: 500 kg capacity, 550 kW rated, about 35 minutes to melt a warm charge, +5 minutes after a cold start (idle > 60 min), 10-minute turnaround between heats.",
  "Holding at temperature draws about 60 kW. The deck states the total, not the power, so this is a modelling choice; it is editable in Factory settings.",
  "Grid emission factor 0.727 kg CO₂/kWh (CEA v20.0, FY 2023-24, as cited in the deck). A newer CEA version exists; update it in Settings before relying on it.",
  "Payback: ₹0.9 lakh capex, ₹5,000/month opex, 300 operating days per year, 100% realisation by default. All editable on the Verification page.",
  "Optimiser objective: lowest energy cost, then least holding, then earliest finish. Heat sequence and charges are fixed; start times move on a 5-minute grid.",
];

const LIMITS = [
  "No field validation. Every number in the Foundry A workspace comes from the scenario engine.",
  "The expected-energy model is linear (tonnes, cold start, holding minutes). It does not model charge mix, superheat, lining wear or power factor.",
  "Holding is detected from the power trace (plateau after melting); a meter with a coarse interval will blur it.",
  "The optimiser is exact for its stated model, not a guarantee of the best schedule for the real plant. It does not reorder heats or model crane, ladle or labour limits.",
  "Avoided CO₂ counts only avoided kWh × grid average factor. Load shifted into solar hours is not credited with extra CO₂ benefit.",
  "Approvals change records only. EnergyOS sends no command to any equipment and has no write connection to plant systems.",
  "SQLite storage suits a single-site pilot; a multi-site deployment should move to PostgreSQL (the schema is portable through Drizzle).",
];

export default async function EvidencePage() {
  const actor = await requireActor();
  const db = getDb();
  let compare: { k: string; deck: string; app: string; label: string }[] = [];
  if (actor.factory.isSimulation && (await availableDays(db, actor)).includes(AS_RUN_DATE)) {
    const s = await rangeSummary(db, actor, AS_RUN_DATE, AS_RUN_DATE);
    const h7 = s.heats.find((h) => h.heatNo === "H07");
    const plan = await db.query.productionPlans.findFirst({ where: eq(productionPlans.factoryId, actor.factory.id), orderBy: desc(productionPlans.planDate) });
    const rec = plan ? await db.query.recommendations.findFirst({ where: and(eq(recommendations.planId, plan.id)), orderBy: desc(recommendations.version) }) : null;
    const p = rec?.predicted as unknown as Predicted | undefined;
    const solarShare = s.energyKwh > 0 ? (100 * (s.costByKind.SOLAR?.kwh ?? 0)) / s.energyKwh : null;
    compare = [
      { k: "As-run energy", deck: `${fmt(DECK_REFERENCE.baselineKwh)} kWh`, app: `${fmt(s.energyKwh, 1)} kWh`, label: "SIMULATED" },
      { k: "As-run SEC", deck: `${DECK_REFERENCE.baselineSec} kWh/t`, app: `${fmt(s.sec, 1)} kWh/t`, label: "SIMULATED" },
      { k: "As-run cost per tonne", deck: `₹${fmt(DECK_REFERENCE.baselineCostPerTonne)}`, app: inr(s.costPerTonnePaise), label: "SIMULATED" },
      { k: "Total holding", deck: `${DECK_REFERENCE.totalHoldMinutes} min`, app: `${fmt(s.holdingMinutes)} min`, label: "SIMULATED" },
      { k: "Heat 07 actual vs expected", deck: `${DECK_REFERENCE.heat07ActualKwh} vs ${DECK_REFERENCE.heat07ExpectedKwh} kWh`, app: h7 ? `${fmt(h7.meterKwh, 1)} vs ${fmt(h7.expectedKwh, 1)} kWh` : "—", label: "SIMULATED" },
      { k: "Share of furnace energy in solar window", deck: `${DECK_REFERENCE.solarShareBaselinePct}%`, app: solarShare === null ? "—" : `${fmt(solarShare, 0)}%`, label: "SIMULATED" },
      ...(p
        ? [
            { k: "Recommended first start", deck: DECK_REFERENCE.recommendedStart, app: hhmm(p.recommended.firstStartMin), label: "MODELLED" },
            { k: "Recommended last tap", deck: DECK_REFERENCE.lastTapRecommended, app: hhmm(p.recommended.lastTapMin), label: "MODELLED" },
            { k: "Predicted SEC change", deck: `${DECK_REFERENCE.secChangePct}%`, app: p.current.sec && p.recommended.sec ? `${fmt((100 * (p.recommended.sec - p.current.sec)) / p.current.sec, 1)}%` : "—", label: "MODELLED" },
            { k: "Predicted cost/t change", deck: `${DECK_REFERENCE.costPerTonneChangePct}%`, app: p.current.costPerTonnePaise && p.recommended.costPerTonnePaise ? `${fmt((100 * (p.recommended.costPerTonnePaise - p.current.costPerTonnePaise)) / p.current.costPerTonnePaise, 1)}%` : "—", label: "MODELLED" },
          ]
        : []),
    ];
  }
  return (
    <>
      <PageHeader
        title="Evidence & assumptions"
        crumbs={[{ label: actor.factory.name }, { label: "Evidence & assumptions" }]}
        description="What each label means, which sources the numbers rest on, what is assumed, and what the product does not claim."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Evidence labels" />
          <PanelBody className="flex flex-col gap-3 text-[13px]">
            {LABELS.map(([l, t]) => (
              <div key={l} className="flex gap-3">
                <span className="w-28 shrink-0">
                  <Evidence label={l} />
                </span>
                <p className="text-ink-2">{t}</p>
              </div>
            ))}
            <p className="text-ink-3">A derived figure is MEASURED only if every input is MEASURED. Any synthetic input makes it SIMULATED; manual or unverified imports make it UNVERIFIED.</p>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Sources" />
          <PanelBody>
            <ul className="flex flex-col gap-3 text-[13px]">
              {SOURCES.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-blue hover:underline">
                    {s.title} <ExternalLink className="size-3" aria-hidden />
                  </a>
                  <p className="text-ink-3">{s.note}</p>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
        {compare.length ? (
          <Panel className="xl:col-span-2">
            <PanelHeader title="Deck reference vs this app" subtitle="The deck's figures are illustrative. The app recomputes them from its own synthetic data and model, so small differences are expected and shown, not hidden." />
            <Table>
              <thead>
                <tr>
                  <Th>Figure</Th>
                  <Th align="right">Deck</Th>
                  <Th align="right">Computed here</Th>
                  <Th>Label</Th>
                </tr>
              </thead>
              <tbody>
                {compare.map((c) => (
                  <tr key={c.k}>
                    <Td className="text-ink-2">{c.k}</Td>
                    <Td align="right">{c.deck}</Td>
                    <Td align="right" className="font-medium">
                      {c.app}
                    </Td>
                    <Td>
                      <Evidence label={c.label} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ) : null}
        <Panel>
          <PanelHeader title="Assumptions" />
          <PanelBody>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] text-ink-2">
              {ASSUMPTIONS.map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li>Anomaly rule: {ANOMALY_RULE_TEXT}</li>
            </ul>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Limitations" />
          <PanelBody>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] text-ink-2">
              {LIMITS.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
