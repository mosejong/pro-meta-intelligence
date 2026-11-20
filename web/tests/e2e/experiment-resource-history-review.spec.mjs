import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

const panel = page => page.locator("section.experiment-replay");
const history = page => page.locator("details.experiment-resource-history");
const slider = page => panel(page).locator('.experiment-replay-seek input[type="range"]');
async function openDetails(item) { if (await item.getAttribute("open") === null) await item.locator(":scope > summary").click(); }
async function ready(page) {
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await showPanel(page, "SIMULATION");
  await expect(history(page)).toHaveCount(0);
  const example = page.locator("details.simulation-example");
  await openDetails(example);
  await example.getByRole("button", { name: "이 예시로 입력 준비", exact: true }).click();
  await panel(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("4242");
  await panel(page).locator('button[type="submit"]').click();
}
async function rowsMatchVisibleState(page, minute) {
  await expect(history(page)).toHaveAttribute("data-shown-minute", String(minute));
  const rows = history(page).locator("tbody tr");
  await expect(rows).toHaveCount(minute + 1);
  const minutes = await rows.locator("th").allTextContents();
  expect(minutes).toEqual(Array.from({ length: minute + 1 }, (_, i) => `${i}분`));
  expect(await rows.last().locator("td").allTextContents()).toEqual(await panel(page).locator('.experiment-replay-states [data-stat="gold"]').allTextContents());
  expect(await history(page).locator("svg.experiment-resource-history-chart").innerHTML()).not.toMatch(/NaN|Infinity/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test("resource history follows shown past only, stays fixed after input edits and resets with a new run", async ({ page }, testInfo) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  await expect(history(page)).not.toHaveAttribute("open", "");
  await openDetails(history(page));
  const values = history(page).locator("details.experiment-resource-history-values");
  await expect(values).not.toHaveAttribute("open", ""); await openDetails(values);
  expect((await values.locator(":scope > summary").boundingBox()).height).toBeGreaterThanOrEqual(44);
  await rowsMatchVisibleState(page, 0);
  expect(await history(page).locator(".experiment-resource-history-legend").evaluate(el => getComputedStyle(el).display)).toBe("flex");
  for (const item of await history(page).locator(".experiment-resource-history-legend li").all()) expect(await item.evaluate(el => getComputedStyle(el).display)).toBe("flex");
  const initialLines = await history(page).locator("polyline").evaluateAll(lines => lines.map(line => line.getAttribute("points")));
  const svg = history(page).getByRole("img", { name: /모델 자원 흐름/ });
  await expect(svg).toBeVisible();
  await expect(history(page)).toContainText("실제 골드가 아닌 모델 자원");
  for (let i = 1; i <= 3; i += 1) {
    await panel(page).getByRole("button", { name: "한 단계 (+1분)", exact: true }).click();
    await rowsMatchVisibleState(page, i);
  }
  const fixed = await history(page).innerHTML();
  await panel(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("98765");
  await panel(page).locator('.experiment-replay-team input[type="number"]').first().fill("-0.8");
  expect(await history(page).innerHTML()).toBe(fixed);
  await expect(panel(page).locator(".experiment-replay-outcome")).toHaveCount(0);
  await slider(page).focus(); await slider(page).press("End");
  const last = Number(await history(page).getAttribute("data-shown-minute"));
  expect(last).toBeGreaterThanOrEqual(3); await rowsMatchVisibleState(page, last);
  const compare = panel(page).locator("details.experiment-comparison"); await openDetails(compare);
  await compare.getByRole("button", { name: "이 실행을 비교 기준 A로 보관", exact: true }).click();
  await values.locator(":scope > summary").click();
  await history(page).screenshot({ path: testInfo.outputPath("model-resource-history.png") });
  expect((await history(page).locator(":scope > summary").boundingBox()).height).toBeGreaterThanOrEqual(44);
  await slider(page).focus(); await slider(page).press("Home");
  await openDetails(values); await rowsMatchVisibleState(page, 0);
  expect(await history(page).locator("polyline").evaluateAll(lines => lines.map(line => line.getAttribute("points")))).toEqual(initialLines);
  await expect(panel(page).locator(".experiment-replay-outcome")).toHaveCount(0);
  await panel(page).locator('button[type="submit"]').click();
  await expect(panel(page).locator(".experiment-replay-identity")).toContainText("실행 #2");
  await expect(compare.locator(".experiment-comparison-baseline")).toContainText("실행 #1");
  await rowsMatchVisibleState(page, 0);
  await panel(page).getByRole("button", { name: "한 단계 (+1분)", exact: true }).click();
  await rowsMatchVisibleState(page, 1);
  expect(errors).toEqual([]);
});
