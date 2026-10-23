import type { DB } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { Actor } from "./context";

type Tx = Pick<DB, "insert">;

export async function audit(
  db: Tx,
  actor: Pick<Actor, "userId" | "name"> & { factory: { id: string } } | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  factoryId?: string | null,
): Promise<void> {
  await db.insert(auditEvents).values({
    factoryId: factoryId ?? actor?.factory.id ?? null,
    actorId: actor?.userId ?? null,
    actorName: actor?.name ?? "system",
    action,
    entity,
    entityId,
    details,
    createdAt: Date.now(),
  });
}
