import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const progress = page => page.locator(".draft-turn-progress");
const example = page => page.locator("details.simulation-example");
const apply = page => example(page).getByRole("button", { name: "이 예시로 입력 준비", exact: true });
const readiness = page => page.locator("details.simulation-readiness");
const ready = page => readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" });
const rosterValues = page => page.locator(".roster-team li[data-role] select").evaluateAll(selects => selects.map(s => s.value));
async function open(page) {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
}
async function openExample(page) {
  await showPanel(page, "SIMULATION");
  if (await example(page).getAttribute("open") === null) await example(page).locator(":scope > summary").click();
}
const stored = page => page.evaluate(() => new Promise(resolve => {
  const opening = indexedDB.open("pro-meta-draft", 1);
  opening.onerror = () => resolve(null);
  opening.onsuccess = () => {
    const db = opening.result;
    const get = db.transaction("sessions").objectStore("sessions").get("current");
    get.onerror = () => { db.close(); resolve(null); };
    get.onsuccess = () => { db.close(); resolve(typeof get.result === "string" ? JSON.parse(get.result) : null); };
  };
}));

for (const side of ["BLUE", "RED"]) test(`explicit ${side}-first example preserves roster, locks data, restores roles and never auto-runs`, async ({ page }, testInfo) => {
  await open(page);
  if (side === "RED") await page.locator(".draft-first-selection select").selectOption("RED");
  const before = await rosterValues(page);
  expect(before.filter(Boolean)).toHaveLength(10);
  const savedRoster = await page.evaluate(() => localStorage.getItem("pro-meta-roster-scenario-v1"));
  await showPanel(page, "SIMULATION");
  await expect(example(page)).not.toHaveAttribute("open", "");
  await openExample(page); await expect(apply(page)).toBeEnabled();
  await expect(example(page).locator(".simulation-example-team li")).toHaveCount(10);
  if (side === "BLUE") await example(page).screenshot({ path: testInfo.outputPath("simulation-example-preview.png") });
  await expect(page.locator(".experiment-replay-result")).toHaveCount(0);
  await apply(page).click(); await expect(progress(page)).toHaveAttribute("value", "20");
  await expect(ready(page)).toBeVisible();
  await expect(apply(page)).toBeDisabled();
  await expect(page.getByText("고정된 분석 데이터", { exact: true })).toBeVisible();
  expect(await rosterValues(page)).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("pro-meta-roster-scenario-v1"))).toBe(savedRoster);
  const blueTop = page.locator('.simulation-readiness-team.blue li[data-role="TOP"] select');
  await expect(blueTop).toHaveValue("Gnar");
  await expect(page.locator('.simulation-readiness-team.red li[data-role="SUPPORT"] select')).toHaveValue("Nautilus");
  await expect(page.locator(".experiment-replay-result")).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.selections?.length).toBe(20);
  await expect.poll(async () => Object.values((await stored(page))?.current_game_positions ?? {}).flatMap(s => Object.values(s.roles).filter(Boolean)).length).toBe(10);
  expect((await stored(page)).first_pick_side).toBe(side);
  expect((await stored(page)).analysis_snapshot).toBeTruthy();
  await page.reload(); await expect(progress(page)).toHaveAttribute("value", "20");
  await openExample(page); await expect(ready(page)).toBeVisible(); await expect(apply(page)).toBeDisabled();
  await expect(blueTop).toHaveValue("Gnar");
  await expect(page.locator(".experiment-replay-result")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await apply(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
  if (side === "BLUE") await example(page).screenshot({ path: testInfo.outputPath("simulation-example.png") });
  if (side === "BLUE") {
    const experiment = page.locator("section.experiment-replay");
    const run = experiment.locator('button[type="submit"]');
    await expect(run).toBeEnabled(); await run.click();
    const result = experiment.locator(".experiment-replay-result");
    await expect(result).toBeVisible();
    await expect(result.locator(".experiment-replay-identity")).toContainText("실행 #1");
    const slider = result.locator('.experiment-replay-seek input[type="range"]');
    await slider.focus(); await slider.press("End");
    await expect(result.locator(".experiment-replay-outcome")).toContainText("모델 내부 결과");
    await expect(result.locator(".experiment-replay-outcome")).toContainText("실제 승패·승률 예측이 아닙니다");
    await result.screenshot({ path: testInfo.outputPath("simulation-example-explicit-run.png") });
  }
  // Moving to the next Fearless set must not offer the first-set example over existing history.
  await showPanel(page, "DRAFT");
  await page.getByRole("region", { name: "이번 밴픽 리포트", exact: true }).getByRole("button", { name: "피어리스 다음 세트", exact: true }).click();
  await openExample(page); await expect(apply(page)).toBeDisabled();
  await expect(example(page)).toContainText("이전 세트");
});

test("staged and confirmed work is not overwritten by the example", async ({ page }) => {
  await open(page); await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await openExample(page); await expect(apply(page)).toBeDisabled(); await expect(example(page)).toContainText("덮어쓰지 않습니다");
  await showPanel(page, "DRAFT");
  await expect(page.locator(".draft-lock-in").getByRole("button", { name: "밴 확정", exact: true })).toBeEnabled();
  await page.locator(".draft-lock-in").getByRole("button", { name: "밴 확정", exact: true }).click();
  await openExample(page); await expect(apply(page)).toBeDisabled();
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("historical player assignment cannot be replaced or bypassed by an example", async ({ page }) => {
  await open(page); await showPanel(page, "ROSTER");
  const season = page.locator("details.season-lineup"); await season.locator(":scope > summary").click();
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  await season.getByLabel("선수 시즌", { exact: true }).selectOption("2015");
  const top = season.getByLabel("BLUE 탑 시즌 선수", { exact: true });
  const marin = await top.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 MaRin"))?.value);
  expect(marin).toBeTruthy(); await top.selectOption(marin);
  await openExample(page); await expect(apply(page)).toBeDisabled(); await expect(example(page)).toContainText("과거 시즌 선수");
  await expect(page.locator(".experiment-replay-result")).toHaveCount(0);
  await expect(progress(page)).toHaveAttribute("value", "0");
  await showPanel(page, "ROSTER"); await expect(top).toHaveValue(marin);
});
