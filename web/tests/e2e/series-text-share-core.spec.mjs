import { test, expect } from "@playwright/test";

test("three Fearless sets copy as readable text; a changed series hides the old fallback", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  const next = page.getByRole("region", { name: "이번 밴픽 리포트", exact: true }).getByRole("button", { name: "피어리스 다음 세트", exact: true });
  for (let game = 0; game < 3; game++) {
    for (let turn = 0; turn < 20; turn++) {
      await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
      await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    }
    if (game < 2) await next.click();
  }
  const recap = page.locator("details.draft-series-recap");
  await recap.locator(":scope > summary").click();
  await recap.getByRole("button", { name: "여러 세트 밴픽 복사", exact: true }).click();
  const text = recap.getByLabel("여러 세트 밴픽 글 (직접 복사)", { exact: true });
  await expect(text).toBeVisible();
  const value = await text.inputValue();
  expect(value).toContain("1세트"); expect(value).toContain("2세트"); expect(value).toContain("3세트");
  expect(value).toContain("30"); expect(value).not.toContain("schema_version");
  await next.click();
  await expect(text).toHaveCount(0);
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "0");
});
