import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { hashPassword } from "../auth/password";
import { audit } from "../audit";
import { resolveActor } from "../context";
import { newId } from "../ids";
import { resetScenario } from "./demo";

/** Self-service sign-up is on unless ALLOW_REGISTRATION is "false". */
export function registrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ALLOW_REGISTRATION ?? "true") !== "false";
}

export const registrationSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Name is too long."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200, "Password is too long."),
  factoryName: z.string().trim().min(2, "Name your sandbox factory.").max(80, "Factory name is too long."),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export type RegistrationResult = { ok: true; userId: string; factoryId: string } | { ok: false; field?: keyof RegistrationInput; message: string };

/** Same message whether or not the email exists, so sign-up does not reveal accounts. */
export const DUPLICATE_MESSAGE = "We couldn't create an account with that email. If you already have one, sign in instead.";

/**
 * Create a user with their own organisation and a private SIMULATION factory
 * (owner role), seeded with the deterministic holding-anomaly scenario.
 * Self-service never creates a real-data factory and never joins an existing one.
 */
export async function registerSandbox(db: DB, raw: unknown): Promise<RegistrationResult> {
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      field: issue.path[0] as keyof RegistrationInput,
      message: issue.message,
    };
  }
  const input = parsed.data;
  // Hash before the lookup so both paths cost the same time.
  const passwordHash = await hashPassword(input.password);
  const existing = await db.query.users.findFirst({
    where: eq(s.users.email, input.email),
    columns: { id: true },
  });
  if (existing) return { ok: false, field: "email", message: DUPLICATE_MESSAGE };

  const userId = newId("usr");
  const orgId = newId("org");
  const factoryId = newId("fac");
  const furnaceId = newId("fur");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(s.users).values({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
      });
      await tx.insert(s.organizations).values({ id: orgId, name: `${input.factoryName} (sandbox)` });
      await tx.insert(s.factories).values({
        id: factoryId,
        orgId,
        name: `${input.factoryName} (synthetic sandbox)`,
        code: `SBX-${factoryId.slice(-8).toUpperCase()}`,
        location: "Personal sandbox: synthetic data generated from the deck's foundry profile",
        timeZone: "Asia/Kolkata",
        isSimulation: true,
      });
      await tx.insert(s.furnaces).values({
        id: furnaceId,
        factoryId,
        name: "F1 induction furnace",
        capacityKg: 500,
        ratedKw: 550,
        nominalMeltMinutes: 35,
      });
      await tx.insert(s.meters).values({
        id: newId("mtr"),
        factoryId,
        furnaceId,
        name: "F1 incomer meter",
        model: "Simulated (stands in for a Modbus multifunction meter)",
        intervalSeconds: 60,
      });
      await tx.insert(s.memberships).values({ id: newId("mem"), userId, factoryId, role: "OWNER" });
      await audit(tx, { userId, name: input.name, factory: { id: factoryId } }, "auth.register", "user", userId, { factoryId, sandbox: true });
    });
  } catch (e) {
    // A concurrent sign-up with the same email loses the unique-index race.
    if (String(e).includes("UNIQUE")) return { ok: false, field: "email", message: DUPLICATE_MESSAGE };
    throw e;
  }
  const actor = await resolveActor(db, userId, factoryId);
  await resetScenario(db, actor, "holding-anomaly");
  return { ok: true, userId, factoryId };
}
