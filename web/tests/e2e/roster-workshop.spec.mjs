import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const root = "/pro-meta-intelligence/";
const progress = (page) => page.locator(".draft-turn-progress");
const roster = (page) => page.locator("details.roster-workshop");
const slot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];

test("a delayed file read from a previous matchup cannot overwrite the new roster", async ({ page }) => {
  await openStudio(page);
  await openRoster(page);
  const redName = (await page.locator(".roster-team.red h3").textContent()).replace(/^RED/, "");
  await slot(page, "blue", "SUPPORT").selectOption(await foreignOption(page, "blue", redName));
  const file = await page.evaluate(() => localStorage.getItem("pro-meta-roster-scenario-v1"));
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "delayed-roster.json") return original.call(this);
      return new Promise((resolve) => { window.releaseRosterRead = () => original.call(this).then(resolve); });
    };
  });
  await roster(page).locator('input[type="file"]').setInputFiles({ name: "delayed-roster.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await expect.poll(() => page.evaluate(() => typeof window.releaseRosterRead)).toBe("function");
  const oldBlue = await page.getByRole("button", { name: /^BLUE TEAM:/ }).locator("strong").textContent();
  await page.getByRole("button", { name: /^BLUE TEAM:/ }).click();
  const dialog = page.getByRole("dialog", { name: "BLUE TEAM", exact: true });
  await dialog.getByRole("button", { name: "전체", exact: true }).click();
  const choice = dialog.locator(".team-choice-grid button").filter({ hasNotText: oldBlue }).filter({ hasNotText: redName }).first();
  await choice.click();
  await expect(dialog).not.toBeVisible();
  await openRoster(page);
  await slot(page, "blue", "TOP").selectOption("");
  const latest = await page.evaluate(() => localStorage.getItem("pro-meta-roster-scenario-v1"));
  expect(latest).not.toBe(file);
  await page.evaluate(async () => { await window.releaseRosterRead(); });
  // Wait for the old read continuation using a browser task, without a timing assumption.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => localStorage.getItem("pro-meta-roster-scenario-v1"))).toBe(latest);
  await expect(progress(page)).toHaveAttribute("value", "0");
});

async function openStudio(page) {
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
}

async function openRoster(page) {
  if ((await roster(page).getAttribute("open")) === null) await roster(page).locator("> summary").click();
  await expect(roster(page).locator(".roster-workshop-body")).toBeVisible();
  await expect(slot(page, "blue", "TOP")).toBeEnabled();
}

async function values(page, side) {
  const result = {};
  for (const role of ROLES) result[role] = await slot(page, side, role).inputValue();
  return result;
}

/** First option from another team's optgroup, excluding the opposing team (a true virtual transfer). */
async function foreignOption(page, side, excludeTeam) {
  return slot(page, side, "SUPPORT").evaluate((select, exclude) => [...select.querySelectorAll("optgroup")].slice(1)
    .filter((group) => !group.label.startsWith(`${exclude} `))
    .flatMap((group) => [...group.querySelectorAll("option")])[0]?.value ?? null, excludeTeam);
}

