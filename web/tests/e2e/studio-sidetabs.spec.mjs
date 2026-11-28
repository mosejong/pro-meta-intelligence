import { test, expect } from "@playwright/test";
import { enterDraftWorkspace, STUDIO_PANELS, showPanel, studioPanel, studioTab } from "./studio-panels.mjs";

/**
 * The draft studio splits into five real tab panels (draft, roster, details, A/B, simulation readiness).
 * All panels stay mounted and hidden, so switching never discards work.
 */
const root = "/pro-meta-intelligence/";
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const IDS = STUDIO_PANELS.map(([id]) => id);
const progress = (page) => page.locator(".draft-turn-progress");
const picker = (page) => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const staged = (page) => page.locator(".draft-lock-in > div > span");
const roster = (page) => page.locator("details.roster-workshop");
const readiness = (page) => page.locator("details.simulation-readiness");
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const roleSlot = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
const comparison = (page) => page.getByRole("region", { name: "드래프트 A/B 비교", exact: true });
const isDesktop = (testInfo) => testInfo.project.name === "desktop";

async function openStudio(page) {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(picker(page).first()).toBeEnabled();
}

async function openDetails(locator) {
  if ((await locator.getAttribute("open")) === null) await locator.locator("> summary").click();
}

async function finishDraft(page) {
  await showPanel(page, "DRAFT");
  for (let i = 0; i < 20; i += 1) {
    await picker(page).first().click();
    await confirm(page).click();
    await expect(progress(page)).toHaveAttribute("value", String(i + 1));
  }
}

async function rosterValues(page) {
  const result = {};
  for (const side of ["blue", "red"]) for (const role of ROLES) result[`${side}.${role}`] = await rosterSlot(page, side, role).inputValue();
  return result;
}

async function roleValues(page) {
  const result = {};
  for (const side of ["blue", "red"]) for (const role of ROLES) result[`${side}.${role}`] = await roleSlot(page, side, role).inputValue();
  return result;
}

/** Only the selected panel is shown; every other panel and its content is hidden. */
async function expectOnly(page, id) {
  for (const other of IDS) {
    await expect(studioTab(page, other)).toHaveAttribute("aria-selected", String(other === id));
    await expect(studioTab(page, other)).toHaveAttribute("tabindex", other === id ? "0" : "-1");
    if (other === id) await expect(studioPanel(page, other)).toBeVisible();
    else await expect(studioPanel(page, other)).toBeHidden();
  }
}

async function roundTrip(page, from) {
  for (const id of IDS) if (id !== from) await showPanel(page, id);
  await showPanel(page, from);
}

test("entry shows only the draft panel and hidden panels do not lengthen the page", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  const tabs = page.getByRole("tablist", { name: "작업실 보기", exact: true }).getByRole("tab");
  await expect(tabs).toHaveText(STUDIO_PANELS.map(([, name]) => name));
  await expectOnly(page, "DRAFT");
  // Content of the other panels is not visible on entry.
  for (const hidden of [roster(page), page.locator(".draft-champion-info"), page.locator(".draft-agent-panel"),
    page.locator("section.draft-comparison"), readiness(page)]) await expect(hidden).toBeHidden();
  await expect(comparison(page)).toHaveCount(0);
  // The draft panel offers only a small entry to the champion info.
  await expect(page.getByRole("button", { name: "챔피언 정보 보기", exact: true })).toBeVisible();
  // Team selection is shared above all panels and rendered once.
  await expect(page.locator(".draft-match-setup")).toHaveCount(1);
  await expect(page.locator(".studio-shell .draft-match-setup")).toHaveCount(0);

  // Each panel, when shown, ends the content: only the shared page footer follows it, the document ends at that footer
  // (plus the space reserved under the fixed phone navigation), and the hidden panels take no space.
  const measure = () => page.evaluate(() => {
    const shown = document.querySelector('.studio-panels > [role="tabpanel"]:not([hidden])');
    const box = shown.getBoundingClientRect();
    const footer = document.querySelector("footer.studio-preview-footer").getBoundingClientRect();
    const reserved = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    return {
      id: shown.id, height: Math.round(box.height),
      below: Math.round(footer.top - box.bottom),
      afterFooter: Math.round(document.documentElement.scrollHeight - Math.max(footer.bottom + window.scrollY + reserved, window.innerHeight)),
      doc: document.documentElement.scrollHeight,
      hiddenHeights: [...document.querySelectorAll('.studio-panels > [role="tabpanel"][hidden]')].map((panel) => panel.getBoundingClientRect().height),
    };
  });
  const sizes = {};
  for (const id of IDS) {
    await showPanel(page, id);
    sizes[id] = await measure();
    expect(sizes[id].id).toBe(`studio-panel-${id.toLowerCase()}`);
    expect(sizes[id].hiddenHeights).toEqual([0, 0, 0, 0]);
    expect(sizes[id].below, `${id}: content below the shown panel`).toBeLessThan(200);
    expect(sizes[id].afterFooter, `${id}: content after the page footer`).toBeLessThanOrEqual(1);
  }
  // Stacking every panel (the previous single page) would add the other panels' heights to the draft page.
  const others = IDS.filter((id) => id !== "DRAFT").reduce((sum, id) => sum + sizes[id].height, 0);
  expect(others).toBeGreaterThan(300);
  testInfo.annotations.push({ type: "page-length", description: JSON.stringify({
    draftDoc: sizes.DRAFT.doc, stackedEstimate: sizes.DRAFT.doc + others,
    panels: Object.fromEntries(IDS.map((id) => [id, sizes[id].height])),
  }) });
  await showPanel(page, "DRAFT");
  expect(errors).toEqual([]);
});

