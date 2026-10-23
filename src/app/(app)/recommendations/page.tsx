import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { listRecommendations } from "@/server/services/recommendations";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/recommendations/status-badge";
import { inr, localTime, pct } from "@/lib/format";
import type { Predicted } from "@/components/optimizer/schedule-views";

export const metadata: Metadata = { title: "Approvals" };

export default async function RecommendationsPage() {
  const actor = await requireActor();
  const rows = await listRecommendations(getDb(), actor);
  const tz = actor.factory.timeZone;
  return (
    <>
      <PageHeader
        title="Approvals"
        crumbs={[{ label: actor.factory.name }, { label: "Approvals" }]}
        description="Every schedule recommendation and the decision taken on it. Predicted figures are modelled; achieved savings appear only under Verification."
      />
      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No recommendations yet" action={<Button asChild><Link href="/optimizer">Open the optimiser</Link></Button>}>
            Run the optimiser on a production plan. A recommendation appears here when it finds a cheaper feasible schedule.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Recommendation</Th>
                <Th>Plan day</Th>
                <Th>Status</Th>
                <Th align="right">Predicted cost change</Th>
                <Th align="right">Predicted energy change</Th>
                <Th>Created</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.predicted as unknown as Predicted;
                return (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/recommendations/${r.id}`} className="font-medium text-blue hover:underline">
                        v{r.version}
                      </Link>
                      <span className="ml-2 text-[12px] text-ink-3">{r.summary}</span>
                    </Td>
                    <Td>{r.planDate}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td align="right">
                      {inr(p.delta.costPaise)} ({pct(p.delta.costPct)})
                    </Td>
                    <Td align="right">{pct(p.delta.kwhPct)}</Td>
                    <Td className="text-ink-2">{localTime(r.createdAt, tz, true)}</Td>
                    <Td className="text-ink-2">{r.decision ? `${r.decision.name ?? "—"} · ${localTime(r.decision.a.decidedAt, tz, true)}` : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
