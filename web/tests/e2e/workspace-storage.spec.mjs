import { test, expect } from "@playwright/test";

test("blocked preference storage does not crash the draft workspace", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Storage.prototype[method] = () => { throw new DOMException("QA injected storage denial", "SecurityError"); };
    }
  });
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await page.screenshot({ path: testInfo.outputPath("storage-denied-draft.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("a stalled draft database releases the workspace and failed saves can be retried", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    window.restoreDraftDatabase = () => { IDBFactory.prototype.open = original; };
    IDBFactory.prototype.open = () => ({});
  });
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await page.clock.fastForward(10001);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await page.clock.fastForward(10001);
  await expect(page.locator(".draft-save-failed")).toBeVisible();
  await page.evaluate(() => window.restoreDraftDatabase());
  await page.getByRole("button", { name: "다시 저장", exact: true }).click();
  await expect(page.locator(".draft-save-failed")).toHaveCount(0);
  const details = page.locator(".draft-session-details");
  await details.locator("summary").click();
  await expect(details.getByRole("status").filter({ hasText: "이 기기에 저장됨" })).toBeVisible();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  expect(errors).toEqual([]);
});
