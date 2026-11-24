import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";

const root = "/pro-meta-intelligence/";
const progress = (page) => page.locator(".draft-turn-progress");
const available = (page) => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const panel = (page) => page.locator("details.draft-practice-library");
const nameInput = (page) => panel(page).getByLabel("연습 이름", { exact: true });
const saveButton = (page) => panel(page).getByRole("button", { name: "이 연습 저장", exact: true });
const items = (page) => panel(page).locator(".draft-practice-list > li:not(.draft-practice-empty)");

async function open(page) {
  await page.goto(root);
  await enterDraftForReview(page);
}
async function advance(page, target) {
  while (Number(await progress(page).getAttribute("value")) < target) {
    const before = Number(await progress(page).getAttribute("value"));
    await available(page).first().click();
    await confirm(page).click();
    await expect(progress(page)).toHaveAttribute("value", String(before + 1));
  }
}
async function openPanel(page) {
  await panel(page).locator("summary").click();
  await expect(panel(page).locator("summary")).toContainText("/5");
}
async function savePractice(page, name) {
  await nameInput(page).fill(name);
  await saveButton(page).click();
  await expect(panel(page).getByRole("status")).toContainText("저장했습니다");
}

test("panel is collapsed; opening the list does not change the draft", async ({ page }) => {
  await open(page);
  await advance(page, 3);
  await expect(panel(page)).not.toHaveAttribute("open", "");
  await openPanel(page);
  await expect(progress(page)).toHaveAttribute("value", "3");
  await expect(panel(page).getByText("저장한 연습이 없습니다.")).toBeVisible();
});

test("save, reload, open with confirmation (cancel keeps work), and delete", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await advance(page, 8);
  await openPanel(page);
  await savePractice(page, "결승 1세트 연습");
  await expect(items(page)).toHaveCount(1);
  // Duplicate name is rejected, nothing overwritten.
  await nameInput(page).fill("결승 1세트 연습");
  await expect(saveButton(page)).toBeDisabled();
  await expect(panel(page).locator("#draft-practice-hint")).toContainText("같은 이름");
  await nameInput(page).fill("");

  await advance(page, 10);
  await page.reload();
  await expect(progress(page)).toHaveAttribute("value", "10");
  await openPanel(page);
  await expect(items(page)).toHaveCount(1);
  // In-progress work → explicit confirmation; Escape/취소 keeps the current draft.
  const openButton = panel(page).getByRole("button", { name: "결승 1세트 연습 열기" });
  await openButton.click();
  const dialog = panel(page).getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openButton).toBeFocused();
  await expect(progress(page)).toHaveAttribute("value", "10");
  await openButton.click();
  await panel(page).getByRole("alertdialog").getByRole("button", { name: "바꾸기" }).click();
  await expect(progress(page)).toHaveAttribute("value", "8");
  await expect(panel(page).getByRole("status")).toContainText("불러왔습니다");

  await panel(page).getByRole("button", { name: "결승 1세트 연습 삭제" }).click();
  await panel(page).getByRole("alertdialog").getByRole("button", { name: "삭제" }).click();
  await expect(items(page)).toHaveCount(0);
  await expect(progress(page)).toHaveAttribute("value", "8");
  expect(errors).toEqual([]);
});

test("limit of 5 disables saving with a clear message", async ({ page }) => {
  await open(page);
  await advance(page, 2);
  await openPanel(page);
  for (let i = 1; i <= 5; i++) await savePractice(page, `연습 ${i}`);
  await expect(items(page)).toHaveCount(5);
  await nameInput(page).fill("연습 6");
  await expect(saveButton(page)).toBeDisabled();
  await expect(panel(page).locator("#draft-practice-hint")).toContainText("최대 5개");
});

test("390px: no horizontal overflow and 44px touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await advance(page, 2);
  await openPanel(page);
  await savePractice(page, "아주 긴 이름의 연습 기록입니다 모바일 화면에서도 넘치지 않아야 합니다 확인");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  for (const box of await panel(page).locator("button, input, summary").evaluateAll((nodes) =>
    nodes.filter((node) => node.getClientRects().length).map((node) => node.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(44);
  }
});
