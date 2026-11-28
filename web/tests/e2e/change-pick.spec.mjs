import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { enterDraftWorkspace } from "./studio-panels.mjs";

// P1 "한 픽 바꿔 재도전": result → change one of my picks → replay the later turns → compare or go back.
const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const available = page => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const result = page => page.getByRole("region", { name: "이번 밴픽 리포트", exact: true });
const banner = page => page.locator(".draft-pick-change");
const pickNames = (page, side) => result(page).locator(`.draft-result-teams > .${side} .draft-result-picks strong`).allTextContents();

async function humanPick(page, offset = 0) {
  await expect(available(page).nth(offset)).toBeEnabled();
  await available(page).nth(offset).click(); await confirm(page).click();
}
async function complete(page, offset = 0) {
  for (let step = 0; step < 30; step++) {
    const before = Number(await progress(page).getAttribute("value"));
    if (before === 20) return;
    if (await available(page).count()) await humanPick(page, offset);
    else await expect.poll(async () => Number(await progress(page).getAttribute("value"))).toBeGreaterThan(before);
  }
  throw new Error("Draft did not complete within bounded interactions");
}

test("결과에서 내 픽 하나를 바꿔 이후 차례를 다시 진행하고, 원래 밴픽으로 돌아갈 수 있다", async ({ page }) => {
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(root);
  await enterDraftWorkspace(page);
  await enterDraftForReview(page);
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("BLUE");
  await solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  await complete(page);
  await expect(result(page)).toBeVisible();
  const originalBlue = await pickNames(page, "blue");
  const originalRed = await pickNames(page, "red");
  expect(originalBlue).toHaveLength(5);

  // Only my side offers the change in solo practice.
  await expect(result(page).locator(".draft-result-teams > .red .draft-result-change-pick")).toHaveCount(0);
  const changeButtons = result(page).locator(".draft-result-teams > .blue .draft-result-change-pick");
  await expect(changeButtons).toHaveCount(5);
  await changeButtons.nth(1).click();

  // Rewound to just before that pick: the result is gone, the banner names the pick being changed.
  await expect(result(page)).toHaveCount(0);
  await expect(banner(page)).toContainText(`${originalBlue[1]} 픽을 바꾸는 중이에요`);
  const rewoundTo = Number(await progress(page).getAttribute("value"));
  expect(rewoundTo).toBeGreaterThan(5);
  expect(rewoundTo).toBeLessThan(20);
  await expect(banner(page).getByRole("button", { name: "원래 밴픽으로 돌아가기" })).toBeVisible();

  // Pick something else and replay the rest (auto opponent continues legally).
  await complete(page, 3);
  await expect(result(page)).toBeVisible();
  await expect(banner(page)).toContainText("바꾼 밴픽이에요");
  const changedBlue = await pickNames(page, "blue");
  expect(changedBlue).toHaveLength(5);
  expect(changedBlue[0]).toBe(originalBlue[0]);
  expect(changedBlue).not.toEqual(originalBlue);

  // Going back restores the exact original board and result.
  await banner(page).getByRole("button", { name: "원래 밴픽으로 돌아가기" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(progress(page)).toHaveAttribute("value", "20");
  expect(await pickNames(page, "blue")).toEqual(originalBlue);
  expect(await pickNames(page, "red")).toEqual(originalRed);
  expect(errors).toEqual([]);
});

test("바꾼 밴픽을 그대로 두면 안내가 사라지고 새로고침 후에도 바꾼 결과가 남는다", async ({ page }) => {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await enterDraftForReview(page);
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("BLUE");
  await solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  await complete(page);
  const originalBlue = await pickNames(page, "blue");
  await result(page).locator(".draft-result-teams > .blue .draft-result-change-pick").last().click();
  await complete(page, 2);
  await expect(banner(page)).toContainText("바꾼 밴픽이에요");
  const changedBlue = await pickNames(page, "blue");
  expect(changedBlue).not.toEqual(originalBlue);
  await banner(page).getByRole("button", { name: "이대로 두기" }).click();
  await expect(banner(page)).toHaveCount(0);
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "20");
  expect(await pickNames(page, "blue")).toEqual(changedBlue);
});

// Review (#164 P1): a pick change belongs to its own board. Replacing the board must drop the backup so
// "원래 밴픽으로 돌아가기" can never overwrite a draft that was loaded afterwards.
async function soloBlue(page) {
  await enterDraftWorkspace(page);
  await enterDraftForReview(page);
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("BLUE");
  await solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
}

test("픽을 바꾸는 중에 같은 팀의 다른 공유 밴픽을 불러오면 바꾸기 안내와 원래 밴픽 백업이 사라진다", async ({ browser }) => {
  // Draft B in its own browser context; its link is read from the copy field.
  const other = await browser.newContext();
  await other.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async v => { window.__link = v; } } }));
  const b = await other.newPage();
  await b.goto(root); await soloBlue(b); await complete(b, 7);
  const draftB = await pickNames(b, "blue");
  await b.getByRole("button", { name: "밴픽 링크 복사", exact: true }).click();
  await expect.poll(() => b.evaluate(() => window.__link ?? "")).toMatch(/#draft=/);
  const link = await b.evaluate(() => window.__link);
  await other.close();

  const page = await browser.newPage();
  await page.goto(root); await soloBlue(page); await complete(page);
  const draftA = await pickNames(page, "blue");
  expect(draftA).not.toEqual(draftB);
  await result(page).locator(".draft-result-teams > .blue .draft-result-change-pick").nth(1).click();
  await expect(banner(page)).toBeVisible();

  await page.evaluate(h => { location.hash = new URL(h).hash; }, link);
  await page.getByRole("region", { name: "공유 밴픽 미리보기", exact: true }).getByRole("button", { name: "이 밴픽 불러오기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "20");
  expect(await pickNames(page, "blue")).toEqual(draftB);
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "원래 밴픽으로 돌아가기" })).toHaveCount(0);
  await page.close();
});

