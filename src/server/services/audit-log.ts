import { and, desc, eq, like, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { Actor } from "../context";
import { requirePerm } from "../context";

export async function listAudit(db: DB, actor: Actor, opts: { page?: number; pageSize?: number; action?: string; entityId?: string }) {
  requirePerm(actor, "audit.view");
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const where = and(
    eq(auditEvents.factoryId, actor.factory.id),
    opts.action ? like(auditEvents.action, `${opts.action.replace(/[%_]/g, "")}%`) : undefined,
    opts.entityId ? eq(auditEvents.entityId, opts.entityId) : undefined,
  );
  const [rows, total] = await Promise.all([
    db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ c: sql<number>`count(*)` }).from(auditEvents).where(where),
  ]);
  return { rows, total: Number(total[0]?.c ?? 0), page, pageSize };
}
