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
