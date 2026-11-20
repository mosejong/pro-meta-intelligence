import { test, expect } from "@playwright/test";
import { enterDraftWorkspace, showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const progress = (page) => page.locator(".draft-turn-progress");
const roster = (page) => page.locator("details.roster-workshop");
const pool = (page) => page.locator("details.player-pool");
const slot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const row = (page, side, role) => page.locator(`.player-pool-team.${side} > ul > li[data-role="${role}"]`);
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const search = (page) => page.locator("#draft-search");
const chips = (page, championId) => pool(page).locator(`.player-pool-champs li[data-champion="${championId}"]`);

async function openStudio(page) {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
}

async function openPool(page) {
  await showPanel(page, "ROSTER");
  if ((await roster(page).getAttribute("open")) === null) await roster(page).locator("> summary").click();
  await expect(slot(page, "blue", "TOP")).toBeEnabled();
  if ((await pool(page).getAttribute("open")) === null) await pool(page).locator("> summary").click();
  await expect(pool(page).getByRole("note")).toContainText("목록에 없는 챔프는 0회가 아니라 미확인");
  await expect(pool(page).getByRole("note")).toContainText("해당 포지션에서만 사용한 횟수가 아닙니다");
}

/** Every evidence row references exactly the player ID selected in the matching slot. */
async function expectRowsFollowSlots(page) {
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    const value = await slot(page, side, role).inputValue();
    if (!value) await expect(row(page, side, role)).toHaveAttribute("data-status", "EMPTY");
    else await expect(row(page, side, role)).toHaveAttribute("data-player-key", value);
  }
}

/** First listed, currently available pool champion that the picker can also stage. */
async function findTarget(page, exclude = []) {
  const listed = await pool(page).locator('.player-pool-champs li[data-state="AVAILABLE"]').evaluateAll((items) =>
    items.map((item) => ({ championId: item.dataset.champion, name: item.textContent.replace(/ \d+경기.*$/, "") })));
  const seen = new Set();
  // The search and picker live in the draft panel.
  await showPanel(page, "DRAFT");
  for (const { championId, name } of listed) {
    if (seen.has(championId) || exclude.includes(championId)) continue;
    seen.add(championId);
    await search(page).fill(name);
    const button = page.locator(".draft-picker-grid button:not(:disabled)").filter({ has: page.getByText(name, { exact: true }) });
    if (await button.count()) return { championId, name, button: button.first() };
  }
  throw new Error("no listed pool champion is stageable");
}

async function stageAndConfirm(page, target, turn) {
  await target.button.click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", String(turn));
  await search(page).fill("");
}

test("evidence follows roster edits, live bans/undo, next-set fearless locks, refresh and side swap", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await openStudio(page);
  await openPool(page);
  await expectRowsFollowSlots(page);
  await expect(roster(page).locator(".roster-workshop-note")).toContainText("기존 추천 순위·예측/시뮬레이션에는 로스터 변경이 아직 반영되지 않습니다");

  // Virtual transfer from a third team: the row switches to that player's own source-team record.
  const redName = (await page.locator(".roster-team.red h3").textContent()).replace(/^RED/, "");
  const before = await row(page, "blue", "SUPPORT").getAttribute("data-player-key");
  const foreign = await slot(page, "blue", "SUPPORT").evaluate((select, exclude) => [...select.querySelectorAll("optgroup")].slice(1)
    .filter((group) => !group.label.startsWith(`${exclude} `))
    .flatMap((group) => [...group.querySelectorAll("option")])[0]?.value ?? null, redName);
  expect(foreign).not.toBeNull();
  await slot(page, "blue", "SUPPORT").selectOption(foreign);
  await expect(row(page, "blue", "SUPPORT")).toHaveAttribute("data-player-key", foreign);
  expect(foreign).not.toBe(before);
  await expect(row(page, "blue", "SUPPORT")).toContainText("원팀(");
  await expectRowsFollowSlots(page);

  // Ban a listed champion: its chips become "this game ban"; undo restores them.
  const banned = await findTarget(page);
  await showPanel(page, "ROSTER");
  await expect(chips(page, banned.championId).first()).toBeVisible();
  await showPanel(page, "DRAFT");
  await stageAndConfirm(page, banned, 1);
  for (const chip of await chips(page, banned.championId).all()) await expect(chip).toHaveAttribute("data-state", "BANNED_NOW");
  await expect(pool(page).locator(".player-pool-focus").first()).toContainText(`선택 챔프 ${banned.name}`);
  await page.getByRole("button", { name: "한 수 되돌리기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  for (const chip of await chips(page, banned.championId).all()) await expect(chip).toHaveAttribute("data-state", "AVAILABLE");

  // Full set: ban the same champion, pick another listed champion at the first pick turn.
  await stageAndConfirm(page, await findTarget(page), 1);
  let picked = null;
  for (let turn = 2; turn <= 20; turn += 1) {
    if (!picked && (await confirm(page).textContent()) === "픽 확정") {
      picked = await findTarget(page, [banned.championId]);
      await stageAndConfirm(page, picked, turn);
      continue;
    }
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await expect(confirm(page)).toBeEnabled();
    await confirm(page).click();
    await expect(progress(page)).toHaveAttribute("value", String(turn));
  }
  expect(picked).not.toBeNull();
  await page.getByRole("button", { name: "세트 저장하고 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await openPool(page);
  for (const chip of await chips(page, picked.championId).all()) await expect(chip).toHaveAttribute("data-state", "FEARLESS_LOCKED");
  // An earlier set's ban is not a fearless lock.
  for (const chip of await chips(page, banned.championId).all()) await expect(chip).toHaveAttribute("data-state", "AVAILABLE");

  const details = page.locator(".draft-session-details");
  await showPanel(page, "DRAFT");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details.getByRole("status").filter({ hasText: "이 기기에 저장됨" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".draft-flow-draft")).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("region", { name: "피어리스 시리즈", exact: true })).toContainText("피어리스 · 2세트");
  await openPool(page);
  await expect(slot(page, "blue", "SUPPORT")).toHaveValue(foreign);
  await expectRowsFollowSlots(page);
  for (const chip of await chips(page, picked.championId).all()) await expect(chip).toHaveAttribute("data-state", "FEARLESS_LOCKED");

  await page.getByRole("button", { name: "팀 선택으로", exact: true }).click();
  await page.getByRole("button", { name: "블루와 레드 팀 교체", exact: true }).click();
  await enterDraftWorkspace(page);
  await openPool(page);
  await expect(slot(page, "red", "SUPPORT")).toHaveValue(foreign);
  await expectRowsFollowSlots(page);
  await expect(row(page, "red", "SUPPORT")).toContainText("원팀(");
  await expect(page.getByRole("region", { name: "피어리스 시리즈", exact: true })).toContainText("피어리스 · 2세트");

  const overflow = await page.evaluate(() => {
    const panel = document.querySelector("details.player-pool");
    return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel.scrollWidth - panel.clientWidth };
  });
  expect(overflow.panel).toBeLessThanOrEqual(0);
  expect(overflow.doc).toBeLessThanOrEqual(0);
  await pool(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("player-pool.png"), fullPage: true });
  expect(errors).toEqual([]);
});
