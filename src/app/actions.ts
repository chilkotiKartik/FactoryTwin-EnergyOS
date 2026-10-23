"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { anomalies, meters, users } from "@/db/schema";
import { isIsoDate } from "@/domain/time";
import { AppError, toActionError, type ActionResult } from "@/server/errors";
import { requirePerm, type Actor } from "@/server/context";
import { currentActor, endSession, setActiveFactory, startSession } from "@/server/auth/session-next";
import { hashToken, newToken, verifyPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { runAnalysis } from "@/server/services/analysis";
import { createHeat, updateHeat } from "@/server/services/heats";
import { commitCsv, previewCsv, type CsvPreview, type DeclaredSource } from "@/server/services/meters";
import { createTariffVersion, previewRate } from "@/server/services/tariffs";
import { createPlan, updatePlan } from "@/server/services/plans";
import { runOptimization, type RunOutcome } from "@/server/services/optimization";
import { decideRecommendation } from "@/server/services/recommendations";
import { recordSimulatedOutcome } from "@/server/services/execution";
import { createVerificationReport } from "@/server/services/verification";
import { resetScenario } from "@/server/services/demo";
import { updateSettings } from "@/server/services/settings";

import { DAY_COOKIE } from "@/lib/constants";

async function withActor<T>(fn: (db: DB, actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const actor = await currentActor();
    if (!actor) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again.");
    const data = await fn(getDb(), actor);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// --- Authentication -------------------------------------------------------

const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { ok: false, message: "Enter your email and password." };
  const a = attempts.get(email);
  if (a && a.n >= 5 && a.until > Date.now()) return { ok: false, message: "Too many attempts. Wait a minute and try again." };
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    const cur = attempts.get(email);
    attempts.set(email, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: Date.now() + 60_000 });
    return { ok: false, message: "Email or password is incorrect." };
  }
  attempts.delete(email);
  await startSession(user.id);
  await audit(db, null, "auth.login", "user", user.id, { email }, null);
  redirect("/dashboard");
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

export async function runOptimizationAction(planId: string): Promise<ActionResult<RunOutcome>> {
  return withActor((db, a) => runOptimization(db, a, planId));
}

export async function decideAction(input: unknown) {
  return withActor((db, a) => decideRecommendation(db, a, input));
}

export async function recordOutcomeAction(planId: string) {
  return withActor((db, a) => recordSimulatedOutcome(db, a, planId));
}

export async function createVerificationAction(input: { baselineDay: string; comparisonDay: string; assumptions: unknown; title?: string }) {
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
    await db.update(meters).set({ ingestTokenHash: hashToken(token) }).where(eq(meters.id, meterId));
    await audit(db, a, "meter.issue_token", "meter", meterId, {});
    return { token };
  });
}
