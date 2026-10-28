import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { and, desc, eq, isNotNull, max } from "drizzle-orm";
import type { DB } from "@/db/client";
import { alerts, factories, meterReadings, meters, type AlertKind } from "@/db/schema";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { validation } from "../errors";
import { newId } from "../ids";

type FactoryRow = typeof factories.$inferSelect;

export interface AlertInput {
  kind: AlertKind;
  /** Same key twice in one factory = one alert. */
  key: string;
  title: string;
  body: string;
  href?: string | null;
}

/**
 * Record an alert and, if the factory has a webhook, deliver it. Delivery runs
 * in the background and never fails the caller; its result is stored on the row.
 */
export async function raiseAlert(db: DB, factory: Pick<FactoryRow, "id">, a: AlertInput): Promise<string | null> {
  const id = newId("alr");
  const res = await db
    .insert(alerts)
    .values({ id, factoryId: factory.id, kind: a.kind, dedupeKey: a.key.slice(0, 200), title: a.title.slice(0, 200), body: a.body.slice(0, 2000), href: a.href ?? null })
    .onConflictDoNothing();
  if (res.rowsAffected !== 1) return null;
  void deliverAlert(db, id).catch((e) => console.error("[energyos] alert delivery failed", e));
  return id;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Webhook URLs must be HTTPS to a public host (override with ALLOW_PRIVATE_WEBHOOKS=true for an internal gateway). */
export function checkWebhookUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw validation("Enter a full URL, for example https://hooks.example.com/energyos.");
  }
  const allowPrivate = process.env.ALLOW_PRIVATE_WEBHOOKS === "true";
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) throw validation("The webhook must use HTTPS.");
  if (u.username || u.password) throw validation("Put credentials in the receiving service, not in the URL.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    (isIP(host) === 4 && PRIVATE_V4.some((r) => r.test(host))) ||
    (isIP(host) === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")));
  if (isPrivate && !allowPrivate) throw validation("The webhook must point to a public host.");
  return u.toString();
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export async function deliverAlert(db: DB, alertId: string) {
  const a = await db.query.alerts.findFirst({ where: eq(alerts.id, alertId) });
  if (!a) return;
  const f = await db.query.factories.findFirst({ where: eq(factories.id, a.factoryId) });
  if (!f?.alertWebhookUrl || !f.alertWebhookSecret) return;
  const body = JSON.stringify({
    id: a.id,
    kind: a.kind,
    title: a.title,
    body: a.body,
    path: a.href,
    factory: { id: f.id, code: f.code, name: f.name, simulation: f.isSimulation },
    createdAt: new Date(a.createdAt).toISOString(),
  });
  const ts = String(Math.floor(Date.now() / 1000));
  let error: string | null = null;
  try {
    const url = checkWebhookUrl(f.alertWebhookUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-energyos-timestamp": ts, "x-energyos-signature": signPayload(f.alertWebhookSecret, ts, body) },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "Delivery failed";
  }
  await db.update(alerts).set(error ? { deliveryError: error } : { deliveredAt: Date.now(), deliveryError: null }).where(eq(alerts.id, a.id));
}

export async function listAlerts(db: DB, actor: Actor, limit = 20) {
  requirePerm(actor, "view");
  return db.select().from(alerts).where(eq(alerts.factoryId, actor.factory.id)).orderBy(desc(alerts.createdAt)).limit(limit);
}

/** Set or clear the alert webhook. Returns the signing secret once, when a URL is set. */
export async function setAlertWebhook(db: DB, actor: Actor, rawUrl: string | null): Promise<{ secret: string | null }> {
  requirePerm(actor, "factory.configure");
  const url = rawUrl && rawUrl.trim() ? checkWebhookUrl(rawUrl) : null;
  const secret = url ? `whsec_${randomBytes(24).toString("base64url")}` : null;
  await db.update(factories).set({ alertWebhookUrl: url, alertWebhookSecret: secret }).where(eq(factories.id, actor.factory.id));
  await audit(db, actor, url ? "alerts.webhook_set" : "alerts.webhook_clear", "factory", actor.factory.id, { host: url ? new URL(url).host : null });
  return { secret };
}

export async function sendTestAlert(db: DB, actor: Actor) {
  requirePerm(actor, "factory.configure");
  const id = await raiseAlert(db, actor.factory, { kind: "TEST", key: `test:${Date.now()}`, title: "Test alert from EnergyOS", body: `Sent by ${actor.name}. If you can read this, alert delivery works.`, href: "/settings" });
  if (id) await deliverAlert(db, id);
  return id ? db.query.alerts.findFirst({ where: eq(alerts.id, id) }) : null;
}

/**
 * Raise METER_OFFLINE for real-factory meters with an ingest token whose last
 * reading is older than five intervals. One alert per outage (keyed by last reading).
 */
export async function checkMeterHealth(db: DB, now = Date.now()) {
  const rows = await db
    .select({ meter: meters, factory: factories })
    .from(meters)
    .innerJoin(factories, eq(factories.id, meters.factoryId))
    .where(and(eq(factories.isSimulation, false), isNotNull(meters.ingestTokenHash)));
  let raised = 0;
  for (const { meter, factory } of rows) {
    const last = (await db.select({ ts: max(meterReadings.ts) }).from(meterReadings).where(eq(meterReadings.meterId, meter.id)))[0]?.ts ?? null;
    const since = last ?? meter.ingestTokenIssuedAt;
    if (since === null || now - since <= meter.intervalSeconds * 5000) continue;
    const mins = Math.round((now - since) / 60000);
    const id = await raiseAlert(db, factory, {
      kind: "METER_OFFLINE",
      key: `meter-offline:${meter.id}:${since}`,
      title: `${meter.name}: no readings for ${mins} min`,
      body: last ? `The last reading arrived ${mins} minutes ago. Check the meter gateway and network.` : "A token was issued but no reading has arrived yet.",
      href: "/meters",
    });
    if (id) raised++;
  }
  return raised;
}
