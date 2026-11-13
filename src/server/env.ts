import { z } from "zod";

const bool = z.enum(["true", "false"]);

const schema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^(postgres(ql)?:\/\/|pglite:)/, "DATABASE_URL must be postgres://… (server) or pglite:<dir> (local).")
    .optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).optional(),
  SEED_DEMO_USERS: bool.optional(),
  DEMO_PASSWORD: z.string().min(8, "DEMO_PASSWORD must be at least 8 characters.").optional(),
  COOKIE_SECURE: bool.optional(),
  ANALYSIS_DEBOUNCE_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),
  ALLOW_PRIVATE_WEBHOOKS: bool.optional(),
  INDIA_MARKET_FEED: z.enum(["iex", "off"]).optional(),
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
  const url = e.DATABASE_URL ?? "pglite:./data/pglite";
  const embedded = url.startsWith("pglite:");
  if (embedded && env.NODE_ENV === "production") warnings.push("DATABASE_URL is an embedded PGlite database: fine for a single local server, but use PostgreSQL (postgres://…) for a shared deployment.");
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) {
    warnings.push("Serverless runtime detected. Background analysis, audit sealing and the in-memory rate limiters assume one long-running server; use a hosted database and run on a persistent server for production (see docs/DEPLOYMENT.md).");
    if (embedded) warnings.push("An embedded database does not persist on a serverless filesystem; set DATABASE_URL to a PostgreSQL database.");
  }
  if (demo) warnings.push("Demo logins are seeded (SEED_DEMO_USERS is not false).");
  return { warnings };
}
