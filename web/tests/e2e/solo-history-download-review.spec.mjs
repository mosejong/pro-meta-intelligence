import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const review = page => solo(page).locator(".solo-history");

async function prepare(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async () => { throw new Error("denied"); } },
  }));
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

async function textOnScreen(page) {
  await review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true }).click();
  return review(page).locator("textarea").inputValue();
}

async function downloadedText(page) {
  const pending = page.waitForEvent("download");
  await review(page).getByRole("button", { name: "자동 선택 복기 저장", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.txt$/);
  expect(await download.failure()).toBeNull();
  return readFile(await download.path(), "utf8");
}

test("explicit TXT equals validated readable copy and undo exports only retained turns", async ({ page }, testInfo) => {
  await prepare(page);
  const original = await textOnScreen(page);
  const url = page.url();
  const storage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(await downloadedText(page)).toBe(original);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).toBe(storage);
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "4");
  const button = review(page).getByRole("button", { name: "자동 선택 복기 저장", exact: true });
  expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await review(page).screenshot({ path: testInfo.outputPath("solo-history-download.png") });
  await page.getByRole("button", { name: "내 마지막 선택 되돌리기", exact: true }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "2");
  const retained = await textOnScreen(page);
  expect(retained).not.toBe(original);
  expect(await downloadedText(page)).toBe(retained);
});

test("download failure leaves draft and readable clipboard fallback usable", async ({ page }) => {
  await prepare(page);
  const original = await textOnScreen(page);
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error("unavailable"); }; });
  await review(page).getByRole("button", { name: "자동 선택 복기 저장", exact: true }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "4");
  expect(await textOnScreen(page)).toBe(original);
  await expect(review(page).getByRole("button", { name: "자동 선택 복기 저장", exact: true })).toBeEnabled();
});
