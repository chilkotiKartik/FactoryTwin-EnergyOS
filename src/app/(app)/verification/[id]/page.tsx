import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { getVerificationReport, type Verification } from "@/server/services/verification";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui/page-header";
import { VerificationView } from "@/components/verification/verification-view";
import { PrintButton } from "@/components/verification/actions";
import { Evidence } from "@/components/ui/badge";
import { localTime } from "@/lib/format";

export const metadata: Metadata = { title: "Verification report" };

export default async function ReportPage(props: PageProps<"/verification/[id]">) {
  const { id } = await props.params;
  const actor = await requireActor();
  const db = getDb();
  let r;
  try {
    r = await getVerificationReport(db, actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const author = r.createdBy ? await db.query.users.findFirst({ where: eq(users.id, r.createdBy), columns: { name: true } }) : null;
  return (
    <div className="print-full">
      <PageHeader
        title={r.title}
        crumbs={[{ label: actor.factory.name }, { label: "Verification", href: "/verification" }, { label: "Report" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Evidence label={r.evidenceLabel} /> {actor.factory.name} · saved {localTime(r.createdAt, actor.factory.timeZone, true)}
            {author ? ` by ${author.name}` : ""} · stored snapshot, does not change if data is edited later
          </span>
        }
        actions={<PrintButton />}
      />
      <VerificationView v={r.metrics as unknown as Verification} tz={actor.factory.timeZone} />
    </div>
  );
}
