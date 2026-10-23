import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { can, ROLE_LABEL } from "@/server/permissions";
import { getSettings } from "@/server/services/settings";
import { listMeters } from "@/server/services/meters";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { IngestToken, SettingsForm } from "@/components/settings/settings-form";

export const metadata: Metadata = { title: "Factory settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  const db = getDb();
  const [{ factory: f, furnace, team }, meters] = await Promise.all([getSettings(db, actor), listMeters(db, actor)]);
  const canConfigure = can(actor.role, "factory.configure");
  return (
    <>
      <PageHeader title="Factory settings" crumbs={[{ label: f.name }, { label: "Settings" }]} description="Process parameters used by analysis and the optimiser. Changes are audited and make pending recommendations stale on their next check." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel>
          <PanelHeader title={`${f.name} · ${furnace.name}`} subtitle={`${f.code} · ${f.timeZone}${f.isSimulation ? " · simulation factory" : ""}`} />
          <PanelBody>
            <SettingsForm
              canEdit={canConfigure}
              initial={{
                holdingKw: f.holdingKw,
                emissionFactor: f.emissionFactor,
                emissionFactorSource: f.emissionFactorSource,
                turnaroundMinutes: f.turnaroundMinutes,
                coldGapMinutes: f.coldGapMinutes,
                coldExtraMinutes: f.coldExtraMinutes,
                maxHoldMinutes: f.maxHoldMinutes,
                minCompletenessPct: Math.round(f.minCompleteness * 1000) / 10,
                gridMinutes: f.gridMinutes,
                capacityKg: furnace.capacityKg,
                ratedKw: furnace.ratedKw,
                nominalMeltMinutes: furnace.nominalMeltMinutes,
                availableFromMin: furnace.availableFromMin,
                availableToMin: furnace.availableToMin,
                maxHeatsPerDay: furnace.maxHeatsPerDay,
              }}
            />
          </PanelBody>
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader title="Team" subtitle="Roles are enforced on the server for every action." />
            <PanelBody>
              <ul className="flex flex-col gap-2 text-[13px]">
                {team.map((t) => (
                  <li key={t.email} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{t.name}</span> <span className="text-ink-3">{t.email}</span>
                    </span>
                    <Badge>{ROLE_LABEL[t.role]}</Badge>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Meter connection (read-only)" subtitle="Meters push readings in; EnergyOS never writes to equipment." />
            <PanelBody className="flex flex-col gap-4 text-[13px]">
              {meters.map((m) => (
                <div key={m.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{m.name}</span>
                    <Badge tone={m.ingestTokenHash ? "teal" : "neutral"}>{m.ingestTokenHash ? "token issued" : "no token"}</Badge>
                  </div>
                  {f.isSimulation ? (
                    <p className="text-ink-3">Live ingest is disabled in a simulation factory so synthetic and measured data never mix.</p>
                  ) : canConfigure ? (
                    <IngestToken meterId={m.id} hasToken={Boolean(m.ingestTokenHash)} />
                  ) : null}
                </div>
              ))}
              <div>
                <p className="mb-1 font-medium">Push format</p>
                <pre className="overflow-x-auto rounded-md bg-shell p-3 font-mono text-[11px] leading-relaxed text-shell-ink">{`POST /api/ingest
Authorization: Bearer eos_…
Content-Type: application/json

{"readings":[{"timestamp":"2026-10-22T09:00:00+05:30",
  "power_kw":512.4,"energy_kwh":8.54}]}`}</pre>
                <p className="mt-1 text-ink-3">Readings must carry a time-zone offset and align to the meter interval. The workspace shows LIVE only while measured readings keep arriving.</p>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