test("edit, move, device restore and side swap keep each team's virtual roster", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  await openRoster(page);
  await expect(roster(page).getByRole("note")).toContainText("기존 추천 순위·예측/시뮬레이션에는 로스터 변경이 아직 반영되지 않습니다");
  await expect(roster(page).getByRole("note")).toContainText("공식 최신 소속이 아닙니다");
  const blueName = (await page.locator(".roster-team.blue h3").textContent()).replace(/^BLUE/, "");
  const redName = (await page.locator(".roster-team.red h3").textContent()).replace(/^RED/, "");

  // Virtual transfer from a third team.
  const foreign = await foreignOption(page, "blue", redName);
  expect(foreign).not.toBeNull();
  await slot(page, "blue", "SUPPORT").selectOption(foreign);
  const supportRow = page.locator('.roster-team.blue li[data-role="SUPPORT"]');
  await expect(supportRow).toHaveClass(/changed/);
  await expect(supportRow).toContainText("가상 변경:");
  await expect(supportRow).toContainText("원관측과 다름");
  await expect(roster(page).getByRole("status").filter({ hasText: "이 기기에 가상 로스터 저장됨" })).toBeVisible();

  // Move a player already placed on the red side: the old slot becomes empty, never duplicated.
  const redBefore = await values(page, "red");
  const movedRole = ROLES.find((role) => redBefore[role]);
  expect(movedRole).toBeTruthy();
  await slot(page, "blue", "MID").selectOption(redBefore[movedRole]);
  await expect(roster(page).getByRole("status").filter({ hasText: "옮겼습니다" })).toBeVisible();
  await expect(slot(page, "red", movedRole)).toHaveValue("");
  await expect(page.locator(`.roster-team.red li[data-role="${movedRole}"]`)).toContainText("빈칸 · 미확인");
  const blueEdited = await values(page, "blue");
  const redEdited = await values(page, "red");
  await expect(roster(page).locator("> summary")).not.toContainText("원관측과 다른 슬롯 0");

  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  await expect(roster(page).getByRole("status").filter({ hasText: "복원했습니다" })).toBeVisible();
  expect(await values(page, "blue")).toEqual(blueEdited);
  expect(await values(page, "red")).toEqual(redEdited);

  await page.getByRole("button", { name: "블루와 레드 팀 교체", exact: true }).click();
  await expect(page.locator(".roster-team.blue h3")).toContainText(redName);
  await expect(page.locator(".roster-team.red h3")).toContainText(blueName);
  expect(await values(page, "red")).toEqual(blueEdited);
  expect(await values(page, "blue")).toEqual(redEdited);
  await roster(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("roster-swapped.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("roster files round-trip, invalid files are rejected and the draft is never replaced", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  // One confirmed draft turn that must survive every roster file operation.
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");

  await openRoster(page);
  const redName = (await page.locator(".roster-team.red h3").textContent()).replace(/^RED/, "");
  await slot(page, "blue", "SUPPORT").selectOption(await foreignOption(page, "blue", redName));
  await slot(page, "blue", "TOP").selectOption("");
  const edited = { blue: await values(page, "blue"), red: await values(page, "red") };

  const downloadPromise = page.waitForEvent("download");
  await roster(page).getByRole("button", { name: "로스터 파일 저장", exact: true }).click();
  const filePath = testInfo.outputPath("roster.json");
  await (await downloadPromise).saveAs(filePath);
  const artifact = JSON.parse(await readFile(filePath, "utf8"));
  expect(artifact.artifact_type).toBe("roster-scenario");
  expect(artifact.schema_version).toBe(1);
  expect(artifact.team_ids).toHaveLength(2);

  await roster(page).getByRole("button", { name: "원관측으로 되돌리기", exact: true }).click();
  await expect(roster(page).locator("> summary")).toContainText("원관측과 다른 슬롯 0");
  const observed = { blue: await values(page, "blue"), red: await values(page, "red") };

  const input = roster(page).locator('input[type="file"]');
  const bad = async (name, buffer, message) => {
    await input.setInputFiles({ name, mimeType: "application/json", buffer });
    await expect(roster(page).getByRole("alert")).toContainText(message);
    expect({ blue: await values(page, "blue"), red: await values(page, "red") }).toEqual(observed);
    await expect(progress(page)).toHaveAttribute("value", "1");
  };
  const mutate = (fn) => { const copy = structuredClone(artifact); fn(copy); return Buffer.from(JSON.stringify(copy)); };
  await bad("broken.json", Buffer.from("{"), "JSON을 읽을 수 없습니다");
  await bad("future.json", mutate((file) => { file.schema_version = 2; }), "새 버전");
  await bad("pair.json", mutate((file) => { file.team_ids = [file.team_ids[0], "not-a-team"]; }), "다른 로스터 파일");
  await bad("basis.json", mutate((file) => { file.basis.patch_id = "0.0"; }), "패치·cutoff·출처");
  await bad("dup.json", mutate((file) => {
    const [first, second] = file.team_ids;
    const placed = Object.values(file.rosters[first]).find(Boolean);
    const role = Object.keys(file.rosters[second]).find((key) => !file.rosters[second][key] || file.rosters[second][key].player_id !== placed.player_id);
    file.rosters[second][role] = placed;
  }), "같은 선수");
  await bad("ghost.json", mutate((file) => { file.rosters[file.team_ids[0]].MID = { source_team_id: file.team_ids[0], player_id: "ghost-id" }; }), "확인할 수 없는 선수");
  await bad("large.json", Buffer.alloc(70 * 1024, 32), "64KB");

  await input.setInputFiles(filePath);
  await expect(roster(page).getByRole("status").filter({ hasText: "로스터 파일을 불러왔습니다" })).toBeVisible();
  expect({ blue: await values(page, "blue"), red: await values(page, "red") }).toEqual(edited);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(page.locator('.roster-team.blue li[data-role="TOP"]')).toContainText("빈칸 · 미확인");
  await page.screenshot({ path: testInfo.outputPath("roster-loaded.png"), fullPage: true });
  expect(errors).toEqual([]);
});
