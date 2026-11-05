import { and, desc, eq, isNotNull, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { anomalies, heats, recommendations } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { dataMode } from "@/server/services/analytics";
import { selectedDay } from "@/server/day";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { can } from "@/server/permissions";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { RegisterServiceWorker } from "@/components/offline/register-sw";
import { CommandPalette } from "@/components/shell/command-palette";
import { getTheme } from "@/server/theme";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.mustChangePassword) redirect("/account?first=1");
  const db = getDb();
  const [theme, mode, { day, days }, pending, high] = await Promise.all([
    getTheme(),
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
    <OfflineProvider userId={actor.userId} factoryId={actor.factory.id} timeZone={actor.factory.timeZone}>
    <RegisterServiceWorker />
    <CommandPalette canSeeAudit={can(actor.role, "audit.view")} isSimulation={actor.factory.isSimulation} />
    <div className="min-h-dvh lg:pl-64">
      <Sidebar
        factoryName={actor.factory.name}
        isSimulation={actor.factory.isSimulation}
        pendingApprovals={pending.length}
        canSeeAudit={can(actor.role, "audit.view")}
      />
      <div className="flex min-h-dvh flex-col">
        {actor.factory.isSimulation ? (
          <div role="note" className="no-print sticky top-0 z-30 flex items-center justify-center gap-2 bg-[#5b21b6] px-3 py-1 text-center text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white">
            <span className="sm:hidden">Simulation · synthetic data</span>
            <span className="hidden sm:inline">Simulation — synthetic data — not field validation</span>
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
          theme={theme}
        />
        <main id="main" className="print-full mx-auto w-full max-w-[1480px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10">
          <OfflineBanner />
          {children}
        </main>
      </div>
    </div>
    </OfflineProvider>
  );
}
