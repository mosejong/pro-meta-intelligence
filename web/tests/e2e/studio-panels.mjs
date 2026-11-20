import { expect } from "@playwright/test";

/** Rail order and Korean tab names of the draft studio panels. */
export const STUDIO_PANELS = [
  ["DRAFT", "모의 밴픽"],
  ["ROSTER", "선수·로스터"],
  ["DETAILS", "상세 분석"],
  ["COMPARISON", "A/B 비교"],
  ["SIMULATION", "시뮬레이션 준비"],
];
const label = Object.fromEntries(STUDIO_PANELS);

export const studioTab = (page, id) =>
  page.getByRole("tablist", { name: "작업실 보기", exact: true }).getByRole("tab", { name: label[id], exact: true });
export const studioPanel = (page, id) => page.locator(`#studio-panel-${id.toLowerCase()}`);

/**
 * Enter the draft workspace the way a user does: wait for the setup step, click the visible
 * '밴픽 시작' / '밴픽 이어가기' button, then wait for the draft step and an interactive board.
 * If the page already restored onto the draft step (saved work or a deep link) it only waits.
 */
export async function enterDraftWorkspace(page) {
  const draft = page.getByRole("button", { name: "팀 선택으로", exact: true });
  const setup = page.locator(".draft-flow-setup");
  const start = setup.getByRole("button", { name: /^(밴픽 시작|밴픽 이어가기)$/ });
  // The start enables only after the local restore settled, and a restore with work already switched
  // steps by then, so wait for either final state before deciding (never click a hidden button).
  await expect.poll(async () => (await draft.isVisible()) || ((await setup.isVisible()) && (await start.isEnabled())), { timeout: 45_000 }).toBe(true);
  if (!(await draft.isVisible())) await start.click();
  await expect(draft).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
}

/** Switch panels the way a user does: click the rail tab, then wait for that panel to be shown. */
export async function showPanel(page, id) {
  const tab = studioTab(page, id);
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(studioPanel(page, id)).toBeVisible();
}
