import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const progress = page => page.locator(".draft-turn-progress");
const result = page => page.getByRole("region", { name: "이번 밴픽 리포트", exact: true });
const library = page => page.locator("details.draft-practice-library");
const board = page => page.locator('.draft-position-board[aria-label="블루 포지션 배정"]');

async function finish(page) {
  for (let step = 0; step < 40; step++) {
    const before = Number(await progress(page).getAttribute("value"));
    if (before === 20) return;
    const available = page.locator(".draft-picker-grid button:not(:disabled)");
    if (await available.count()) {
      await available.first().click();
      await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    }
    await expect.poll(async () => Number(await progress(page).getAttribute("value"))).toBeGreaterThan(before);
  }
  throw new Error("Three-set practice stalled");
}

async function openLibrary(page) {
  if (await library(page).getAttribute("open") === null) await library(page).locator(":scope > summary").click();
}

test("three automatic-opponent sets → role assignment → named save → reload → replace → retry", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await showPanel(page, "DRAFT");
  const solo = page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
  await solo.getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  for (let set = 1; set <= 3; set++) {
    await finish(page);
    await expect(page.locator("details.draft-series-recap .draft-series-recap-game")).toHaveCount(set);
    if (set < 3) {
      await result(page).getByRole("button", { name: "피어리스 다음 세트", exact: true }).click();
      await expect(progress(page)).toHaveAttribute("value", "0");
      await expect(page.locator(".draft-series-locks > span")).toHaveCount(set * 10);
    }
  }
  const champion = await board(page).locator("article[data-champion-id]").first().getAttribute("data-champion-id");
  await board(page).locator(`article[data-champion-id="${champion}"] select`).selectOption("SUPPORT");
  await openLibrary(page);
  await library(page).getByLabel("연습 이름", { exact: true }).fill("3세트 통합 연습");
  await library(page).getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library(page).getByRole("status")).toContainText("저장했습니다");
  await result(page).getByRole("button", { name: "피어리스 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await page.reload();
  await enterDraftForReview(page);
  await openLibrary(page);
  await library(page).getByRole("button", { name: "3세트 통합 연습 열기", exact: true }).click();
  await library(page).getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "20");
  await expect(page.locator("details.draft-series-recap .draft-series-recap-game")).toHaveCount(3);
  await expect(board(page).locator(`article[data-champion-id="${champion}"] select`)).toHaveValue("SUPPORT");
  await expect(library(page).getByRole("status")).toContainText("불러왔습니다");
  await result(page).getByRole("button", { name: "같은 팀으로 다시 도전", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true });
  await dialog.getByRole("button", { name: "계속 분석하기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "20");
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("core-loop.png"), fullPage: true });
});
