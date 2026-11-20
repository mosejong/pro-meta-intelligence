import { test, expect } from "@playwright/test";
const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const toggle = page => solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true });
const available = page => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const review = page => solo(page).locator(".solo-history");
const undo = page => page.getByRole("button", { name: "내 마지막 선택 되돌리기", exact: true });
async function open(page, side) {
  await page.goto(root);
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption(side);
  await toggle(page).check();
}
async function manualTurn(page, expected) {
  await available(page).first().click(); await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", String(expected));
}

test("접힌 복기 목록은 실제 자동 차례만 순서대로 보여주고 마지막 선택 설명은 유지된다", async ({ page }, testInfo) => {
  await open(page, "BLUE");
  // BLUE first pick: manual 1, auto 2, manual 3, auto 4.
  await manualTurn(page, 2);
  await manualTurn(page, 4);
  await expect(review(page)).not.toHaveAttribute("open", "");
  await expect(review(page).locator("> summary")).toHaveText("이번 세트 자동 선택 복기 (2)");
  await review(page).locator("> summary").click();
  const items = review(page).locator("> ol > li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator("summary")).toContainText("2번째 차례 · ");
  await expect(items.nth(1).locator("summary")).toContainText("4번째 차례 · ");
  await items.nth(0).locator("summary").click();
  await expect(items.nth(0)).toContainText("2번째 차례(밴) 선택 직전 상태 기준");
  await expect(items.nth(0)).toContainText("예측이 아닙니다");
  await expect(review(page).locator("input, select, a")).toHaveCount(0);
  await expect(review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true })).toBeVisible();
  // The last-choice explanation still shows only the latest auto turn.
  await expect(solo(page).locator(".solo-explain .solo-draft-last")).toContainText("마지막 상대 선택");
  await solo(page).locator(".solo-explain summary").click();
  await expect(solo(page).locator(".solo-explain details")).toContainText("4번째 차례(밴) 선택 직전 상태 기준");
  await expect(progress(page)).toHaveAttribute("value", "4");
  await review(page).screenshot({ path: testInfo.outputPath("solo-history.png") });
});

test("되돌리기·자동 끄기·진영 전환 시 잘못된 복기 기록이 남지 않는다", async ({ page }) => {
  await open(page, "BLUE");
  await manualTurn(page, 2);
  await manualTurn(page, 4);
  await expect(review(page).locator("> summary")).toHaveText("이번 세트 자동 선택 복기 (2)");
  // Undo the manual turn 3 (auto turn 4 goes with it): only turn 2 stays.
  await undo(page).click();
  await expect(progress(page)).toHaveAttribute("value", "2");
  await expect(review(page).locator("> summary")).toHaveText("이번 세트 자동 선택 복기 (1)");
  await undo(page).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(review(page)).toHaveCount(0);
  await manualTurn(page, 2);
  await expect(review(page).locator("> summary")).toHaveText("이번 세트 자동 선택 복기 (1)");
  await toggle(page).uncheck();
  await expect(review(page)).toHaveCount(0);
  // Manual play while auto is off never appears as automatic.
  await manualTurn(page, 3);
  await expect(review(page)).toHaveCount(0);
  // Switch side while auto is OFF (no auto timer can race), then turn auto back ON.
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("RED");
  await toggle(page).check();
  // Turn 4 is RED = the user's turn now, so nothing is auto-confirmed and nothing is recorded.
  await expect(progress(page)).toHaveAttribute("value", "3");
  await expect(review(page)).toHaveCount(0);
  // User confirms turn 4; BLUE (now the opponent) auto-confirms turn 5.
  await manualTurn(page, 5);
  await expect(review(page).locator("> summary")).toHaveText("이번 세트 자동 선택 복기 (1)");
  await review(page).locator("> summary").click();
  await expect(review(page).locator("> ol > li summary")).toHaveText(/^5번째 차례 · /);
});
