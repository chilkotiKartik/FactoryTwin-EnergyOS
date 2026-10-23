import { and, desc, eq, isNotNull, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { anomalies, heats, recommendations } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { dataMode } from "@/server/services/analytics";
import { selectedDay } from "@/server/day";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { can } from "@/server/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const db = getDb();
  const [mode, { day, days }, pending, high] = await Promise.all([
    dataMode(db, actor),
    selectedDay(actor),
    db
      .select({ id: recommendations.id, summary: recommendations.summary, version: recommendations.version, createdAt: recommendations.createdAt })
      .from(recommendations)
      .where(and(eq(recommendations.factoryId, actor.factory.id), eq(recommendations.status, "PENDING")))
      .orderBy(desc(recommendations.createdAt))
      .limit(5),
    db
      .select({ id: anomalies.id, heatId: anomalies.heatId, explanation: anomalies.explanation, heatNo: heats.heatNo, dayDate: heats.dayDate })
      .from(anomalies)
      .innerJoin(heats, eq(heats.id, anomalies.heatId))
      .where(and(eq(anomalies.factoryId, actor.factory.id), eq(anomalies.status, "OPEN"), isNotNull(anomalies.severity), inArray(anomalies.severity, ["HIGH"])))
      .orderBy(desc(heats.startAt))
      .limit(5),
  ]);
  const notifications = [
    ...pending.map((p) => ({ id: p.id, kind: "approval" as const, title: `Recommendation v${p.version} awaits a decision`, body: p.summary, href: `/recommendations/${p.id}` })),
    ...high.map((a) => ({ id: a.id, kind: "anomaly" as const, title: `${a.heatNo} on ${a.dayDate}: high energy variance`, body: a.explanation, href: `/heats/${a.heatId}` })),
  ];
  return (
    <div className="min-h-dvh lg:pl-60">
      <Sidebar
        factoryName={actor.factory.name}
        isSimulation={actor.factory.isSimulation}
        pendingApprovals={pending.length}
        canSeeAudit={can(actor.role, "audit.view")}
      />
      <div className="flex min-h-dvh flex-col">
        {actor.factory.isSimulation ? (
          <div role="note" className="no-print sticky top-0 z-30 flex items-center justify-center gap-2 bg-violet px-3 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
            Simulation — synthetic data — not field validation
          </div>
        ) : null}
        <Topbar
          actor={{ name: actor.name, email: actor.email, role: actor.role }}
          factories={actor.memberships}
          activeFactoryId={actor.factory.id}
          mode={mode}
          day={day}
          days={days}
          timeZone={actor.factory.timeZone}
          notifications={notifications}
          sticky={!actor.factory.isSimulation}
        />
        <main id="main" className="print-full mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
