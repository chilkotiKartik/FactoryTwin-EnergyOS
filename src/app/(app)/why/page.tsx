import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock3, Factory, Flame, Gauge, IndianRupee, ShieldCheck, Sun, Tablet, Wrench } from "lucide-react";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { selectedDay } from "@/server/day";
import { rangeSummary } from "@/server/services/analytics";
import { listTariffVersions } from "@/server/services/tariffs";
import { DEFAULT_ASSUMPTIONS } from "@/server/services/verification";
import { addDays } from "@/domain/time";
import type { SavingsInput } from "@/domain/savings";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { SavingsCalculator } from "@/components/why/savings-calculator";
import { fmt } from "@/lib/format";

export const metadata: Metadata = { title: "Why EnergyOS" };

type Src = { label: string; href: string };

const EVIDENCE: { icon: typeof Factory; value: string; label: string; why: string; sources: Src[] }[] = [
  {
    icon: Factory,
    value: "5,000+",
    label: "foundry units in India; about 95% are MSMEs, ~7.5 Mt/yr capacity",
    why: "Thousands of small plants with little analyst time: the tool must explain itself and fit a supervisor's day.",
    sources: [
      { label: "BEE SIDHIEE", href: "https://sidhiee.beeindia.gov.in/AboutUs/foundry" },
      { label: "IIF Foundry Frontier", href: "https://indianfoundry.org/upload/pdf/1777965726-FOUNDRY-FRONTIER-Apr-26.pdf" },
    ],
  },
  {
    icon: IndianRupee,
    value: "12–15%",
    label: "of a foundry's production cost is energy",
    why: "Margins are thin; a few percent of energy is real money. (20–30% is quoted for MSMEs in general.)",
    sources: [
      { label: "IIF profile", href: "https://www.foundryinfo-india.org/About_Us/profile_of_indian.aspx" },
      { label: "TERI", href: "https://rkp.teriin.org/public/foreword_docs/Towadrs%20cleaner%20Technologies%20a%20process%20story%20in%20small-scale%20foundries.pdf" },
    ],
  },
  {
    icon: Gauge,
    value: "620 kWh/t",
    label: "CII norm for induction melting; measured Indian plants run 13–21% above it (660–700 kWh/t)",
    why: "A 10–20% gap per tonne is the opportunity. Per-heat expected vs actual shows where it is.",
    sources: [
      { label: "IIF technical paper", href: "https://www.foundryinfo-india.org/tech_section/pdf/57ifctp12.pdf" },
      { label: "Measured foundry", href: "https://cronfa.swansea.ac.uk/Record/cronfa24998/Download/0024998-08122015182331.pdf" },
    ],
  },
  {
    icon: Flame,
    value: "~75%",
    label: "of an open furnace's heat loss is radiation; long holds raise energy use",
    why: "Holding is invisible on a monthly bill but obvious on a 1-minute trace — and usually caused by moulds not being ready.",
    sources: [
      { label: "Foundry Mgmt & Tech", href: "https://www.foundrymag.com/melt-pour/article/21925030/reduce-power-consumption-without-sacrificing-production" },
      { label: "GIFA report", href: "https://www.gifa.com/en/Media_News/News/Reports/Reducing_Energy_Consumption_in_Metal_Melting_Using_Induction_Furnaces_through_Best_Practices_and_Digital_Melt_Process_Data_Analysis" },
    ],
  },
  {
    icon: Sun,
    value: "≥ 20% · 1.2×",
    label: "solar hours at least 20% cheaper; peak at least 1.2× normal, for C&I users above 10 kW (from April 2024)",
    why: "The same melt costs about a third less at noon than in the evening peak, so start times are worth optimising.",
    sources: [
      { label: "Ministry of Power (PIB)", href: "https://pib.gov.in/PressReleasePage.aspx?PRID=1945236" },
      { label: "Mercom", href: "https://mercomindia.com/lower-electricity-tariff-solar-hours" },
    ],
  },
  {
    icon: Clock3,
    value: "varies",
    label: "ToD implementation differs by state; at least one regulator kept its old structure",
    why: "Tariffs must be versioned, labelled and easy to replace with the plant's actual tariff order.",
    sources: [{ label: "Mercom (Uttarakhand)", href: "https://www.mercomindia.com/uttarakhand-regulator-asks-upcl-to-set-solar-non-solar-hours-for-tariffs" }],
  },
];

