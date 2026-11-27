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
