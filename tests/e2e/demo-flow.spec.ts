import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const PASSWORD = "energyos-demo";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL("**/dashboard"), page.click("button[type=submit]")]);
}

test.describe.configure({ mode: "serial" });

test("wrong password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "supervisor@foundry-a.test");
  await page.fill("#password", "not-the-password");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated users are sent to login", async ({ page }) => {
  await page.goto("/optimizer");
  await expect(page).toHaveURL(/\/login/);
});

test("supervisor loads the holding-anomaly scenario", async ({ page }) => {
  await login(page, "supervisor@foundry-a.test");
  await expect(page.getByTestId("data-mode")).toHaveText(/simulation/i);
  await expect(page.getByText("SIMULATION — SYNTHETIC DATA — NOT FIELD VALIDATION").first()).toBeVisible();
  await page.goto("/demo");
  await page.getByTestId("load-holding-anomaly").click();
  await page.getByTestId("confirm-reset").click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
});

test("dashboard and anomaly explain Heat 07", async ({ page }) => {
  await login(page, "analyst@foundry-a.test");
  await page.goto("/dashboard?day=2026-10-20");
  await expect(page.getByRole("heading", { name: "Operations dashboard" })).toBeVisible();
  await page.goto("/anomalies");
  const row = page.locator("tr", { hasText: "H07" }).first();
  await expect(row).toContainText("HIGH");
  await row.getByRole("link", { name: "H07" }).click();
  await expect(page.getByText(/mould set 7/i).first()).toBeVisible();
});

test("analyst runs the optimiser but cannot approve", async ({ page }) => {
  await login(page, "analyst@foundry-a.test");
  await page.goto("/optimizer");
  await page.getByRole("button", { name: /run optimiser/i }).click();
  await expect(page.getByText(/Recommendation v\d+ ready for review/).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: /review recommendation/i }).first().click();
  await expect(page.getByRole("heading", { name: /Schedule recommendation v\d+/ })).toBeVisible();
  await expect(page.getByTestId("approve")).toHaveCount(0);
  await expect(page.getByText(/cannot approve or reject/)).toBeVisible();
});

test("supervisor approves, records the outcome and saves a verification report", async ({ page }) => {
  await login(page, "supervisor@foundry-a.test");
  await page.goto("/recommendations");
  await page.locator("tr", { hasText: "Awaiting decision" }).getByRole("link").first().click();
  await page.getByTestId("approve").click();
  await page.getByTestId("confirm-decision").click();
  await expect(page.getByTestId("decision-record")).toContainText("Approved by");
  await page.goto("/verification");
  await page.getByTestId("record-outcome").click();
  await page.waitForURL(/comparison=2026-10-21/, { timeout: 60_000 });
  await expect(page.getByText("SEC change (per tonne)")).toBeVisible();
  await page.getByTestId("save-report").click();
  await page.waitForURL(/\/verification\/ver_/);
  await expect(page.getByText("SIMULATED").first()).toBeVisible();
});

test("CSV import previews errors and stores only valid rows", async ({ page }) => {
  await login(page, "analyst@foundry-a.test");
  await page.goto("/meters");
  await page.setInputFiles("#csv-file", path.resolve("public/samples/meter-sample-with-errors.csv"));
  const preview = page.getByTestId("csv-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Reject: 5");
  await expect(preview).toContainText("Duplicate in file: 1");
  await page.getByTestId("csv-commit").click();
  await expect(page.locator("tr", { hasText: "meter-sample-with-errors.csv" })).toBeVisible();
});

test("operator sees no approval controls and can open the heat log", async ({ page }) => {
  await login(page, "operator@foundry-a.test");
  await expect(page.getByTestId("current-role")).toHaveText(/operator/i);
  await page.goto("/heats");
  await expect(page.getByRole("button", { name: /log heat/i })).toBeVisible();
  await page.goto("/recommendations");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByTestId("approve")).toHaveCount(0);
});

test("phone width has no horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "supervisor@foundry-a.test");
  for (const p of ["/dashboard", "/optimizer", "/heats"]) {
    await page.goto(p, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, p).toBeLessThanOrEqual(1);
  }
});

test("owner verifies the audit chain, sees team and alerts, and pages carry a nonce CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  await login(page, "owner@foundry-a.test");
  const res = await page.goto("/audit");
  expect(res!.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByRole("status").filter({ hasText: /verified/ })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("Add a member")).toBeVisible();
  await expect(page.getByLabel("Webhook URL")).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
  expect(errors).toEqual([]);
});
