import { devices, expect, test, type Page } from "@playwright/test";

const { defaultBrowserType: _engine, ...iphone } = devices["iPhone 13"];
void _engine;

/**
 * Smoke test: every screen, as every role, on a desktop and a phone, in light and
 * dark. A screen fails if the server errors, the page throws, the console logs an
 * error, the error boundary shows, or the page scrolls sideways.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "energyos-demo";
const ACCOUNTS = ["owner@foundry-a.test", "supervisor@foundry-a.test", "analyst@foundry-a.test", "operator@foundry-a.test", "owner@foundry-b.test"];
const ROUTES = ["/dashboard", "/why", "/heats", "/meters", "/anomalies", "/optimizer", "/recommendations", "/verification", "/tariffs", "/reports", "/reports/daily", "/audit", "/evidence", "/settings", "/demo", "/account"];
/** Detail pages are reached by following the first matching link on a list page. */
const DETAILS: [string, string][] = [
  ["/heats", "a[href^='/heats/']"],
  ["/recommendations", "a[href^='/recommendations/']"],
  ["/verification", "a[href^='/verification/']"],
];

const VIEWPORTS = [
  { name: "desktop-light", theme: "light", use: { viewport: { width: 1440, height: 900 } } },
  { name: "phone-dark", theme: "dark", use: iphone },
] as const;

async function check(page: Page, path: string, problems: string[], errors: string[]) {
  const before = errors.length;
  const res = await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const status = res?.status() ?? 0;
  // Pages a role may not open redirect or show "not found"; a 5xx is always a failure.
  if (status >= 500) problems.push(`${path}: HTTP ${status}`);
  if (await page.getByText("This page could not be loaded").isVisible().catch(() => false)) problems.push(`${path}: error boundary shown`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`${path}: scrolls sideways by ${overflow}px`);
  for (const e of errors.slice(before)) problems.push(`${path}: ${e}`);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use(vp.use);
    for (const email of ACCOUNTS) {
      test(`${email} can open every screen`, async ({ page, context, baseURL }) => {
        test.setTimeout(240_000);
        await context.addCookies([{ name: "energyos_theme", value: vp.theme, url: baseURL! }]);
        // External photos: refuse them so the run is fast and the "photo could not load" fallback is exercised.
        await page.route("https://upload.wikimedia.org/**", (r) => r.abort());
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
        page.on("console", (m) => {
          // The aborted photo requests above are expected; anything else is a failure.
          if (m.type() === "error" && !/Failed to load resource: net::ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
        });
        await page.goto("/login");
        await page.fill("#email", email);
        await page.fill("#password", PASSWORD);
        await Promise.all([page.waitForURL(/\/(dashboard|account)/), page.click("button[type=submit]")]);

        const problems: string[] = [];
        for (const r of ROUTES) await check(page, r, problems, errors);
        for (const [list, selector] of DETAILS) {
          await page.goto(list, { waitUntil: "load" });
          // Only follow a detail link if the list has one (a fresh demo has no recommendations yet).
          const link = page.locator(selector).first();
          const href = (await link.count()) ? await link.getAttribute("href") : null;
          if (href) await check(page, href, problems, errors);
        }
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  });
}