const ANSWERS: { icon: typeof Factory; title: string; body: string; href: string }[] = [
  { icon: Gauge, title: "See the gap per heat", body: "Meter energy linked to each heat, compared with a robust model of what that charge should take.", href: "/heats" },
  { icon: Flame, title: "Explain it", body: "Holding detected in the trace and tied to the mould that was late — evidence levels, not guesses.", href: "/anomalies" },
  { icon: Clock3, title: "Fix the timing", body: "An exact optimiser moves start times around mould readiness and cheap hours without cutting output.", href: "/optimizer" },
  { icon: ShieldCheck, title: "Decide and prove it", body: "A supervisor approves; the outcome is recorded and verified per tonne against a stated baseline.", href: "/verification" },
  { icon: Tablet, title: "Work on the floor", body: "Tablet entry with Now buttons, offline queue, Hindi and Marathi.", href: "/heats" },
  { icon: Wrench, title: "Never touch the furnace", body: "Advisory only. There is no write path to any equipment.", href: "/evidence" },
];

export default async function WhyPage() {
  const actor = await requireActor();
  const db = getDb();
  const f = actor.factory;
  const { day, days } = await selectedDay(actor);
  const from = day ? addDays(day, -29) : null;
  const [sum, versions] = await Promise.all([day && from ? rangeSummary(db, actor, from, day) : null, listTariffVersions(db, actor)]);
  const tariff = versions[0] ?? null;
  const normalRate = tariff ? tariff.normalRatePaise / 100 : 8;
  const solar = tariff?.periods.find((p) => p.kind === "SOLAR");
  const solarDiscountPct = tariff && solar ? Math.max(0, Math.round(100 * (1 - solar.ratePaise / tariff.normalRatePaise))) : 20;
  const daysWithData = from && day ? days.filter((d) => d >= from && d <= day).length : 0;
  const operatingDaysPerMonth = DEFAULT_ASSUMPTIONS.operatingDaysPerYear / 12;
  const totalKwh = sum?.energyKwh ?? 0;
  const solarSharePct = totalKwh > 0 ? (100 * (sum!.costByKind.SOLAR?.kwh ?? 0)) / totalKwh : 0;
  const hasData = !!sum && daysWithData > 0 && sum.tonnesPoured > 0;

  const initial: SavingsInput = {
    tonnesPerMonth: hasData ? Math.round((sum!.tonnesPoured / daysWithData) * operatingDaysPerMonth) : 150,
    secKwhPerT: hasData && sum!.sec ? Math.round(sum!.sec) : 675,
    holdingPct: hasData && totalKwh > 0 ? Math.round((1000 * sum!.holdingKwh) / totalKwh) / 10 : 3.4,
    holdingRecoverablePct: 80,
    // Conservative: half of the energy still outside solar hours can move.
    shiftablePct: Math.round(Math.max(0, 100 - solarSharePct) / 2 / 5) * 5,
    normalRate,
    solarDiscountPct,
    emissionFactor: f.emissionFactor,
    capexRupees: DEFAULT_ASSUMPTIONS.capexInr,
    opexRupeesPerMonth: Math.round(DEFAULT_ASSUMPTIONS.opexInrPerYear / 12),
  };
  const basis = hasData
    ? `${f.name}, last ${daysWithData} production day${daysWithData === 1 ? "" : "s"} to ${day} (${f.isSimulation ? "SIMULATED data" : "factory data"}), scaled to ${fmt(operatingDaysPerMonth, 0)} operating days a month; tariff "${tariff?.name ?? "default"}"; 80% of holding recoverable and moving half of the non-solar energy are assumptions`
    : "illustrative defaults (no production data yet in this factory)";

  return (
    <>
      <PageHeader
        title="Why EnergyOS"
        crumbs={[{ label: f.name }, { label: "Why EnergyOS" }]}
        description="What the problem is, how big it is, and why each part of this product exists — with the source for every number. Figures from different sources disagree; where they do, both are shown."
      />

      <section className="relative mb-6 overflow-hidden rounded-3xl border border-line bg-shell p-6 text-shell-ink sm:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(36rem_18rem_at_0%_0%,rgb(99_102_241/0.35),transparent_60%),radial-gradient(30rem_16rem_at_100%_100%,rgb(6_182_212/0.25),transparent_60%)]" />
        <div className="relative max-w-3xl">
          <Badge className="border-white/15 bg-white/10 text-white">The problem in one line</Badge>
          <p className="mt-4 text-[22px] font-semibold leading-snug tracking-tight text-white sm:text-[28px]">
            A monthly bill shows <span className="brand-text">how much</span> a foundry spent on power — never <span className="brand-text">which heat, which wait, or which hour</span> made a tonne expensive.
          </p>
          <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-shell-ink">
            EnergyOS links one-minute meter data to every heat, finds the energy lost holding metal while moulds catch up, and proposes start times that remove the wait and land melting in cheaper hours — for a supervisor to approve, then verifies the result per tonne.
          </p>
        </div>
      </section>

      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-3">The evidence</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {EVIDENCE.map((e) => {
          const Icon = e.icon;
          return (
            <article key={e.value} className="card flex flex-col rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-[var(--brand-2)]">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="num text-[24px] font-semibold tracking-tight">{e.value}</span>
              </div>
              <p className="mt-3 text-[13.5px] font-medium leading-snug text-ink">{e.label}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{e.why}</p>
              <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-4">
                {e.sources.map((s) => (
                  <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[12px] font-medium text-blue hover:underline">
                    {s.label}
                    <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <Panel className="mb-8">
        <PanelHeader title="What could better timing be worth here?" subtitle="Starts from this factory's own last 30 days. Move any slider; nothing is saved." />
        <PanelBody>
          <SavingsCalculator initial={initial} basis={basis} />
        </PanelBody>
      </Panel>

      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-3">How the product answers it</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ANSWERS.map((a, i) => {
          const Icon = a.icon;
          return (
            <Link key={a.title} href={a.href} className="card group flex gap-4 rounded-2xl border border-line bg-surface p-4 transition-transform hover:-translate-y-0.5">
              <span className="brand-gradient grid size-10 shrink-0 place-items-center rounded-xl text-white">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="num text-[11px] font-semibold text-ink-3">0{i + 1}</span>
                <span className="block text-[14px] font-semibold text-ink">{a.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">{a.body}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="What we deliberately left out" />
          <PanelBody className="space-y-2 text-[13.5px] leading-relaxed text-ink-2">
            <p>
              <span className="font-medium text-ink">Container packaging.</span> It is a plain Node.js app (<code className="font-mono text-[12.5px]">pnpm build && pnpm start</code>); a container adds nothing a small plant needs.
            </p>
            <p>
              <span className="font-medium text-ink">A multi-furnace scheduler.</span> The data model is one furnace per factory; code no screen can reach is a cost with no benefit. It can return with a multi-furnace data model.
            </p>
            <p>
              <span className="font-medium text-ink">Machine control.</span> Advice only. A wrong command to a furnace is a safety risk no saving justifies.
            </p>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="What is not claimed" />
          <PanelBody className="space-y-2 text-[13.5px] leading-relaxed text-ink-2">
            <p>No field trial yet: every number in the demo factory is synthetic and labelled so.</p>
            <p>
              The grid factor {f.emissionFactor} kg CO₂/kWh comes from an earlier CEA database version; CEA published{" "}
              <a className="font-medium text-blue hover:underline" href="https://cea.nic.in/wp-content/uploads/baseline/2026/09/User_Guide__Version_22.0.pdf" target="_blank" rel="noopener noreferrer">
                Version 22.0
              </a>{" "}
              (Aug 2026). Update it in Factory settings before quoting avoided CO₂.
            </p>
            <p>Hindi and Marathi text is a first draft that needs review by a native speaker from the plant.</p>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
