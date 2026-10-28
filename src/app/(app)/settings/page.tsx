import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { getSettings } from "@/server/services/settings";
import { listMeters } from "@/server/services/meters";
import { listTeam } from "@/server/services/team";
import { listAlerts } from "@/server/services/alerts";
import { TeamPanel } from "@/components/team/team-panel";
import { WebhookForm } from "@/components/alerts/alerts-panel";
import { localTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { IngestToken, SettingsForm } from "@/components/settings/settings-form";

export const metadata: Metadata = { title: "Factory settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  const db = getDb();
  const [{ factory: f, furnace }, meters, team, recentAlerts] = await Promise.all([getSettings(db, actor), listMeters(db, actor), listTeam(db, actor), listAlerts(db, actor, 8)]);
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
              <TeamPanel members={team} selfId={actor.userId} canManage={can(actor.role, "team.manage")} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Alerts" subtitle="High anomalies, pending approvals, paused advice and offline meters. Sent as signed JSON to your webhook (for example a WhatsApp or SMS gateway)." />
            <PanelBody className="flex flex-col gap-3 text-[13px]">
              <WebhookForm current={f.alertWebhookUrl} canEdit={canConfigure} />
              {recentAlerts.length ? (
                <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
                  {recentAlerts.map((x) => (
                    <li key={x.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium">{x.title}</span> <span className="text-ink-3">{localTime(x.createdAt, f.timeZone, true)}</span>
                      </span>
                      <Badge tone={x.deliveredAt ? "teal" : x.deliveryError ? "red" : "neutral"} title={x.deliveryError ?? undefined}>
                        {x.deliveredAt ? "sent" : x.deliveryError ? "failed" : "in app"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3">No alerts yet.</p>
              )}
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
                  {m.ingestTokenHash ? (
                    <p className="text-ink-3">
                      Issued {m.ingestTokenIssuedAt ? localTime(m.ingestTokenIssuedAt, f.timeZone, true) : "—"} · last used {m.ingestTokenLastUsedAt ? localTime(m.ingestTokenLastUsedAt, f.timeZone, true) : "never"}
                    </p>
                  ) : null}
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
