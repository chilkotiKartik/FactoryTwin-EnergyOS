import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const external = process.env.E2E_BASE_URL;

/**
 * End-to-end demo flow against a production build with its own database.
 *   pnpm build && pnpm test:e2e
 * Set E2E_BASE_URL to run against an already running server instead.
 * Set PLAYWRIGHT_CHROMIUM_PATH if Chromium is not where Playwright expects it.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: external
    ? undefined
    : {
        command: `pnpm exec tsx scripts/db-setup.ts --reset && pnpm exec next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        timeout: 120_000,
        reuseExistingServer: false,
        env: { DATABASE_URL: "file:./data/e2e.db", DEMO_PASSWORD: "energyos-demo", SEED_DEMO_USERS: "true", COOKIE_SECURE: "false" },
      },
});
