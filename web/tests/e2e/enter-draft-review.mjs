import { expect } from "@playwright/test";

/**
 * Follow the visible user flow; restored/deep-linked boards may already be open.
 * The draft step is recognised by its "팀 선택으로" control (as in studio-panels.mjs), not by an
 * enabled share button: sharing is legitimately disabled while an incoming link preview is open
 * or the board cannot be encoded, and that is not a loading state.
 */
export async function enterDraftForReview(page) {
  const back = page.getByRole("button", { name: "팀 선택으로", exact: true });
  const setup = page.locator(".draft-flow-setup");
  const begin = setup.getByRole("button", { name: /^밴픽 (시작|이어가기)$/ });
  await expect.poll(async () => {
    if (await back.isVisible()) return "DRAFT";
    if (await setup.isVisible() && await begin.isEnabled()) return "SETUP";
    return "LOADING";
  }, { timeout: 45_000 }).not.toBe("LOADING"); // local restore can be slow under parallel test load
  if (!(await back.isVisible())) await begin.click();
  await expect(back).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
}
