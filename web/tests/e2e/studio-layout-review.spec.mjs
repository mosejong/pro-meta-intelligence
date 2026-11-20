import { test, expect } from "@playwright/test";
import { enterDraftWorkspace } from "./studio-panels.mjs";

test("the selected side tab remains visible when the workspace becomes narrow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "This case explicitly moves from desktop to a narrow viewport.");
  await page.goto("/pro-meta-intelligence/");
  await enterDraftWorkspace(page);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  const selected = page.locator('#studio-panel-simulation-tab');
  await selected.click();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  // Do not let the browser's focused-control scrolling mask a hidden active tab.
  await page.locator(".studio-locale-select select").focus();
  await page.setViewportSize({ width: 390, height: 844 });
  const rail = page.getByRole("tablist");
  await expect(rail).toHaveAttribute("aria-orientation", "horizontal");
  await expect.poll(async () => {
    const a = await selected.boundingBox();
    const b = await rail.boundingBox();
    return Boolean(a && b && a.x >= b.x - 1 && a.x + a.width <= b.x + b.width + 1);
  }).toBe(true);
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  await expect(page.locator("#studio-panel-simulation")).toBeVisible();
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]);
});
