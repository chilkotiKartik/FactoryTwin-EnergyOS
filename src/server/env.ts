import { z } from "zod";

const bool = z.enum(["true", "false"]);

const schema = z.object({
  DATABASE_URL: z.string().min(5).optional(),
  SEED_DEMO_USERS: bool.optional(),
  DEMO_PASSWORD: z.string().min(8, "DEMO_PASSWORD must be at least 8 characters.").optional(),
  COOKIE_SECURE: bool.optional(),
  ANALYSIS_DEBOUNCE_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),
  ALLOW_PRIVATE_WEBHOOKS: bool.optional(),
});

/**
 * Validate configuration at start-up and refuse unsafe combinations. A served
 * HTTPS deployment (COOKIE_SECURE=true) must not seed demo logins with the
 * published default password.
 */
export function checkEnv(env: NodeJS.ProcessEnv = process.env): { warnings: string[] } {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ")}`);
  const e = parsed.data;
  const warnings: string[] = [];
  const demo = (e.SEED_DEMO_USERS ?? "true") === "true";
  if (e.COOKIE_SECURE === "true" && demo && (e.DEMO_PASSWORD ?? "energyos-demo") === "energyos-demo") {
    throw new Error("Refusing to start: COOKIE_SECURE=true with demo users and the default DEMO_PASSWORD. Set SEED_DEMO_USERS=false or a private DEMO_PASSWORD.");
  }
  if (env.NODE_ENV === "production" && e.COOKIE_SECURE !== "true") warnings.push("COOKIE_SECURE is not true: session cookies are not marked Secure. Fine only for local use.");
  if (demo) warnings.push("Demo logins are seeded (SEED_DEMO_USERS is not false).");
  return { warnings };
}
