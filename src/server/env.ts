import { z } from "zod";

const bool = z.enum(["true", "false"]);

const schema = z.object({
  DATABASE_URL: z.string().min(5).optional(),
  DATABASE_AUTH_TOKEN: z.string().min(10).optional(),
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
  const url = e.DATABASE_URL ?? "file:./data/energyos.db";
  const remote = !url.startsWith("file:");
  if (remote && !e.DATABASE_AUTH_TOKEN) warnings.push("DATABASE_URL points to a hosted database but DATABASE_AUTH_TOKEN is not set; connections will fail if it requires a token.");
  if (!remote && e.DATABASE_AUTH_TOKEN) warnings.push("DATABASE_AUTH_TOKEN is set but DATABASE_URL is a local file; the token is ignored.");
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) {
    warnings.push("Serverless runtime detected. Background analysis, audit sealing and the in-memory rate limiters assume one long-running server; use a hosted database and run on a persistent server for production (see docs/DEPLOYMENT.md).");
    if (!remote) warnings.push("A local SQLite file does not persist on a serverless filesystem; set DATABASE_URL to a hosted libSQL database.");
  }
  if (demo) warnings.push("Demo logins are seeded (SEED_DEMO_USERS is not false).");
  return { warnings };
}
