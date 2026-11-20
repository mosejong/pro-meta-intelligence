import { test, expect } from "@playwright/test";
import { enterDraftWorkspace, showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const progress = (page) => page.locator(".draft-turn-progress");
const readiness = (page) => page.locator("details.simulation-readiness");
const roster = (page) => page.locator("details.roster-workshop");
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const roleSlot = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
const panel = (page) => page.locator("section.experiment-replay");
const minuteText = async (page) => Number((await panel(page).locator(".experiment-replay-seek > span").innerText()).match(/(\d+)분/)[1]);

async function openDetails(locator) {
  if ((await locator.getAttribute("open")) === null) await locator.locator("> summary").click();
}

async function readyInput(page) {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await showPanel(page, "DRAFT");
  for (let i = 0; i < 20; i += 1) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(progress(page)).toHaveAttribute("value", String(i + 1));
  }
  await showPanel(page, "ROSTER");
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    if (await rosterSlot(page, side, role).inputValue()) continue;
    const used = [];
    for (const s of ["blue", "red"]) for (const r of ROLES) used.push(await rosterSlot(page, s, r).inputValue());
    const value = await rosterSlot(page, side, role).evaluate((select, taken) =>
      [...select.querySelectorAll("option")].map((o) => o.value).find((v) => v && !taken.includes(v)) ?? null, used.filter(Boolean));
    expect(value).not.toBeNull();
    await rosterSlot(page, side, role).selectOption(value);
  }
  await showPanel(page, "SIMULATION");
  await openDetails(readiness(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
}

test("keep finished run as A → change one assumption → B hidden until its end → rewind hides → clear A", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await readyInput(page);

  const inputs = panel(page).locator('.experiment-replay-team input[type="number"]');
  const seed = panel(page).getByLabel("재현 번호 (시드)", { exact: true });
  const runButton = panel(page).locator('button[type="submit"]');
  const result = panel(page).locator(".experiment-replay-result");
  const slider = result.locator('.experiment-replay-seek input[type="range"]');
  const compare = panel(page).locator("details.experiment-comparison");
  const keep = compare.getByRole("button", { name: "이 실행을 비교 기준 A로 보관" });
  const outcomeTable = compare.getByTestId("experiment-comparison-outcome");
  const pending = compare.locator(".experiment-comparison-pending");

  await seed.fill("4242");
  await runButton.click();
  await expect(result.locator(".experiment-replay-identity")).toContainText("실행 #1");

  // Collapsed by default; A can only be kept once the run has been played to its end.
  await expect(compare).not.toHaveAttribute("open", "");
  await compare.locator("> summary").click();
  await expect(keep).toBeDisabled();
  await slider.focus();
  await slider.press("End");
  await expect(result.locator(".experiment-replay-outcome")).toBeVisible();
  await expect(keep).toBeEnabled();
  await keep.focus();
  await keep.press("Enter");
  await expect(compare.locator(".experiment-comparison-status")).toBeFocused();
  await expect(compare.locator(".experiment-comparison-baseline")).toContainText("기준 A · 실행 #1 · 재현 번호 4242");
  await expect(compare.locator("> summary")).toContainText("기준 A 실행 #1");

  // B: one assumption only, finer-than-step decimal stays natively valid, same seed.
  await inputs.nth(2).fill("0.35");
  expect(await inputs.nth(2).evaluate((el) => el.validity.valid)).toBe(true);
  await runButton.click();
  await expect(result.locator(".experiment-replay-identity")).toContainText("실행 #2");
  expect(await minuteText(page)).toBe(0);
  const comparison = compare.locator(".experiment-comparison-result");
  await expect(comparison).toContainText("가정 1개 변경");
  await expect(comparison).toContainText("한타 0 → 0.35");
  await expect(compare.locator('td[data-changed="true"]')).toHaveCount(1);
  await expect(outcomeTable).toHaveCount(0);
  await expect(pending).toBeVisible();

  // Middle of B: still hidden.
  await result.getByRole("button", { name: "한 단계 (+1분)" }).click();
  await result.getByRole("button", { name: "한 단계 (+1분)" }).click();
  expect(await minuteText(page)).toBe(2);
  await expect(outcomeTable).toHaveCount(0);
  await expect(comparison).not.toContainText("모델 종료");

  // End of B: model-internal difference shown.
  await slider.focus();
  await slider.press("End");
  await expect(outcomeTable).toBeVisible();
  await expect(outcomeTable.locator("tbody tr")).toHaveCount(2);
  await expect(comparison).toContainText("모델 종료: A");
  await expect(pending).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await compare.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("experiment-comparison.png"), fullPage: true });

  // Rewind: hidden again; A is untouched by the slider.
  await slider.press("Home");
  expect(await minuteText(page)).toBe(0);
  await expect(outcomeTable).toHaveCount(0);
  await expect(pending).toBeVisible();
  await expect(compare.locator(".experiment-comparison-baseline")).toContainText("실행 #1 · 재현 번호 4242");

  // Different seed: refused even at the end.
  await seed.fill("4243");
  await runButton.click();
  await expect(result.locator(".experiment-replay-identity")).toContainText("실행 #3");
  await slider.focus();
  await slider.press("End");
  await expect(comparison.getByRole("alert")).toContainText("재현 번호가 다릅니다");
  await expect(outcomeTable).toHaveCount(0);

  // Clearing A keeps the current run and playback minute.
  const minuteBefore = await minuteText(page);
  await compare.getByRole("button", { name: "기준 A 해제" }).click();
  await expect(compare.locator(".experiment-comparison-baseline")).toHaveCount(0);
  await expect(compare.locator(".experiment-comparison-result")).toHaveCount(0);
  await expect(compare.locator(".experiment-comparison-status")).toContainText("현재 밴픽·실행·재생은 그대로");
  await expect(compare.locator(".experiment-comparison-status")).toBeFocused();
  await expect(result.locator(".experiment-replay-identity")).toContainText("실행 #3");
  expect(await minuteText(page)).toBe(minuteBefore);
  await expect(result.locator(".experiment-replay-outcome")).toBeVisible();
  await expect(progress(page)).toHaveAttribute("value", "20");
  expect(errors).toEqual([]);
});
