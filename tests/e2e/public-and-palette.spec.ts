import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("landing simulator recomputes and shows infeasibility honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const sim = page.getByTestId("shift-simulator");
  await expect(sim.getByText(/Simulated · deck assumptions/)).toBeVisible();
  const cost = sim.getByTestId("sim-cost");
  const before = await cost.textContent();
  await sim.getByLabel("Solar-hours discount").fill("0.4");
  await expect(cost).not.toHaveText(before ?? "");
  await sim.getByLabel("Dispatch cut-off").fill(String(15 * 60));
  await expect(sim.getByTestId("sim-infeasible")).toBeVisible();
  await sim.getByRole("button", { name: "Reset" }).click();
  await expect(cost).toHaveText(before ?? "");
});

test("how it works loads", async ({ page }) => {
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("text=NaN")).toHaveCount(0);
});

test("sign-up creates a private sandbox and the palette navigates", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/register");
  await page.fill("#name", "Test Visitor");
  await page.fill("#email", `visitor-${Date.now()}@example.test`);
  await page.fill("#password", "a-long-test-password");
  await page.fill("#factoryName", "E2E Castings");
  await Promise.all([page.waitForURL("**/dashboard**", { timeout: 60_000 }), page.click("button[type=submit]")]);
  await expect(page.getByText("Your sandbox factory is ready")).toBeVisible();
  await expect(page.locator("#factory-select")).toContainText("E2E Castings (synthetic sandbox)");
  await expect(page.getByTestId("data-mode")).toHaveText(/simulation/i);

  await page.keyboard.press("Control+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await page.keyboard.type("tariff");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/tariffs");
  await expect(palette).toBeHidden();

  // A sandbox owner can open heats from the palette, too.
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.keyboard.type("H07");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/heats/**");
});

test("duplicate sign-up does not reveal the account", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/register");
  await page.fill("#name", "Someone");
  await page.fill("#email", "supervisor@foundry-a.test");
  await page.fill("#password", "a-long-test-password");
  await page.fill("#factoryName", "Copy Castings");
  await page.click("button[type=submit]");
  await expect(page.getByText(/couldn't create an account with that email/)).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test("energy window inspector measures a dragged range", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", "supervisor@foundry-a.test");
  await page.fill("#password", "energyos-demo");
  await Promise.all([page.waitForURL("**/dashboard"), page.click("button[type=submit]")]);
  const svg = page.getByTestId("energy-timeline").first();
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  const y = box.y + box.height * 0.3;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
  await page.mouse.up();
  const stats = page.getByTestId("window-stats");
  await expect(stats).toBeVisible();
  await expect(stats).toContainText("kWh");
  await expect(stats).not.toContainText("NaN");
  await page.keyboard.press("Escape");
  await expect(stats).toBeHidden();
});

test("animations stop under reduced motion and figures settle on real values", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  const iterations = await page.locator(".flow-dash").first().evaluate((el) => getComputedStyle(el).animationIterationCount);
  expect(iterations).toBe("1");
  await expect(page.getByText("−3.4%").first()).toBeVisible();
  await ctx.close();
});
