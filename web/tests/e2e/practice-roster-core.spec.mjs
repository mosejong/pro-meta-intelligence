import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

test("one saved practice restores its current-player roster together with the draft", async ({ page }) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  for (let i = 0; i < 2; i++) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  }
  await showPanel(page, "ROSTER");
  const slot = page.locator('.roster-team.blue li[data-role="SUPPORT"] select');
  await expect(slot).toBeEnabled();
  const alternate = await slot.evaluate(select => [...select.options].find(option => option.value && option.value !== select.value && !option.disabled)?.value);
  expect(alternate).toBeTruthy();
  await slot.selectOption(alternate);
  await showPanel(page, "DRAFT");
  const library = page.locator("details.draft-practice-library");
  await library.locator(":scope > summary").click();
  const includeRoster = library.getByRole("checkbox", { name: "현재 선수 구성도 함께 저장", exact: true });
  await expect(includeRoster).toBeChecked();
  await library.getByLabel("연습 이름", { exact: true }).fill("선수 구성 함께 보관");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("현재 선수 구성도 함께 저장했습니다");
  await showPanel(page, "ROSTER");
  await slot.selectOption("");
  await expect(slot).toHaveValue("");
  await showPanel(page, "DRAFT");
  await library.getByRole("button", { name: "선수 구성 함께 보관 열기", exact: true }).click();
  await library.getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("함께 저장한 선수 구성도 복원");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "2");
  await showPanel(page, "ROSTER");
  await expect(slot).toHaveValue(alternate);
});
