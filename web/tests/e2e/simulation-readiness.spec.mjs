import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const root = "/pro-meta-intelligence/";
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const ROSTER_KEY = "pro-meta-roster-scenario-v1";
const progress = (page) => page.locator(".draft-turn-progress");
const panel = (page) => page.locator("details.simulation-readiness");
const roster = (page) => page.locator("details.roster-workshop");
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const roleSlot = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);

async function openStudio(page) {
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
}

async function openDetails(locator) {
  if ((await locator.getAttribute("open")) === null) await locator.locator("> summary").click();
}

async function finishDraft(page) {
  for (let i = 0; i < 20; i += 1) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(progress(page)).toHaveAttribute("value", String(i + 1));
  }
}

async function rosterValues(page) {
  const result = {};
  for (const side of ["blue", "red"]) for (const role of ROLES) result[`${side}.${role}`] = await rosterSlot(page, side, role).inputValue();
  return result;
}

/** An observed player not placed in any slot of the pair (so assigning never empties another slot). */
async function unusedPlayer(page, side, role) {
  const used = Object.values(await rosterValues(page)).filter(Boolean);
  return rosterSlot(page, side, role).evaluate((select, taken) =>
    [...select.querySelectorAll("option")].map((option) => option.value).find((value) => value && !taken.includes(value)) ?? null, used);
}

/** Fill every empty roster slot explicitly; the readiness gate requires ten players. */
async function fillRoster(page) {
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    if (await rosterSlot(page, side, role).inputValue()) continue;
    const value = await unusedPlayer(page, side, role);
    expect(value).not.toBeNull();
    await rosterSlot(page, side, role).selectOption(value);
  }
}

test("incomplete draft shows only a short unmet notice in the collapsed panel", async ({ page }) => {
  await openStudio(page);
  await expect(panel(page)).not.toHaveAttribute("open", "");
  await expect(panel(page).locator("> summary")).toContainText("미충족 · 밴픽 0/20");
  await openDetails(panel(page));
  await expect(panel(page).getByRole("status").filter({ hasText: "현재 0/20개" })).toBeVisible();
  await expect(panel(page).locator("select")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "준비된 입력 고정", exact: true })).toBeDisabled();
  // The main draft controls stay usable with the panel open.
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(panel(page).getByRole("status").filter({ hasText: "현재 1/20개" })).toBeVisible();
});

test("20 turns → explicit roles → fix → export → read-only replay → roster change shows a different input", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  await finishDraft(page);
  await fillRoster(page);
  await openDetails(panel(page));
  const body = panel(page);
  await expect(body.getByRole("note")).toContainText("역할은 사용자 배정");
  await expect(body.getByRole("note")).toContainText("선수 근거는 현재 관측이며 연간 자료는 포함하지 않습니다");
  await expect(body.getByRole("note")).toContainText("학습된 선수/챔피언 효과·상성·룬·아이템·실제 승률은 아직 계산하지 않습니다");

  // Nothing is pre-filled from pick order.
  for (const side of ["blue", "red"]) for (const role of ROLES) await expect(roleSlot(page, side, role)).toHaveValue("");
  const fix = body.getByRole("button", { name: "준비된 입력 고정", exact: true });
  await expect(fix).toBeDisabled();
  // Explicit assignment in reverse pick order on blue; choosing a champion twice moves it.
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) {
    await roleSlot(page, side, role).selectOption({ index: side === "blue" ? 5 - i : i + 1 });
  }
  const blueTop = await roleSlot(page, "blue", "TOP").inputValue();
  await roleSlot(page, "blue", "MID").selectOption(blueTop);
  await expect(roleSlot(page, "blue", "TOP")).toHaveValue("");
  await expect(fix).toBeDisabled();
  await roleSlot(page, "blue", "TOP").selectOption({ index: 3 });
  await expect(body.getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
  await fix.click();
  await expect(body.getByRole("region", { name: "고정한 시뮬레이션 입력" })).toContainText("현재 입력과 같음");

  const downloadPromise = page.waitForEvent("download");
  await body.getByRole("button", { name: "입력 JSON 저장", exact: true }).click();
  const filePath = testInfo.outputPath("manager-scenario.json");
  await (await downloadPromise).saveAs(filePath);
  const artifact = JSON.parse(await readFile(filePath, "utf8"));
  expect(artifact.artifact_type).toBe("manager-scenario");
  expect(artifact.schema_version).toBe(1);
  expect(artifact.input.roster.evidence_scope).toBe("CURRENT_REPORT_PLAYER_OBSERVATIONS");
  expect(artifact.readiness.outcome_computed).toBe(false);
  const blueId = artifact.input.blue_team.team_id;
  expect(Object.values(artifact.input.champion_roles[blueId]).every(Boolean)).toBe(true);
  expect(JSON.stringify(artifact)).not.toMatch(/"winner"/);

  // Replay is read-only: draft, roster editor, its device copy and the A/B panel stay as they are.
  const live = await rosterValues(page);
  const stored = await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);
  const unchanged = async (expectedRoster = live, expectedStored = stored) => {
    await expect(progress(page)).toHaveAttribute("value", "20");
    expect(await rosterValues(page)).toEqual(expectedRoster);
    expect(await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY)).toBe(expectedStored);
    await expect(page.getByRole("region", { name: "드래프트 A/B 비교", exact: true })
      .getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true })).toBeEnabled();
  };
  const replay = body.locator(".simulation-readiness-replay");
  const fileInput = replay.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);
  await expect(replay.getByRole("status").filter({ hasText: "기록된 준비 결과와 일치" })).toBeVisible();
  await expect(replay.locator(".simulation-readiness-identity")).toHaveText("현재 입력과 같음");
  await unchanged();

  // Change one roster slot: the replayed file and the fixed input now differ from the current input.
  const replacement = await unusedPlayer(page, "blue", "SUPPORT");
  expect(replacement).not.toBeNull();
  await rosterSlot(page, "blue", "SUPPORT").selectOption(replacement);
  await expect(replay.locator(".simulation-readiness-identity")).toHaveText("현재 입력과 다름");
  await expect(body.getByRole("region", { name: "고정한 시뮬레이션 입력" })).toContainText("고정 뒤 현재 입력이 바뀌었습니다");
  const edited = await rosterValues(page);
  const editedStored = await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);

  // Invalid files are rejected without touching the current work.
  const mutate = (fn) => { const copy = structuredClone(artifact); fn(copy); return Buffer.from(JSON.stringify(copy)); };
  for (const [name, buffer, message] of [
    ["future.json", mutate((f) => { f.schema_version = 2; }), "지원하지 않는 시나리오 파일 버전"],
    ["tampered.json", mutate((f) => { f.readiness.input_fingerprint = "0000000000000000"; }), "준비 결과"],
    ["ghost.json", mutate((f) => { f.input.roster.rosters[blueId].TOP.player_id = "ghost-id"; }), "가상 로스터"],
    ["broken.json", Buffer.from("{"), "JSON 파일을 읽을 수 없습니다"],
  ]) {
    await fileInput.setInputFiles({ name, mimeType: "application/json", buffer });
    await expect(replay.getByRole("alert")).toContainText(message);
    await expect(replay.locator(".simulation-readiness-identity")).toHaveCount(0);
    await unchanged(edited, editedStored);
  }
  await body.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("simulation-readiness.png"), fullPage: true });
  expect(errors).toEqual([]);
});
