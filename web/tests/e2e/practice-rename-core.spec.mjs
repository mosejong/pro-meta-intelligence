import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";

test("rename applies only after Enter and Escape cancels without changing saved draft", async ({ page }) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  const library = page.locator("details.draft-practice-library");
  await library.locator(":scope > summary").click();
  await library.getByLabel("연습 이름", { exact: true }).fill("첫 연습");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  const rename = library.getByRole("button", { name: "첫 연습 이름 바꾸기", exact: true });
  await expect(rename).toBeVisible();
  await rename.click();
  const input = library.getByLabel("새 이름", { exact: true });
  await expect(input).toBeFocused();
  await input.fill("취소할 이름"); await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(rename).toBeVisible();
  await rename.click(); await input.fill("두 번째 연습"); await input.press("Enter");
  await expect(library.getByRole("button", { name: "두 번째 연습 열기", exact: true })).toBeVisible();
  await expect(library.getByRole("button", { name: "첫 연습 열기", exact: true })).toHaveCount(0);
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
});
