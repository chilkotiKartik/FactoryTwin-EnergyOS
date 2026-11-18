"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, lt } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { anomalies, meters, sessions, users } from "@/db/schema";
import { isIsoDate } from "@/domain/time";
import { AppError, toActionError, type ActionResult } from "@/server/errors";
import { requirePerm, type Actor } from "@/server/context";
import { currentActor, currentSessionId, endSession, setActiveFactory, startSession } from "@/server/auth/session-next";
import { addMember, changeOwnPassword, changeRole, removeMember, resetPassword, setDisabled, signOutEverywhere } from "@/server/services/team";
import { sendTestAlert, setAlertWebhook } from "@/server/services/alerts";
import { hashPassword, hashToken, newToken, verifyPassword } from "@/server/auth/password";
import { audit, verifyAuditChain } from "@/server/audit";
import { runAnalysis } from "@/server/services/analysis";
import { createHeat, updateHeat } from "@/server/services/heats";
import { commitCsv, previewCsv, type CsvPreview, type DeclaredSource } from "@/server/services/meters";
import { createTariffVersion, previewRate } from "@/server/services/tariffs";
import { createPlan, updatePlan } from "@/server/services/plans";
import { replanShift, runOptimization, whatIf, type ReplanParams, type ReplanView, type RunOutcome, type WhatIfParams, type WhatIfResult } from "@/server/services/optimization";
import { decideRecommendation } from "@/server/services/recommendations";
import { recordSimulatedOutcome } from "@/server/services/execution";
import { createVerificationReport } from "@/server/services/verification";
import { resetScenario } from "@/server/services/demo";
import { updateSettings } from "@/server/services/settings";

import { DAY_COOKIE } from "@/lib/constants";
import { clientAddress } from "@/server/ratelimit";
import { clearLimit, hitLimit, isLimited } from "@/server/services/limits";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/messages";

