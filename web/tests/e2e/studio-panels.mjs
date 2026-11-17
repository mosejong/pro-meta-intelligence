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

/** Switch panels the way a user does: click the rail tab, then wait for that panel to be shown. */
export async function showPanel(page, id) {
  const tab = studioTab(page, id);
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(studioPanel(page, id)).toBeVisible();
}