test("픽을 바꾸는 중에 보관함 연습을 불러오면 바꾸기 안내가 사라지고 불러온 밴픽이 유지된다", async ({ page }) => {
  await page.goto(root); await soloBlue(page); await complete(page, 5);
  const saved = await pickNames(page, "blue");
  const library = page.locator("details.draft-practice-library");
  await library.locator("summary").click();
  await library.getByLabel("연습 이름", { exact: true }).fill("바꾸기 전 저장");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("button", { name: "바꾸기 전 저장 열기", exact: true })).toBeEnabled();

  await result(page).locator(".draft-result-teams > .blue .draft-result-change-pick").first().click();
  await expect(banner(page)).toBeVisible();
  await complete(page, 1);
  expect(await pickNames(page, "blue")).not.toEqual(saved);
  await expect(banner(page)).toContainText("바꾼 밴픽이에요");

  await library.getByRole("button", { name: "바꾸기 전 저장 열기", exact: true }).click();
  await library.getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect.poll(() => pickNames(page, "blue")).toEqual(saved);
  await expect(banner(page)).toHaveCount(0);
});

test("픽을 바꾸는 중에는 팀을 바꿀 수 없고, 세트를 초기화해 팀을 바꿨다 되돌리면 이전 바꾸기 안내가 살아나지 않는다", async ({ page }) => {
  await page.goto(root); await soloBlue(page); await complete(page);
  await result(page).locator(".draft-result-teams > .blue .draft-result-change-pick").first().click();
  await expect(banner(page)).toBeVisible();
  const back = page.getByRole("button", { name: "팀 선택으로", exact: true });
  const blueTrigger = page.locator(".draft-flow-setup .team-chooser-trigger").first();
  // Setup keeps the board: the team choosers are locked while work is in progress.
  await back.click();
  await expect(blueTrigger).toBeDisabled();
  const blueTeam = await blueTrigger.locator("strong").textContent();
  await page.locator(".draft-flow-setup").getByRole("button", { name: /^밴픽 (시작|이어가기)$/ }).click();
  await expect(banner(page)).toBeVisible();
  // Changing teams requires a reset, which ends the pick change for good (also after switching back).
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true }).getByRole("button", { name: "초기화", exact: true }).click();
  await expect(banner(page)).toHaveCount(0);
  await back.click();
  const swap = page.locator(".draft-flow-setup .draft-match-setup > button");
  await expect(swap).toBeEnabled();
  await swap.click();
  await swap.click();
  await expect(blueTrigger.locator("strong")).toHaveText(blueTeam);
  await page.locator(".draft-flow-setup").getByRole("button", { name: /^밴픽 (시작|이어가기)$/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "원래 밴픽으로 돌아가기" })).toHaveCount(0);
});

test("직접 모드에서는 양 팀 픽을 모두 바꿀 수 있고, 피어리스 2세트에서 바꿔도 1세트 잠금은 그대로다", async ({ page }) => {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await enterDraftForReview(page);
  // Manual mode (default): every turn is made by hand.
  await expect(solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true })).not.toBeChecked();
  await complete(page);
  const blueButtons = result(page).locator(".draft-result-teams > .blue .draft-result-change-pick");
  const redButtons = result(page).locator(".draft-result-teams > .red .draft-result-change-pick");
  await expect(blueButtons).toHaveCount(5);
  await expect(redButtons).toHaveCount(5);

  // Set 2 under Fearless: the ten set-1 picks are locked before and after a change.
  const setOnePicks = [...await pickNames(page, "blue"), ...await pickNames(page, "red")];
  await page.getByRole("button", { name: "세트 저장하고 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await complete(page);
  const setTwoRed = await pickNames(page, "red");
  for (const name of setTwoRed) expect(setOnePicks).not.toContain(name);
  await result(page).locator(".draft-result-teams > .red .draft-result-change-pick").nth(2).click();
  await expect(banner(page)).toContainText(`${setTwoRed[2]} 픽을 바꾸는 중이에요`);
  await expect(page.getByRole("region", { name: "피어리스 시리즈", exact: true })).toContainText("피어리스 · 2세트");
  await page.getByRole("checkbox", { name: "선택 가능한 챔피언만", exact: true }).uncheck();
  for (const name of setOnePicks) {
    const champion = page.locator(".draft-picker-grid button").filter({ has: page.locator("span", { hasText: new RegExp(`^${name}$`) }) });
    await expect(champion).toBeDisabled();
  }
  await page.getByRole("checkbox", { name: "선택 가능한 챔피언만", exact: true }).check();
  await complete(page, 4);
  const changedRed = await pickNames(page, "red");
  expect(changedRed).not.toEqual(setTwoRed);
  for (const name of changedRed) expect(setOnePicks).not.toContain(name);
  // Restoring in set 2 brings back the exact set-2 board and keeps the series (set 1 locks) intact.
  await banner(page).getByRole("button", { name: "원래 밴픽으로 돌아가기" }).click();
  await expect(banner(page)).toHaveCount(0);
  expect(await pickNames(page, "red")).toEqual(setTwoRed);
  await expect(page.getByRole("region", { name: "피어리스 시리즈", exact: true })).toContainText("피어리스 · 2세트");
  await page.getByRole("checkbox", { name: "선택 가능한 챔피언만", exact: true }).uncheck();
  for (const name of setOnePicks) {
    const champion = page.locator(".draft-picker-grid button").filter({ has: page.locator("span", { hasText: new RegExp(`^${name}$`) }) });
    await expect(champion).toBeDisabled();
  }
});
