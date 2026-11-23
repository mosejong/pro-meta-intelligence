import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

async function pair(page) {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await showPanel(page, "SIMULATION");
  const example = page.locator("details.simulation-example");
  await example.locator(":scope > summary").click();
  await example.getByRole("button", { name: "이 예시로 입력 준비", exact: true }).click();
  const experiment = page.locator("section.experiment-replay");
  const run = experiment.locator('button[type="submit"]');
  const seed = experiment.getByLabel("재현 번호 (시드)", { exact: true });
  await seed.fill("4242");
  await expect(run).toBeEnabled(); await run.click();
  const result = experiment.locator(".experiment-replay-result");
  const slider = result.locator('.experiment-replay-seek input[type="range"]');
  const compare = experiment.locator("details.experiment-comparison");
  await compare.locator(":scope > summary").click();
  await slider.focus(); await slider.press("End");
  await compare.getByRole("button", { name: "이 실행을 비교 기준 A로 보관", exact: true }).click();
  await experiment.locator('.experiment-replay-team input[type="number"]').first().fill("0.4");
  await run.click();
  const copy = compare.getByRole("button", { name: "A/B 비교 요약 복사", exact: true });
  await expect(copy).toBeDisabled();
  await slider.focus(); await slider.press("End");
  await expect(compare.getByTestId("experiment-comparison-outcome")).toBeVisible();
  await expect(copy).toBeEnabled();
  return { experiment, run, seed, slider, compare, copy, text: compare.locator("textarea") };
}

test("A/B plain summary retains frozen pair, clears on rewind/new B and refuses mismatched seed", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  const { experiment, run, seed, slider, compare, copy, text } = await pair(page);
  const outcome = await compare.getByTestId("experiment-comparison-outcome").innerText();
  await copy.click(); await expect(text).toBeVisible();
  const original = await text.inputValue();
  expect(original).toContain("4242");
  expect(original).toContain("0.4");
  expect(original).toMatch(/#1/); expect(original).toMatch(/#2/);
  expect(original).toContain("모델 내부");
  expect(original).not.toMatch(/oe:player:|schema_version|evidenceIdentity/);
  await seed.fill("4243");
  expect(await text.inputValue()).toBe(original);
  expect(await compare.getByTestId("experiment-comparison-outcome").innerText()).toBe(outcome);
  await slider.focus(); await slider.press("Home");
  await expect(copy).toBeDisabled(); await expect(text).toHaveCount(0);
  await slider.press("End"); await expect(copy).toBeEnabled(); await expect(text).toHaveCount(0);
  await copy.click(); expect(await text.inputValue()).toBe(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await compare.screenshot({ path: testInfo.outputPath("ab-comparison-plain-summary.png") });
  await run.click(); await expect(text).toHaveCount(0); await expect(copy).toBeDisabled();
  await slider.focus(); await slider.press("End");
  await expect(compare.getByRole("alert")).toContainText("재현 번호");
  await expect(copy).toBeDisabled();
  await compare.getByRole("button", { name: "기준 A 해제", exact: true }).click();
  await expect(text).toHaveCount(0); await expect(copy).toHaveCount(0);
  await expect(experiment.locator(".experiment-replay-identity")).toContainText("실행 #3");
});

test("late A/B clipboard completion cannot revive old status after rewind or baseline replacement", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise(resolve => { window.__releaseABCopy = resolve; }) } }));
  const { slider, compare, copy, text } = await pair(page);
  await copy.click(); await expect(copy).toBeDisabled();
  await slider.focus(); await slider.press("Home"); await slider.press("End");
  await expect(copy).toBeEnabled();
  await page.evaluate(() => window.__releaseABCopy());
  await expect(compare).not.toContainText("복사했"); await expect(text).toHaveCount(0);
  await copy.click(); await expect(copy).toBeDisabled();
  await compare.getByRole("button", { name: "현재 실행 #2로 기준 A 바꾸기", exact: true }).click();
  await page.evaluate(() => window.__releaseABCopy());
  await expect(compare).not.toContainText("복사했"); await expect(text).toHaveCount(0);
  await expect(compare.getByTestId("experiment-comparison-outcome")).toHaveCount(0);
});