test("draft, timer and roster edits survive a round trip through every panel", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  await picker(page).first().click();
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await picker(page).first().click();
  await expect(confirm(page)).toBeEnabled();
  const stagedName = await staged(page).textContent();
  await page.locator(".draft-clock button").click();
  await expect(page.locator(".draft-clock button")).toHaveText("일시정지");

  await showPanel(page, "ROSTER");
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  await rosterSlot(page, "blue", "TOP").selectOption("");
  const edited = await rosterValues(page);
  expect(edited["blue.TOP"]).toBe("");

  // The details panel sees the same staged champion; staging is never confirmed by switching.
  await showPanel(page, "DETAILS");
  await expect(page.locator(".studio-details-staged")).toContainText("올려놓음");
  await roundTrip(page, "DRAFT");

  await expectOnly(page, "DRAFT");
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(staged(page)).toHaveText(stagedName);
  await expect(confirm(page)).toBeEnabled();
  await expect(page.locator(".draft-clock button")).toHaveText("일시정지");
  await showPanel(page, "ROSTER");
  await expect(roster(page)).toHaveAttribute("open", "");
  expect(await rosterValues(page)).toEqual(edited);

  // Confirming after the round trip still works on the same staged champion.
  await showPanel(page, "DRAFT");
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "2");
  expect(errors).toEqual([]);
});

test("baseline A and explicit role assignments survive panel switches", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  await finishDraft(page);

  await showPanel(page, "COMPARISON");
  await comparison(page).getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true }).click();
  await expect(comparison(page)).toContainText("고정 당시 가상 로스터 포함");
  await roundTrip(page, "COMPARISON");
  await expect(comparison(page)).toContainText("고정 당시 가상 로스터 포함");
  await expect(comparison(page).getByRole("button", { name: "현재 B로 기준 A 교체", exact: true })).toBeEnabled();
  await expect(comparison(page).getByRole("button", { name: "기준 A 지우기", exact: true })).toBeEnabled();

  await showPanel(page, "SIMULATION");
  await openDetails(readiness(page));
  for (const [i, role] of ROLES.entries()) await roleSlot(page, "blue", role).selectOption({ index: i + 1 });
  const roles = await roleValues(page);
  expect(ROLES.every((role) => roles[`blue.${role}`])).toBe(true);
  await roundTrip(page, "SIMULATION");
  await expect(readiness(page)).toHaveAttribute("open", "");
  expect(await roleValues(page)).toEqual(roles);
  await expect(progress(page)).toHaveAttribute("value", "20");
  await showPanel(page, "COMPARISON");
  await expect(comparison(page)).toContainText("고정 당시 가상 로스터 포함");
  expect(errors).toEqual([]);
});

test("keyboard moves selection with roving focus and the matching panel follows", async ({ page }, testInfo) => {
  await openStudio(page);
  const rail = page.getByRole("tablist", { name: "작업실 보기", exact: true });
  await expect(rail).toHaveAttribute("aria-orientation", isDesktop(testInfo) ? "vertical" : "horizontal");
  await studioTab(page, "DRAFT").focus();
  const expectAt = async (id) => {
    await expect(studioTab(page, id)).toBeFocused();
    await expectOnly(page, id);
    const controls = await studioTab(page, id).getAttribute("aria-controls");
    await expect(page.locator(`[role="tabpanel"]:not([hidden])`)).toHaveAttribute("id", controls);
    await expect(page.locator(`#${controls}`)).toHaveAttribute("aria-labelledby", await studioTab(page, id).getAttribute("id"));
  };
  for (const [key, id] of [
    ["ArrowDown", "ROSTER"], ["ArrowRight", "DETAILS"], ["ArrowUp", "ROSTER"], ["ArrowLeft", "DRAFT"],
    ["ArrowLeft", "SIMULATION"], ["ArrowDown", "DRAFT"], ["End", "SIMULATION"], ["Home", "DRAFT"],
  ]) {
    await page.keyboard.press(key);
    await expectAt(id);
  }
  // Keyboard focus is visibly indicated on the active tab.
  await page.keyboard.press("End");
  await expectAt("SIMULATION");
  expect(await studioTab(page, "SIMULATION").evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  // Tab leaves the rail instead of walking through every tab (roving tabindex).
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).not.toBe("tab");
});

