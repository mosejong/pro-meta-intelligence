import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";

test("failed champion portraits get a neutral placeholder and keep their names", async ({ page }) => {
  // Force the CDN to fail (as in regions or networks where Data Dragon is blocked).
  await page.route("**/ddragon.leagueoflegends.com/**", route => route.abort());
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  const first = page.locator(".draft-picker-grid button").first();
  await expect(first.locator("img")).toHaveAttribute("data-asset-failed", "");
  expect(await first.locator("img").evaluate(img => getComputedStyle(img).content)).toContain("data:image/svg+xml");
  await expect(first.locator("span")).not.toHaveText("");
  await expect(first.locator("span")).toBeVisible();
});
