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
const runButton = (page) => panel(page).locator('button[type="submit"]');
const minuteText = async (page) => Number((await panel(page).locator(".experiment-replay-seek > span").innerText()).match(/(\d+)분/)[1]);

async function openStudio(page) {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
}

async function openDetails(locator) {
  if ((await locator.getAttribute("open")) === null) await locator.locator("> summary").click();
}

async function finishDraft(page) {
  await showPanel(page, "DRAFT");
  for (let i = 0; i < 20; i += 1) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(progress(page)).toHaveAttribute("value", String(i + 1));
  }
}

async function usedPlayers(page) {
  const used = [];
  for (const side of ["blue", "red"]) for (const role of ROLES) used.push(await rosterSlot(page, side, role).inputValue());
  return used.filter(Boolean);
}

async function unusedPlayer(page, side, role) {
  const used = await usedPlayers(page);
  return rosterSlot(page, side, role).evaluate((select, taken) =>
    [...select.querySelectorAll("option")].map((option) => option.value).find((value) => value && !taken.includes(value)) ?? null, used);
}

async function fillRoster(page) {
  await showPanel(page, "ROSTER");
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    if (await rosterSlot(page, side, role).inputValue()) continue;
    const value = await unusedPlayer(page, side, role);
    expect(value).not.toBeNull();
    await rosterSlot(page, side, role).selectOption(value);
  }
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("experiment run is blocked until the simulation input is ready", async ({ page }) => {
  await openStudio(page);
  await showPanel(page, "SIMULATION");
  await expect(panel(page).getByRole("note")).toContainText("실제 LoL 승률이나 실제 경기 재현이 아니며");
  await expect(runButton(page)).toBeDisabled();
  await expect(panel(page).locator(".experiment-replay-blocked")).toContainText("입력 준비가 완료되어야");
  await expect(panel(page).locator(".experiment-replay-result")).toHaveCount(0);
  await expect(panel(page).getByText("모델 내부 결과")).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test("ready input → explicit run → pause/step/speed/seek/reset → later draft change keeps the fixed run", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  await finishDraft(page);
  await fillRoster(page);
  await showPanel(page, "SIMULATION");
  await openDetails(readiness(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();

  // Neutral defaults, nothing pre-filled from teams/champions; invalid values block the run.
  const inputs = panel(page).locator('.experiment-replay-team input[type="number"]');
  await expect(inputs).toHaveCount(6);
  for (let i = 0; i < 6; i += 1) await expect(inputs.nth(i)).toHaveValue("0");
  const helpIds = new Set();
  for (let i = 0; i < 6; i += 1) {
    const input = inputs.nth(i);
    const id = await input.getAttribute("id");
    await expect(input).toHaveAttribute("aria-describedby", `${id}-help`);
    await expect(panel(page).locator(`[id="${id}-help"]`)).toBeVisible();
    helpIds.add(`${id}-help`);
  }
  expect(helpIds.size).toBe(6);
  await noHorizontalOverflow(page);
  await expect(runButton(page)).toBeEnabled();
  await inputs.nth(0).fill("2");
  await expect(inputs.nth(0)).toHaveAttribute("aria-invalid", "true");
  const firstInputId = await inputs.nth(0).getAttribute("id");
  await expect(inputs.nth(0)).toHaveAttribute("aria-describedby", `${firstInputId}-help ${firstInputId}-issue`);
  await expect(panel(page).locator(`[id="${firstInputId}-issue"]`)).toBeVisible();
  await expect(panel(page).locator(`[id="${firstInputId}-help"]`)).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
  await inputs.nth(0).fill("");
  await expect(runButton(page)).toBeDisabled();
  await inputs.nth(0).fill("0.25");
  await expect(inputs.nth(0)).toHaveAttribute("aria-describedby", `${firstInputId}-help`);
  await expect(inputs.nth(0)).not.toHaveAttribute("aria-invalid");
  await inputs.nth(5).fill("-0.3");
  // Finer-than-0.1 decimals accepted by the parser are not blocked by native step validation.
  expect(await inputs.nth(0).evaluate((el) => el.validity.valid)).toBe(true);
  const seed = panel(page).getByLabel("재현 번호 (시드)", { exact: true });
  await expect(panel(page).locator("#experiment-seed-help")).toContainText("같은 번호와 가정값이면 언제나 같은 흐름");
  await seed.fill("1.5");
  await expect(runButton(page)).toBeDisabled();
  await seed.fill("12345");
  await expect(runButton(page)).toBeEnabled();
  await expect(panel(page).locator(".experiment-replay-result")).toHaveCount(0);

  // Keyboard: Enter in the seed field submits the explicit run.
  await seed.press("Enter");
  const result = panel(page).locator(".experiment-replay-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".experiment-replay-identity")).toContainText("현재 밴픽 입력·가정값과 같음");
  // The run really used 0.25 (not a rounded or earlier value).
  await expect(result.locator(".experiment-replay-fixed li").first()).toContainText("라인 0.25");
  await expect(result.locator(".experiment-replay-outcome")).toHaveCount(0);
  await expect(result.locator(".experiment-replay-pending")).toBeVisible();
  expect(await minuteText(page)).toBe(0);
  await expect(result.locator('[data-stat="base"]').first()).toHaveText("100/100");

  // Play → pause holds the minute; speed changes display speed only.
  await result.getByRole("button", { name: "4x" }).click();
  await expect(result.getByRole("button", { name: "4x" })).toHaveAttribute("aria-pressed", "true");
  await result.getByRole("button", { name: "재생", exact: true }).click();
  await expect.poll(() => minuteText(page)).toBeGreaterThan(1);
  await result.getByRole("button", { name: "일시정지" }).click();
  const paused = await minuteText(page);
  await page.waitForTimeout(800);
  expect(await minuteText(page)).toBe(paused);
  await result.getByRole("button", { name: "한 단계 (+1분)" }).click();
  expect(await minuteText(page)).toBe(paused + 1);
  await expect(result.locator(".experiment-replay-outcome")).toHaveCount(0);

  // Seek by keyboard: End shows the model-internal result, Home goes back with no result.
  const slider = result.locator('.experiment-replay-seek input[type="range"]');
  await slider.focus();
  await slider.press("End");
  const outcome = result.locator(".experiment-replay-outcome");
  await expect(outcome).toContainText("모델 내부 결과");
  await expect(outcome).toContainText("실제 승패·승률 예측이 아닙니다");
  const outcomeText = await outcome.innerText();
  const endMinute = await minuteText(page);
  expect(endMinute).toBeGreaterThanOrEqual(18);
  expect(endMinute).toBeLessThanOrEqual(45);
  await slider.press("Home");
  expect(await minuteText(page)).toBe(0);
  await expect(outcome).toHaveCount(0);
  await slider.press("End");
  await expect(outcome).toHaveText(outcomeText);
  await result.getByRole("button", { name: "처음", exact: true }).click();
  expect(await minuteText(page)).toBe(0);
  await expect(result.locator(".experiment-replay-outcome")).toHaveCount(0);
  // Playing to the end at 4x stops by itself with the same model result (no new computation).
  await result.getByRole("button", { name: "재생", exact: true }).click();
  await expect(result.locator(".experiment-replay-outcome")).toHaveText(outcomeText, { timeout: 30_000 });
  await expect(result.getByRole("button", { name: "처음부터 재생" })).toBeVisible();
  await noHorizontalOverflow(page);

  // Editing the assumption fields alone never reruns.
  await inputs.nth(1).fill("1");
  await expect(result.locator(".experiment-replay-identity")).toContainText("가정값/시드 입력란은 이 실행과 다름");
  await expect(result.locator(".experiment-replay-outcome")).toHaveText(outcomeText);

  // Change the current draft input (one roster slot): the run is labelled as an earlier run, unchanged.
  await result.locator(".experiment-replay-fixed > summary").click();
  const fixedBefore = await result.locator(".experiment-replay-fixed").textContent();
  await showPanel(page, "ROSTER");
  const replacement = await unusedPlayer(page, "blue", "SUPPORT");
  expect(replacement).not.toBeNull();
  await rosterSlot(page, "blue", "SUPPORT").selectOption(replacement);
  await showPanel(page, "SIMULATION");
  await expect(result.locator(".experiment-replay-identity")).toContainText("기존 실행");
  await expect(result.locator(".experiment-replay-fixed")).toHaveText(fixedBefore);
  await expect(result.locator(".experiment-replay-outcome")).toHaveText(outcomeText);
  await expect(progress(page)).toHaveAttribute("value", "20");
  await noHorizontalOverflow(page);
  await panel(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("experiment-replay.png"), fullPage: true });
  expect(errors).toEqual([]);
});


test("event navigation moves only within the fixed run and pauses playback", async ({ page }, testInfo) => {
  await openStudio(page); await finishDraft(page); await fillRoster(page);
  await showPanel(page, "SIMULATION"); await openDetails(readiness(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await expect(runButton(page)).toBeEnabled(); await runButton(page).click();
  const result = panel(page).locator(".experiment-replay-result");
  const nav = result.locator("details").filter({ has: page.locator("summary", { hasText: "사건 단위로 이동" }) });
  await expect(nav).not.toHaveAttribute("open", ""); await nav.locator(":scope > summary").click();
  const previous = nav.getByRole("button", { name: "이전 사건", exact: true });
  const next = nav.getByRole("button", { name: "다음 사건", exact: true });
  const end = nav.getByRole("button", { name: "결과까지 이동", exact: true });
  await expect(previous).toBeDisabled(); await expect(next).toBeEnabled();
  await next.click(); const first = await minuteText(page); expect(first).toBeGreaterThan(0);
  await next.click(); const second = await minuteText(page); expect(second).toBeGreaterThan(first);
  await previous.click(); expect(await minuteText(page)).toBe(first);
  await result.getByRole("button", { name: "재생", exact: true }).click();
  await expect(result.getByRole("button", { name: "일시정지", exact: true })).toBeVisible();
  await next.click(); const held = await minuteText(page);
  await expect(result.getByRole("button", { name: "재생", exact: true })).toBeVisible();
  await page.waitForTimeout(800); expect(await minuteText(page)).toBe(held);
  await end.click(); const finalOutcome = await result.locator(".experiment-replay-outcome").innerText();
  const finalStats = await result.locator("[data-stat]").allTextContents();
  await expect(end).toBeDisabled();
  await previous.click(); await expect(result.locator(".experiment-replay-outcome")).toHaveCount(0);
  await panel(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("98765");
  await end.click();
  expect(await result.locator(".experiment-replay-outcome").innerText()).toBe(finalOutcome);
  expect(await result.locator("[data-stat]").allTextContents()).toEqual(finalStats);
  await expect(result.locator(".experiment-replay-identity")).toContainText("실행 #1");
  await expect(result.locator(".experiment-replay-identity")).toContainText("다름");
  await noHorizontalOverflow(page);
  const box = await next.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44);
  await nav.screenshot({ path: testInfo.outputPath("experiment-event-navigation.png") });
});


async function readySummaryExperiment(page) {
  await openStudio(page); await finishDraft(page); await fillRoster(page);
  await showPanel(page, "SIMULATION"); await openDetails(readiness(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await panel(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("12345");
  await expect(runButton(page)).toBeEnabled(); await runButton(page).click();
  const result = panel(page).locator(".experiment-replay-result");
  const nav = result.locator("details.experiment-replay-event-nav");
  await nav.locator(":scope > summary").click();
  return { result, nav, share: result.locator(".experiment-result-share"), slider: result.locator('.experiment-replay-seek input[type="range"]') };
}

test("completed experiment summary copies frozen values and discards stale text on seek and new run", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  const { result, nav, share, slider } = await readySummaryExperiment(page);
  const copy = share.getByRole("button", { name: "가정 실험 요약 복사", exact: true });
  const text = share.getByLabel("가정 실험 요약 글 (직접 복사)", { exact: true });
  await expect(copy).toBeDisabled(); await expect(text).toHaveCount(0);
  await nav.getByRole("button", { name: "결과까지 이동", exact: true }).click();
  const states = await result.locator("[data-stat]").allTextContents();
  await copy.click(); await expect(text).toBeVisible();
  const original = await text.inputValue();
  expect(original).toContain("실행 #1"); expect(original).toContain("고정 시드 12345");
  expect(original).toContain("모델 내부 승자"); expect(original).toContain("실제 LoL 승패·승률 예측이 아닙니다");
  expect(original).not.toContain("oe:player:"); expect(original).not.toContain("schema_version");
  expect(await result.locator("[data-stat]").allTextContents()).toEqual(states);
  await panel(page).getByLabel("재현 번호 (시드)", { exact: true }).fill("98765");
  await expect(result.locator(".experiment-replay-identity")).toContainText("다름");
  expect(await text.inputValue()).toBe(original);
  await slider.focus(); await slider.press("Home"); await expect(copy).toBeDisabled(); await expect(text).toHaveCount(0);
  await nav.getByRole("button", { name: "결과까지 이동", exact: true }).click();
  await expect(copy).toBeEnabled(); await expect(text).toHaveCount(0);
  await copy.click(); expect(await text.inputValue()).toBe(original);
  await runButton(page).click(); await expect(copy).toBeDisabled(); await expect(text).toHaveCount(0);
  await nav.getByRole("button", { name: "결과까지 이동", exact: true }).click();
  await copy.click(); const fresh = await text.inputValue();
  expect(fresh).toContain("실행 #2"); expect(fresh).toContain("고정 시드 98765"); expect(fresh).not.toContain("고정 시드 12345");
  await noHorizontalOverflow(page);
  expect((await copy.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await share.screenshot({ path: testInfo.outputPath("experiment-result-readable-copy.png") });
});

test("late experiment clipboard completion stays hidden after seeking back and returning to the end", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise(resolve => { window.__releaseExperimentCopy = resolve; }) } }));
  const { nav, share, slider } = await readySummaryExperiment(page);
  const copy = share.getByRole("button", { name: "가정 실험 요약 복사", exact: true });
  await nav.getByRole("button", { name: "결과까지 이동", exact: true }).click();
  await copy.click(); await expect(copy).toBeDisabled();
  await slider.focus(); await slider.press("Home");
  await nav.getByRole("button", { name: "결과까지 이동", exact: true }).click();
  await expect(copy).toBeEnabled();
  await page.evaluate(() => window.__releaseExperimentCopy());
  await expect(share).not.toContainText("복사했");
  await expect(share.getByRole("status")).toHaveText("");
  await expect(share.locator("textarea")).toHaveCount(0);
  await copy.click(); await page.evaluate(() => window.__releaseExperimentCopy());
  await expect(share.getByRole("status")).toContainText("복사했어요");
});
