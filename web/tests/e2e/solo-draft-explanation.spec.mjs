import { test, expect } from "@playwright/test";
const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const toggle = page => solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true });
const available = page => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const explain = page => solo(page).locator(".solo-explain");
async function open(page, side) {
  await page.goto(root);
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption(side);
  await toggle(page).check();
}

test("자동 선택 이유는 접힌 상세로 직전 기준 대안을 보여주고 읽기 전용이다", async ({ page }, testInfo) => {
  await open(page, "RED");
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(explain(page)).toHaveCount(1);
  await expect(explain(page).locator(".solo-draft-last")).toContainText("마지막 상대 선택");
  const details = explain(page).locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.getByText(/선택 직전 상태 기준/)).toBeHidden();
  await details.locator("summary").click();
  await expect(details).toContainText("1번째 차례(밴) 선택 직전 상태 기준");
  await expect(details).toContainText("상대 팀(");
  await expect(details).toContainText("예측이 아닙니다");
  await expect(details.getByText(/승률 \d|승리 확률|예측 승자/)).toHaveCount(0);
  await expect(details.locator("button, input, select, a")).toHaveCount(0);
  const before = await details.locator("li").allTextContents();
  expect(before.length).toBeLessThanOrEqual(2);
  for (const item of await details.locator("li").all()) await item.click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await explain(page).screenshot({ path: testInfo.outputPath("solo-explanation.png") });
});

test("되돌리기·자동 끄기·진영 전환 후 낡은 설명이 남지 않는다", async ({ page }) => {
  await open(page, "BLUE");
  await expect(available(page).first()).toBeEnabled();
  await available(page).first().click(); await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "2");
  await expect(explain(page)).toHaveCount(1);
  await expect(explain(page)).toContainText("마지막 상대 선택");
  await page.getByRole("button", { name: "내 마지막 선택 되돌리기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(explain(page)).toHaveCount(0);
  await available(page).first().click(); await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "2");
  await expect(explain(page)).toHaveCount(1);
  await toggle(page).uncheck();
  await expect(explain(page)).toHaveCount(0);
  await toggle(page).check();
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("RED");
  // BLUE is now the opponent: the shown explanation must be the new turn-3 choice, not the old turn-2 one.
  await expect(progress(page)).toHaveAttribute("value", "3");
  await explain(page).locator("summary").click();
  await expect(explain(page).locator("details")).toContainText("3번째 차례(밴) 선택 직전 상태 기준");
});