async function withActor<T>(fn: (db: DB, actor: Actor) => Promise<T>, opts: { allowPendingPassword?: boolean; readOnly?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again.");
    if (actor.mustChangePassword && !opts.allowPendingPassword) throw new AppError("FORBIDDEN", "Set your own password first (Account page).");
    const data = await fn(getDb(), actor);
    if (!opts.readOnly) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// --- Authentication -------------------------------------------------------

// Login throttling: 5 failures per email and 20 per client address per minute.
// In-process and bounded; a multi-instance deployment should move this to a shared store.
// Login throttling, shared by every server instance (database counters):
// 5 failures per email and 20 per client address per minute.
let dummyHash: Promise<string> | null = null;

export async function loginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { ok: false, message: "Enter your email and password." };
  const h = await headers();
  const ipKey = clientAddress(h);
  const db = getDb();
  const emailKey = `login:email:${email}`;
  const addrKey = `login:ip:${ipKey}`;
  if ((await isLimited(db, emailKey, 5)) || (await isLimited(db, addrKey, 20))) return { ok: false, message: "Too many attempts. Wait a minute and try again." };
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  // Always run scrypt, so the response time does not reveal whether the email exists.
  dummyHash ??= hashPassword("not-a-real-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok || user.disabled) {
    await hitLimit(db, emailKey, 5, 60_000);
    await hitLimit(db, addrKey, 20, 60_000);
    return { ok: false, message: "Email or password is incorrect." };
  }
  await clearLimit(db, emailKey);
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  await startSession(user.id);
  await audit(db, null, "auth.login", "user", user.id, { email }, null);
  redirect(user.mustChangePassword ? "/account?first=1" : "/dashboard");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function switchFactoryAction(factoryId: string): Promise<ActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in again." };
  if (!actor.memberships.some((m) => m.factoryId === factoryId)) return { ok: false, code: "FORBIDDEN", message: "You are not a member of that factory." };
  await setActiveFactory(factoryId);
  (await cookies()).delete(DAY_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setDayAction(day: string): Promise<ActionResult> {
  if (!isIsoDate(day)) return { ok: false, message: "Invalid date." };
  (await cookies()).set(DAY_COOKIE, day, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Data ------------------------------------------------------------------

export async function createHeatAction(input: unknown) {
  return withActor((db, a) => createHeat(db, a, input));
}

export async function updateHeatAction(id: string, revision: number, input: unknown) {
  return withActor((db, a) => updateHeat(db, a, id, revision, input));
}

export async function runAnalysisAction() {
  return withActor(async (db, a) => {
    const r = await runAnalysis(db, a);
    return { heats: r.heatsAnalysed, flagged: r.anomaliesFlagged, model: { kind: r.model.kind, n: r.model.n, r2: r.model.r2, rmse: r.model.rmseKwh } };
  });
}

export async function setAnomalyStatusAction(id: string, status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED") {
  return withActor(async (db, a) => {
    requirePerm(a, "analysis.run");
    if (!["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(status)) throw new AppError("VALIDATION", "Invalid status.");
    const row = await db.query.anomalies.findFirst({ where: eq(anomalies.id, id) });
    if (!row || row.factoryId !== a.factory.id) throw new AppError("NOT_FOUND", "Anomaly not found.");
    await db.update(anomalies).set({ status }).where(eq(anomalies.id, id));
    await audit(db, a, "anomaly.status", "anomaly", id, { from: row.status, to: status });
  });
}

const MAX_UPLOAD = 2 * 1024 * 1024;

export async function previewCsvAction(meterId: string, filename: string, text: string): Promise<ActionResult<Omit<CsvPreview, "rows"> & { rows: CsvPreview["rows"]; totalRows: number }>> {
  if (text.length > MAX_UPLOAD) return { ok: false, message: "File is larger than 2 MB." };
  const res = await withActor((db, a) => previewCsv(db, a, meterId, filename, text));
  if (!res.ok || !res.data) return res as ActionResult<never>;
  const d = res.data;
  // Send back the problem rows first and a bounded sample, not the whole file.
  const problems = d.rows.filter((r) => r.status !== "ACCEPT");
  const sample = [...problems.slice(0, 150), ...d.rows.filter((r) => r.status === "ACCEPT").slice(0, 50)].sort((x, y) => x.line - y.line);
  return { ok: true, data: { ...d, rows: sample, totalRows: d.rows.length } };
}

export async function commitCsvAction(meterId: string, filename: string, text: string, declared: DeclaredSource) {
  if (text.length > MAX_UPLOAD) return { ok: false, message: "File is larger than 2 MB." } as ActionResult;
  return withActor((db, a) => commitCsv(db, a, meterId, filename, text, declared === "GENUINE_METER_EXPORT" ? "GENUINE_METER_EXPORT" : "UNVERIFIED"));
}

export async function createTariffAction(input: unknown) {
  return withActor((db, a) => createTariffVersion(db, a, input));
}

export async function previewRateAction(localDateTime: string) {
  return withActor(async (db, a) => {
    const r = await previewRate(db, a, localDateTime);
    return r.rate ? { ratePaise: r.rate.ratePaise, label: r.rate.label, kind: r.rate.kind, version: r.rate.version } : null;
  });
}

export async function updatePlanAction(input: unknown) {
  return withActor((db, a) => updatePlan(db, a, input));
}

export async function createPlanAction(input: unknown) {
  return withActor((db, a) => createPlan(db, a, input));
}

export async function whatIfAction(planId: string, params: WhatIfParams): Promise<ActionResult<WhatIfResult>> {
  return withActor((db, a) => whatIf(db, a, planId, params), { readOnly: true });
}

export async function replanAction(planId: string, params: ReplanParams): Promise<ActionResult<ReplanView>> {
  return withActor((db, a) => replanShift(db, a, planId, params), { readOnly: true });
}

export async function runOptimizationAction(planId: string, opts: { allowReorder?: boolean } = {}): Promise<ActionResult<RunOutcome>> {
  return withActor((db, a) => runOptimization(db, a, planId, { allowReorder: opts?.allowReorder === true }));
}

export async function decideAction(input: unknown) {
  return withActor((db, a) => decideRecommendation(db, a, input));
}

export async function recordOutcomeAction(planId: string) {
  return withActor((db, a) => recordSimulatedOutcome(db, a, planId));
}

export async function createVerificationAction(input: { baselineDay: string; comparisonDay: string; assumptions: unknown; title?: string; baselinePeriodDays?: number }) {
  return withActor((db, a) => createVerificationReport(db, a, input));
}

export async function resetScenarioAction(key: string) {
  const res = await withActor((db, a) => resetScenario(db, a, key));
  if (res.ok) (await cookies()).delete(DAY_COOKIE);
  return res;
}

export async function updateSettingsAction(input: unknown) {
  return withActor((db, a) => updateSettings(db, a, input));
}

/** Issue a meter ingest token. Shown once; only its hash is stored. */
export async function issueIngestTokenAction(meterId: string) {
  return withActor(async (db, a) => {
    requirePerm(a, "factory.configure");
    const m = await db.query.meters.findFirst({ where: eq(meters.id, meterId) });
    if (!m || m.factoryId !== a.factory.id) throw new AppError("NOT_FOUND", "Meter not found.");
    const token = `eos_${newToken()}`;
    await db
      .update(meters)
      .set({ ingestTokenHash: hashToken(token), ingestTokenIssuedAt: Date.now(), ingestTokenLastUsedAt: null, lastCounterKwh: null, lastCounterTs: null })
      .where(eq(meters.id, meterId));
    await audit(db, a, "meter.issue_token", "meter", meterId, {});
    return { token };
  });
}

/** Revoke a meter's ingest token: the meter can no longer push readings. */
export async function revokeIngestTokenAction(meterId: string) {
  return withActor(async (db, a) => {
    requirePerm(a, "factory.configure");
    const m = await db.query.meters.findFirst({ where: eq(meters.id, meterId) });
    if (!m || m.factoryId !== a.factory.id) throw new AppError("NOT_FOUND", "Meter not found.");
    await db.update(meters).set({ ingestTokenHash: null, ingestTokenIssuedAt: null, ingestTokenLastUsedAt: null }).where(eq(meters.id, meterId));
    await audit(db, a, "meter.revoke_token", "meter", meterId, {});
  });
}

// --- Team and account -------------------------------------------------------

export async function addMemberAction(input: unknown) {
  return withActor((db, a) => addMember(db, a, input));
}

export async function changeRoleAction(userId: string, role: string) {
  return withActor((db, a) => changeRole(db, a, userId, role));
}

export async function removeMemberAction(userId: string) {
  return withActor((db, a) => removeMember(db, a, userId));
}

export async function setDisabledAction(userId: string, disabled: boolean) {
  return withActor((db, a) => setDisabled(db, a, userId, Boolean(disabled)));
}

export async function resetPasswordAction(userId: string) {
  return withActor(async (db, a) => ({ tempPassword: await resetPassword(db, a, userId) }));
}

export async function changePasswordAction(input: unknown) {
  return withActor(async (db, a) => changeOwnPassword(db, a, input, await currentSessionId()), { allowPendingPassword: true });
}

export async function signOutEverywhereAction() {
  return withActor(async (db, a) => ({ ended: await signOutEverywhere(db, a, await currentSessionId()) }));
}

// --- Alerts -------------------------------------------------------------------

export async function setWebhookAction(url: string | null) {
  return withActor((db, a) => setAlertWebhook(db, a, url));
}

export async function sendTestAlertAction() {
  return withActor(async (db, a) => {
    const r = await sendTestAlert(db, a);
    return { delivered: Boolean(r?.deliveredAt), error: r?.deliveryError ?? null };
  });
}

// --- Audit --------------------------------------------------------------------

export async function verifyAuditAction() {
  return withActor(async (db, a) => {
    requirePerm(a, "audit.view");
    return verifyAuditChain(db, a.factory.id);
  });
}

/** Remember the display language for this browser. A cookie only: no account data is involved. */
export async function setLocaleAction(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return { ok: false, code: "VALIDATION", message: "Unknown language." };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false, secure: process.env.COOKIE_SECURE === "true" });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Fetch today's IEX prices now (throttled to once per five minutes for everyone). */
export async function refreshMarketAction(): Promise<ActionResult<{ date: string } | null>> {
  return withActor(async (db) => {
    const { refreshIexDam } = await import("@/server/services/market");
    const r = await refreshIexDam(db);
    if (!r.ok) throw new AppError("VALIDATION", r.reason);
    return { date: r.date };
  });
}

export async function createApiKeyAction(name: string): Promise<ActionResult<{ key: string }>> {
  return withActor(async (db, a) => {
    const { createApiKey } = await import("@/server/services/apikeys");
    const r = await createApiKey(db, a, name);
    return { key: r.key };
  });
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult<{ id: string }>> {
  return withActor(async (db, a) => {
    const { revokeApiKey } = await import("@/server/services/apikeys");
    await revokeApiKey(db, a, id);
    return { id };
  });
}
