import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { SCENARIOS } from "@/domain/scenarios";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { ResetScenarioButton } from "@/components/demo/reset-button";

export const metadata: Metadata = { title: "Scenario control" };

const STEPS = [
  { href: "/dashboard", t: "Dashboard", d: "As-run day: 4,035 kWh, SEC ≈ 673 kWh/t, 138 min holding. The decision loop shows where attention is needed." },
  { href: "/anomalies", t: "Anomaly", d: "Heat 07 used about 13% more than expected. Open it: the trace shows a 45-minute hold waiting for mould set 7." },
  { href: "/optimizer", t: "Optimiser", d: "Run it for tomorrow's plan. It moves the first start to 08:50, removes holding and shifts melting into solar hours, with every constraint re-checked." },
  { href: "/recommendations", t: "Approval", d: "Sign in as the supervisor and approve (or reject with a reason). The analyst account can see but not approve." },
  { href: "/verification", t: "Verification", d: "Record the simulated outcome, compare per tonne against the baseline day, and save the report. Everything stays labelled SIMULATED." },
];

export default async function DemoPage() {
  const actor = await requireActor();
  if (!actor.factory.isSimulation) {
    return (
      <>
        <PageHeader title="Scenario control" crumbs={[{ label: actor.factory.name }, { label: "Scenario control" }]} />
        <Panel>
          <EmptyState icon={FlaskConical} title="Not a simulation factory">
            Scenarios can only be loaded into a simulation factory. Switch to “Foundry A — Kolhapur (synthetic)” in the factory menu.
          </EmptyState>
        </Panel>
      </>
    );
  }
  const canReset = can(actor.role, "demo.reset");
  return (
    <>
      <PageHeader
        title="Scenario control"
        crumbs={[{ label: actor.factory.name }, { label: "Scenario control" }]}
        description="Deterministic synthetic scenarios: the same scenario always produces the same data. Loading one only affects this simulation factory."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid gap-3 md:grid-cols-2">
          {Object.values(SCENARIOS).map((s) => {
            const active = actor.factory.activeScenario === s.key;
            return (
              <Panel key={s.key} className={active ? "border-violet/50 ring-1 ring-violet/30" : ""}>
                <PanelBody className="flex h-full flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[15px] font-semibold">{s.name}</p>
                    {active ? <Badge tone="violet">loaded</Badge> : null}
                  </div>
                  <p className="text-[13px] text-ink-2">{s.summary}</p>
                  <p className="flex-1 text-[12px] text-ink-3">{s.purpose}</p>
                  {canReset ? (
                    <div className="flex justify-end">
                      <ResetScenarioButton scenarioKey={s.key} name={s.name} active={active} />
                    </div>
                  ) : null}
                </PanelBody>
              </Panel>
            );
          })}
        </div>
        <Panel>
          <PanelHeader title="Guided demo (holding-energy anomaly)" subtitle="About three minutes." />
          <PanelBody>
            <ol className="flex flex-col gap-3">
              {STEPS.map((s, i) => (
                <li key={s.href} className="flex gap-3">
                  <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">{i + 1}</span>
                  <div className="text-[13px]">
                    <Link href={s.href} className="font-semibold text-blue hover:underline">
                      {s.t}
                    </Link>
                    <p className="text-ink-2">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            {!canReset ? <p className="mt-3 text-[12px] text-ink-3">Supervisors and owners can load scenarios.</p> : null}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
