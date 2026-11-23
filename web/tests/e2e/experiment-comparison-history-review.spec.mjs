import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const p = page => page.locator("section.experiment-replay");
const run = page => p(page).locator('button[type="submit"]');
const slider = page => p(page).locator('.experiment-replay-seek input[type="range"]');
const comparison = page => p(page).locator("details.experiment-comparison");
const chart = page => p(page).locator("details.experiment-comparison-history");
async function open(item) { if (await item.getAttribute("open") === null) await item.locator(":scope > summary").click(); }
async function end(page) { await slider(page).focus(); await slider(page).press("End"); }
async function start(page) {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await showPanel(page, "SIMULATION");
  const example = page.locator("details.simulation-example"); await open(example);
  await example.getByRole("button", { name: "이 예시로 입력 준비", exact: true }).click();
  await p(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("4242");
  await run(page).click(); await end(page);
  await open(comparison(page));
  await comparison(page).getByRole("button", { name: "이 실행을 비교 기준 A로 보관", exact: true }).click();
}
async function rawHistory(page) {
  const history = p(page).locator("details.experiment-resource-history"); await open(history);
  const values = history.locator("details.experiment-resource-history-values"); await open(values);
  const rows = await history.locator("tbody tr").evaluateAll(items => items.map(row => [...row.querySelectorAll("td")].map(cell => Number(cell.textContent.replaceAll(",", "")))));
  await values.locator(":scope > summary").click();
  return rows;
}
async function deltas(page) {
  await open(chart(page)); await open(chart(page).locator("details.experiment-resource-history-values"));
  return chart(page).locator("tbody tr").evaluateAll(items => items.map(row => [...row.querySelectorAll("td")].map(cell => Number(cell.textContent.replaceAll(",", "")))));
}

test("A/B history uses common actual minutes and vanishes on rewind, mismatched seed and clearing A", async ({ page }, testInfo) => {
  await start(page); const a = await rawHistory(page);
  const inputs = p(page).locator('.experiment-replay-team input[type="number"]');
  for (let i = 0; i < 6; i += 1) await inputs.nth(i).fill(i < 3 ? "1" : "-1");
  await run(page).click(); await expect(chart(page)).toHaveCount(0);
  await p(page).getByRole("button", { name: "한 단계 (+1분)", exact: true }).click();
  await expect(chart(page)).toHaveCount(0);
  await end(page); const b = await rawHistory(page);
  await expect(chart(page)).not.toHaveAttribute("open", "");
  const common = Math.min(a.length, b.length) - 1;
  expect(a.length).not.toBe(b.length);
  await expect(chart(page)).toHaveAttribute("data-common-end-minute", String(common));
  const actual = await deltas(page);
  const expected = Array.from({ length: common + 1 }, (_, minute) => b[minute].map((value, index) => value - a[minute][index]));
  expect(actual).toEqual(expected);
  await expect(chart(page)).toContainText("먼저 끝난 실행을 늘리거나 추정하지 않습니다");
  await expect(chart(page).locator("line.zero")).toHaveCount(1);
  expect((await chart(page).locator(":scope > summary").boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const fixed = await chart(page).innerHTML();
  await p(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("8888");
  expect(await chart(page).innerHTML()).toBe(fixed);
  await chart(page).locator("details.experiment-resource-history-values > summary").click();
  await chart(page).screenshot({ path: testInfo.outputPath("ab-resource-difference.png") });
  await slider(page).focus(); await slider(page).press("Home"); await expect(chart(page)).toHaveCount(0);
  await end(page); expect(await deltas(page)).toEqual(expected);
  await run(page).click(); await expect(chart(page)).toHaveCount(0); await end(page);
  await expect(comparison(page).getByRole("alert")).toContainText("재현 번호가 다릅니다");
  await expect(chart(page)).toHaveCount(0);
  await comparison(page).getByRole("button", { name: "기준 A 해제", exact: true }).click();
  await expect(chart(page)).toHaveCount(0);
});

test("identical assumptions give a finite zero chart and replacing A cannot retain an old pair", async ({ page }) => {
  await start(page); await run(page).click(); await end(page);
  const data = await deltas(page); expect(data.length).toBeGreaterThan(1);
  expect(data.every(row => row.length === 2 && row.every(value => value === 0))).toBe(true);
  await expect(chart(page)).toContainText("모든 분의 차이가 0");
  expect(await chart(page).locator("svg.experiment-resource-history-chart").innerHTML()).not.toMatch(/NaN|Infinity/);
  await comparison(page).getByRole("button", { name: "현재 실행 #2로 기준 A 바꾸기", exact: true }).click();
  await expect(chart(page)).toHaveCount(0);
  await run(page).click(); await end(page);
  expect((await deltas(page)).every(row => row.every(value => value === 0))).toBe(true);
  await expect(comparison(page).locator(".experiment-comparison-baseline")).toContainText("실행 #2");
});