test("desktop rail sits on the left; mobile rail is a top strip with no page overflow", async ({ page }, testInfo) => {
  await openStudio(page);
  const rail = page.getByRole("tablist", { name: "작업실 보기", exact: true });
  const railBox = await rail.boundingBox();
  const panelBox = await studioPanel(page, "DRAFT").boundingBox();
  const tabBoxes = [];
  for (const id of IDS) tabBoxes.push(await studioTab(page, id).boundingBox());
  for (const box of tabBoxes) expect(box.height).toBeGreaterThanOrEqual(44);
  if (isDesktop(testInfo)) {
    expect(railBox.width).toBeGreaterThanOrEqual(132);
    expect(railBox.width).toBeLessThanOrEqual(152);
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(panelBox.x + 1);
    expect(Math.abs(railBox.y - panelBox.y)).toBeLessThan(2);
    for (let i = 1; i < tabBoxes.length; i += 1) expect(tabBoxes[i].y).toBeGreaterThan(tabBoxes[i - 1].y);
  } else {
    const viewport = page.viewportSize();
    expect(railBox.width).toBeLessThanOrEqual(viewport.width);
    // Starting on a phone scrolls to the board: the rail stays pinned at the top and does not cover the board.
    expect(Math.abs(railBox.y)).toBeLessThan(2);
    const board = await page.locator(".draft-control-room").boundingBox();
    expect(board.y).toBeGreaterThanOrEqual(railBox.y + railBox.height - 1);
    // In the page layout (scrolled to the top) the rail is a strip above the panel.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const topRail = await rail.boundingBox();
    const topPanel = await studioPanel(page, "DRAFT").boundingBox();
    expect(topRail.y + topRail.height).toBeLessThanOrEqual(topPanel.y + 1);
    for (let i = 1; i < tabBoxes.length; i += 1) expect(tabBoxes[i].x).toBeGreaterThan(tabBoxes[i - 1].x);
    // The fixed bottom navigation does not cover the rail.
    const bottomNav = await page.locator("nav.app-bottom-navigation").boundingBox();
    if (bottomNav) expect(railBox.y + railBox.height).toBeLessThanOrEqual(bottomNav.y);
    // Selecting the last tab scrolls the rail (not the page sideways) so it stays fully visible.
    await showPanel(page, "SIMULATION");
    const after = await rail.boundingBox();
    const last = await studioTab(page, "SIMULATION").boundingBox();
    expect(last.x).toBeGreaterThanOrEqual(after.x - 1);
    expect(last.x + last.width).toBeLessThanOrEqual(after.x + after.width + 1);
    await showPanel(page, "DRAFT");
  }
  for (const id of IDS) {
    await showPanel(page, id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} horizontal overflow`).toBeLessThanOrEqual(0);
  }
  await showPanel(page, "DRAFT");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath(`studio-sidetabs-${testInfo.project.name}.png`) });
  await showPanel(page, "ROSTER");
  await page.screenshot({ path: testInfo.outputPath(`studio-sidetabs-roster-${testInfo.project.name}.png`) });
});

test("confirmed slot and the champion info entry open details without changing the draft", async ({ page }) => {
  await openStudio(page);
  await picker(page).first().click();
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: "챔피언 정보 보기", exact: true }).click();
  await expectOnly(page, "DETAILS");
  await expect(page.locator("#studio-champion-info")).toBeFocused();
  await expect(page.locator(".draft-champion-info")).toBeVisible();
  await showPanel(page, "DRAFT");
  await page.locator('.draft-ban-row > div[role="button"]').first().click();
  await expectOnly(page, "DETAILS");
  await expect(page.locator("#studio-champion-info")).toBeFocused();
  await expect(page.locator(".draft-champion-info")).toBeVisible();
  // Agent options in details still stage (not confirm) and the details "back" control returns to the draft.
  const option = page.locator(".draft-agent-options > button").first();
  if (await option.count()) {
    await option.click();
    await expect(page.locator(".studio-details-staged")).toContainText("올려놓음");
    await page.getByRole("button", { name: "모의 밴픽으로 돌아가기", exact: true }).click();
    await expectOnly(page, "DRAFT");
    await expect(confirm(page)).toBeEnabled();
  }
  await expect(progress(page)).toHaveAttribute("value", "1");
});
