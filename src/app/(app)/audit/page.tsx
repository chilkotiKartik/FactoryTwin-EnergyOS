import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { listAudit } from "@/server/services/audit-log";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody } from "@/components/ui/panel";
import { Table, Td, Th } from "@/components/ui/table";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { localTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage(props: PageProps<"/audit">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  if (!can(actor.role, "audit.view")) {
    return (
      <>
        <PageHeader title="Audit log" crumbs={[{ label: actor.factory.name }, { label: "Audit log" }]} />
        <Panel>
          <PanelBody className="text-[14px] text-ink-2">Your role cannot view the audit log.</PanelBody>
        </Panel>
      </>
    );
  }
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const action = typeof sp.action === "string" ? sp.action : "";
  const entity = typeof sp.entity === "string" ? sp.entity : "";
  const res = await listAudit(getDb(), actor, { page, pageSize: 50, action: action || undefined, entityId: entity || undefined });
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const tz = actor.factory.timeZone;
  const link = (p: number) => `/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(entity ? { entity } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader
        title="Audit log"
        crumbs={[{ label: actor.factory.name }, { label: "Audit log" }]}
        description="Append-only record of sign-ins, data changes, imports, analyses, optimiser runs, decisions, outcomes and exports for this factory."
      />
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12px] text-ink-3">
          Action starts with
          <Input name="action" defaultValue={action} placeholder="e.g. recommendation" className="w-56" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-3">
          Entity id
          <Input name="entity" defaultValue={entity} className="w-56" />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {action || entity ? (
          <Link href="/audit" className="px-2 py-2 text-[13px] text-blue hover:underline">
            Clear
          </Link>
        ) : null}
      </form>
      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map((e) => (
              <tr key={e.id} className="align-top">
                <Td className="num text-ink-2">{localTime(e.createdAt, tz, true)}</Td>
                <Td>{e.actorName ?? "system"}</Td>
                <Td className="font-medium">{e.action}</Td>
                <Td className="text-ink-2">
                  {e.entity}
                  {e.entityId ? (
                    <Link href={`/audit?entity=${encodeURIComponent(e.entityId)}`} className="ml-1 font-mono text-[11px] text-blue hover:underline">
                      {e.entityId.slice(0, 14)}
                    </Link>
                  ) : null}
                </Td>
                <Td className="max-w-[520px] whitespace-normal break-words font-mono text-[11px] text-ink-3">{JSON.stringify(e.details).slice(0, 400)}</Td>
              </tr>
            ))}
            {res.rows.length === 0 ? (
              <tr>
                <Td colSpan={5} className="text-ink-3">
                  No events match.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[13px]">
          <span className="text-ink-3">
            {res.total} events · page {page} of {pages}
          </span>
          <div className="flex gap-3">
            {page > 1 ? (
              <Link href={link(page - 1)} className="text-blue hover:underline">
                ← Newer
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={link(page + 1)} className="text-blue hover:underline">
                Older →
              </Link>
            ) : null}
          </div>
        </div>
      </Panel>
    </>
  );
}
