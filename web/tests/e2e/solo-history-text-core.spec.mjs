import { test, expect } from "@playwright/test";

const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const review = page => solo(page).locator(".solo-history");
async function twoChoices(page) {
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("BLUE");
  await solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  for (const expected of [2, 4]) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", String(expected));
  }
  await review(page).locator(":scope > summary").click();
}

test("automatic choice reasons copy as readable text with denied clipboard; undo hides stale fallback", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await twoChoices(page);
  await review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true }).click();
  const fallback = review(page).locator("textarea");
  await expect(fallback).toBeVisible();
  const text = await fallback.inputValue();
  const buttonBox = await review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true }).boundingBox();
  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(text).toContain("2"); expect(text).toContain("4");
  expect(text).toContain("밴"); expect(text).not.toContain("schema_version");
  expect(text).not.toContain('"context"'); expect(text).not.toContain('"prefix"');
  await expect(fallback).toHaveAttribute("readonly", "");
  await review(page).screenshot({ path: testInfo.outputPath("solo-history-readable-copy.png") });
  await page.getByRole("button", { name: "내 마지막 선택 되돌리기", exact: true }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "2");
  await expect(fallback).toHaveCount(0);
  await review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true }).click();
  await expect(fallback).toBeVisible();
  expect(await fallback.inputValue()).not.toContain("4번째");
});

test("a late clipboard completion cannot label changed history as copied", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise(resolve => { window.__releaseSoloHistoryCopy = resolve; }) } }));
  await twoChoices(page);
  const copy = review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true });
  await copy.click(); await expect(copy).toBeDisabled();
  await page.getByRole("button", { name: "내 마지막 선택 되돌리기", exact: true }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "2");
  await expect(copy).toBeEnabled();
  await page.evaluate(() => window.__releaseSoloHistoryCopy());
  await expect(copy).toBeEnabled();
  await expect(review(page).locator("textarea")).toHaveCount(0);
  await expect(review(page)).not.toContainText("복사했");
});
