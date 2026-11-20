import { expect } from "@playwright/test";

/** Follow the visible user flow; restored/deep-linked boards may already be open. */
export async function enterDraftForReview(page) {
  const begin = page.getByRole("button", { name: /^밴픽 (시작|이어가기)$/ });
  const share = page.getByRole("button", { name: "밴픽 링크 복사", exact: true });
  await expect.poll(async () => {
    if (await begin.isVisible() && await begin.isEnabled()) return "SETUP";
    if (await share.isVisible() && await share.isEnabled()) return "DRAFT";
    return "LOADING";
  }).not.toBe("LOADING");
  if (await begin.isVisible()) await begin.click();
  await expect(share).toBeVisible();
  await expect(share).toBeEnabled();
}
