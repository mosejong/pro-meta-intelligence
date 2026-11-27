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
const result = (page) => panel(page).locator(".experiment-replay-result");
const log = (page) => result(page).locator(".experiment-event-log");
const rows = (page) => log(page).getByRole("list", { name: "지금까지의 모델 사건", exact: true }).locator("li");
const toggle = (page) => log(page).locator(".experiment-event-log-head button");
const minuteText = async (page) => Number((await panel(page).locator(".experiment-replay-seek > span").innerText()).match(/(\d+)분/)[1]);
const rowMinutes = async (page) => (await rows(page).locator("span").allTextContents()).map((text) => Number(text.replace("분", "")));

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

async function fillRoster(page) {
  await showPanel(page, "ROSTER");
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    if (await rosterSlot(page, side, role).inputValue()) continue;
    const used = [];
    for (const s of ["blue", "red"]) for (const r of ROLES) used.push(await rosterSlot(page, s, r).inputValue());
    const value = await rosterSlot(page, side, role).evaluate((select, taken) =>
      [...select.querySelectorAll("option")].map((option) => option.value).find((v) => v && !taken.includes(v)) ?? null, used.filter(Boolean));
    expect(value).not.toBeNull();
    await rosterSlot(page, side, role).selectOption(value);
  }
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("event log: latest 8 by default, keyboard expands every event up to the shown minute, never the future", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(root);
  await enterDraftWorkspace(page);
  await finishDraft(page);
  await fillRoster(page);
  await showPanel(page, "SIMULATION");
  await openDetails(readiness(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();

  // Before a run there is no log at all; at minute 0 there is the empty message and no toggle.
  await expect(log(page)).toHaveCount(0);
  await panel(page).locator('button[type="submit"]').click();
  await expect(result(page)).toBeVisible();
  expect(await minuteText(page)).toBe(0);
  await expect(rows(page)).toHaveText(["아직 교전·오브젝트 사건이 없습니다."]);
  await expect(toggle(page)).toHaveCount(0);

  // Jump to the result: more than 8 events → folded list of 8 with a collapsed toggle.
  await openDetails(result(page).locator(".experiment-replay-event-nav"));
  await result(page).getByRole("button", { name: "결과까지 이동", exact: true }).click();
  await expect(result(page).locator(".experiment-replay-outcome")).toContainText("실제 승패·승률 예측이 아닙니다");
  const endMinute = await minuteText(page);
  const outcomeText = await result(page).locator(".experiment-replay-outcome").innerText();
  await expect(rows(page)).toHaveCount(8);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  const label = await toggle(page).innerText();
  const total = Number(label.match(/전체 (\d+)건 펼치기/)[1]);
  expect(total).toBeGreaterThan(8);
  const folded = await rows(page).allTextContents();
  expect((await toggle(page).boundingBox()).height).toBeGreaterThanOrEqual(44);

  // Keyboard: Enter on the toggle expands to every event; the folded 8 are its tail, in order.
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(toggle(page)).toHaveText("최근 8건만 보기");
  await expect(toggle(page)).toBeFocused();
  await expect(rows(page)).toHaveCount(total);
  const full = await rows(page).allTextContents();
  expect(full.slice(-8)).toEqual(folded);
  const fullMinutes = await rowMinutes(page);
  expect(fullMinutes).toEqual([...fullMinutes].sort((a, b) => a - b));
  expect(Math.max(...fullMinutes)).toBeLessThanOrEqual(endMinute);
  // Showing the log changes neither the shown minute nor the model result.
  expect(await minuteText(page)).toBe(endMinute);
  await expect(result(page).locator(".experiment-replay-outcome")).toHaveText(outcomeText);
  await noHorizontalOverflow(page);
  await log(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("experiment-event-log-expanded.png") });

  // Rewind by keyboard to an earlier minute: only events up to that minute, no result shown.
  const slider = result(page).locator('.experiment-replay-seek input[type="range"]');
  await slider.focus();
  await slider.press("Home");
  for (let m = 0; m < Math.floor(endMinute / 2); m += 1) await slider.press("ArrowRight");
  const mid = await minuteText(page);
  expect(mid).toBe(Math.floor(endMinute / 2));
  await expect(result(page).locator(".experiment-replay-outcome")).toHaveCount(0);
  const midMinutes = await rowMinutes(page);
  expect(midMinutes.every((m) => m <= mid)).toBe(true);
  // Still expanded (or 8 or fewer events): exactly the events up to that minute, nothing later.
  expect(midMinutes).toEqual(fullMinutes.filter((m) => m <= mid));

  // Collapse again, then back to the end: the same 8 latest events as before.
  await slider.press("End");
  await expect(rows(page)).toHaveCount(total);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rows(page)).toHaveText(folded);

  // Expand, then make a new run: the old log disappears and the new run starts folded at minute 0.
  await toggle(page).click();
  await expect(rows(page)).toHaveCount(total);
  await panel(page).locator('.experiment-replay-team input[type="number"]').first().fill("1");
  await panel(page).locator('button[type="submit"]').click();
  await expect(result(page).locator(".experiment-replay-identity")).toContainText("실행 #2");
  expect(await minuteText(page)).toBe(0);
  await expect(rows(page)).toHaveText(["아직 교전·오브젝트 사건이 없습니다."]);
  await expect(toggle(page)).toHaveCount(0);
  await result(page).getByRole("button", { name: "결과까지 이동", exact: true }).click();
  await expect(result(page).locator(".experiment-replay-outcome")).toBeVisible();
  if (await toggle(page).count()) await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  expect(await rows(page).count()).toBeLessThanOrEqual(8);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
