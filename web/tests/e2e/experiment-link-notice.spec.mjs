import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { enterDraftWorkspace, showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const report = JSON.parse(readFileSync(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
const teams = report.opponent_prep.teams;
const [x, y] = [teams[2].team_id, teams[3].team_id].sort();
const nameOf = (id) => teams.find((team) => team.team_id === id).team_name;
const encode = (data) => Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
const payload = { schema: "experiment-assumptions", version: 1, ruleset: "assumption-manager-v1", patch: report.patch_id, seed: 4242,
  teams: [{ id: x, lane: 0.5, tempo: 0, teamfight: -0.25 }, { id: y, lane: 0, tempo: 1, teamfight: 0 }] };
const linkHash = `experiment=${encode(payload)}`;

const setup = (page) => page.locator(".draft-flow-setup");
const notice = (page) => page.getByRole("region", { name: "가정값 링크를 받았어요", exact: true });
const choose = (page) => notice(page).getByRole("button", { name: "링크의 두 팀으로 고르기", exact: true });
const start = (page) => setup(page).getByRole("button", { name: /^(밴픽 시작|밴픽 이어가기)$/ });
const chosenTeams = (page) => setup(page).locator(".draft-match-setup .team-chooser-trigger").allInnerTexts();

async function waitReady(page) {
  await expect(start(page)).toBeEnabled({ timeout: 45_000 });
}
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
async function fillRoster(page) {
  await showPanel(page, "ROSTER");
  const workshop = page.locator("details.roster-workshop");
  if ((await workshop.getAttribute("open")) === null) await workshop.locator("> summary").click();
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

test("received link: notice → keyboard choose picks only the two teams, nothing runs; the simulation tab still has the link", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${root}#${linkHash}`);
  await waitReady(page);
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText(nameOf(x));
  await expect(notice(page)).toContainText(nameOf(y));
  await expect(notice(page)).toContainText("라인 0.5 · 운영 0 · 한타 -0.25");
  await expect(notice(page)).toContainText("재현 번호 4242");
  await expect(notice(page)).toContainText("현재 자료와 같음");
  await notice(page).locator("details > summary").click();
  await expect(notice(page)).toContainText("링크에 없는 것: 밴·픽");
  await expect(notice(page)).toContainText("실제 승률·선수 실력·경기 예측이 아닙니다");
  const before = await chosenTeams(page);
  expect(before.join(" ")).not.toContain(nameOf(x));
  expect((await choose(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("link-notice-received.png") });

  await choose(page).focus();
  await page.keyboard.press("Enter");
  const status = notice(page).getByRole("status");
  await expect(status).toContainText("링크의 두 팀을 골랐어요");
  await expect(status).toContainText("실행도 하지 않았어요");
  await expect(status).toBeFocused();
  await expect(notice(page)).toContainText("밴픽 20개를 끝내기");
  await expect(notice(page)).toContainText("받은 가정값 적용");
  const after = (await chosenTeams(page)).join(" ");
  expect(after).toContain(nameOf(x));
  expect(after).toContain(nameOf(y));
  // Still on team selection, no draft started, the fragment is kept for the simulation tab.
  await expect(setup(page)).toBeVisible();
  await expect(start(page)).toHaveText("밴픽 시작");
  expect(new URL(page.url()).hash).toBe(`#${linkHash}`);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("link-notice-chosen.png") });

  await enterDraftWorkspace(page);
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "0");
  // The remaining steps connect: 20 selections → roles → apply the received values → nothing runs until clicked.
  for (let i = 0; i < 20; i += 1) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", String(i + 1));
  }
  await page.getByRole("button", { name: "가정 시뮬레이션 준비", exact: true }).click();
  await fillRoster(page);
  await showPanel(page, "SIMULATION");
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) {
    await page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`).selectOption({ index: i + 1 });
  }
  await expect(page.locator("details.simulation-readiness").getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
  const share = page.locator("details.experiment-input-link");
  await expect(share.locator(":scope > summary")).toContainText("받은 링크 있음");
  await share.locator(":scope > summary").click();
  await share.getByRole("button", { name: "가정값 적용", exact: true }).click();
  const replay = page.locator("section.experiment-replay");
  await expect(replay.getByLabel("재현 번호 (시드)", { exact: true })).toHaveValue("4242");
  await expect(replay.locator(".experiment-replay-result")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("ignore hides the notice and keeps focus on the step; a reload asks again", async ({ page }) => {
  await page.goto(`${root}#${linkHash}`);
  await waitReady(page);
  const before = await chosenTeams(page);
  await notice(page).getByRole("button", { name: "무시", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator("#draft-flow-setup-title")).toBeFocused();
  expect(await chosenTeams(page)).toEqual(before);
  await page.reload();
  await waitReady(page);
  await expect(notice(page)).toBeVisible();
});

test("every dismissed link stays hidden in this page view: A, then B, then back to A does not ask again", async ({ page }) => {
  const linkB = `experiment=${encode({ ...payload, seed: 777 })}`;
  await page.goto(`${root}#${linkHash}`);
  await waitReady(page);
  await notice(page).getByRole("button", { name: "무시", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.evaluate(hash => { location.hash = hash; }, linkB);
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText("777");
  await notice(page).getByRole("button", { name: "무시", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${linkHash}`);
  await expect(notice(page)).toHaveCount(0);
  // A reload starts a new page view and asks again.
  await page.reload();
  await waitReady(page);
  await expect(notice(page)).toBeVisible();
});

test("draft in progress is never overwritten by the link", async ({ page }) => {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: "팀 선택으로", exact: true }).click();
  await expect(setup(page)).toBeVisible();
  const before = await chosenTeams(page);
  await page.evaluate((hash) => { location.hash = hash; }, linkHash);
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText("진행 중인 밴픽·시리즈가 있어 팀을 바꾸지 않았어요");
  await expect(choose(page)).toBeDisabled();
  expect(await chosenTeams(page)).toEqual(before);
  await noHorizontalOverflow(page);
  await start(page).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
});

test("broken link shows why and leaves the screen as it is", async ({ page }) => {
  await page.goto(`${root}#experiment=${encode({ ...payload, version: 9 })}`);
  await waitReady(page);
  const before = await chosenTeams(page);
  await expect(notice(page).getByRole("alert")).toContainText("지원하지 않는 가정값 링크 버전");
  await expect(choose(page)).toHaveCount(0);
  await notice(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await chosenTeams(page)).toEqual(before);
  await page.goto(`${root}#experiment=${encode({ ...payload, teams: [{ id: x, lane: 0, tempo: 0, teamfight: 0 }, { id: "zz:missing", lane: 0, tempo: 0, teamfight: 0 }] })}`);
  await waitReady(page);
  await expect(notice(page)).toContainText("현재 자료에 없는 팀");
  await expect(choose(page)).toBeDisabled();
  await expect(notice(page)).toContainText("현재 분석 자료에 없는 팀이 있어");
  await noHorizontalOverflow(page);
});
