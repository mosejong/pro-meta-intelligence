import { test, expect } from "@playwright/test";
import { showPanel, enterDraftWorkspace } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
// Actual PICK turns, including the second ban phase; position order must never replace these.
const pickTurns = { blue: [7, 10, 11, 18, 19], red: [8, 9, 12, 17, 20] };
const board = (page, side) => page.locator(`.draft-position-board[aria-label="${side === "blue" ? "블루" : "레드"} 포지션 배정"]`);
const cards = (page, side) => board(page, side).locator("article[data-champion-id]");
const card = (page, side, id) => board(page, side).locator(`article[data-champion-id="${id}"]`);
const readinessRole = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
const progress = (page) => page.locator(".draft-turn-progress");
const available = (page) => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });

async function open(page) {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(page.locator(".draft-position-board")).toHaveCount(2);
}

async function choose(page) {
  const button = available(page).first();
  const src = await button.locator("img").getAttribute("src");
  const id = /\/([^/]+)\.png(?:\?.*)?$/.exec(src)?.[1];
  expect(id).toBeTruthy();
  await button.click();
  return id;
}

async function advance(page, target) {
  while (Number(await progress(page).getAttribute("value")) < target) {
    const before = Number(await progress(page).getAttribute("value"));
    await choose(page);
    await confirm(page).click();
    await expect(progress(page)).toHaveAttribute("value", String(before + 1));
  }
}

async function metadata(page, side) {
  return cards(page, side).evaluateAll((items) => items.map((item) => ({
    id: item.dataset.championId,
    turn: Number(item.dataset.turn),
    slot: Number(item.dataset.slot),
    label: item.querySelector("b").textContent,
  })).sort((a, b) => a.slot - b.slot));
}

async function noOverflow(page) {
  await expect.poll(() => page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - width;
  })).toBeLessThanOrEqual(1);
  // Check the board and its controls too: clipping at a page wrapper can hide local overflow.
  for (const side of ["blue", "red"]) {
    await board(page, side).scrollIntoViewIfNeeded();
    expect(await board(page, side).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [element, ...element.querySelectorAll("article, select, button")].every((child) => {
        const rect = child.getBoundingClientRect();
        return child.scrollWidth <= child.clientWidth + 1 && rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1 && rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
      });
    })).toBe(true);
  }
}

async function screenshots(page, testInfo, name) {
  await noOverflow(page);
  for (const side of ["blue", "red"]) {
    const path = testInfo.outputPath(`${name}-${side}.png`);
    await board(page, side).screenshot({ path });
    await testInfo.attach(`${name}-${side}`, { path, contentType: "image/png" });
  }
}

test("only confirmed PICKs enter position slots; staged picks and bans remain separate", async ({ page }, testInfo) => {
  await open(page);
  for (const side of ["blue", "red"]) {
    await expect(board(page, side).locator(".draft-position-empty")).toHaveCount(5);
    await expect(board(page, side).locator(".draft-position-confirm")).toBeDisabled();
  }
  await advance(page, 6);
  await expect(page.locator(".draft-position-board article[data-champion-id]")).toHaveCount(0);
  const id = await choose(page);
  await expect(board(page, "blue").locator(".staged")).toContainText("PICK 미확정");
  await expect(cards(page, "blue")).toHaveCount(0);
  await expect(progress(page)).toHaveAttribute("value", "6");
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "7");
  await expect(board(page, "blue").locator(".staged")).toHaveCount(0);
  await expect(cards(page, "blue")).toHaveCount(1);
  await expect(cards(page, "red")).toHaveCount(0);
  expect(await metadata(page, "blue")).toEqual([{ id, turn: 7, slot: 1, label: "B1" }]);
  await card(page, "blue", id).locator("select").selectOption("SUPPORT");
  await expect(card(page, "blue", id).locator(".draft-position-copy")).toContainText("서포터 · 배정");
  await expect(board(page, "blue").locator(":scope > article[data-champion-id]")).toHaveCount(1);
  await expect(board(page, "blue").locator(".draft-position-confirm")).toBeDisabled();
  await screenshots(page, testInfo, "confirmed-first-pick");
});

test("manual position changes and swaps preserve actual turns and share roles with readiness", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await advance(page, 20);
  const original = {};
  for (const side of ["blue", "red"]) {
    await expect(cards(page, side)).toHaveCount(5);
    original[side] = await metadata(page, side);
    expect(original[side].map(({ turn }) => turn)).toEqual(pickTurns[side]);
    expect(original[side].map(({ label }) => label)).toEqual(roles.map((_, i) => `${side === "blue" ? "B" : "R"}${i + 1}`));
  }
  // Observed suggestions are display-only until explicitly assigned or confirmed.
  await showPanel(page, "SIMULATION");
  for (const side of ["blue", "red"]) for (const role of roles) await expect(readinessRole(page, side, role)).toHaveValue("");
  await showPanel(page, "DRAFT");
  const assigned = {};
  for (const side of ["blue", "red"]) {
    assigned[side] = original[side].map(({ id }) => id).reverse();
    for (const [index, role] of roles.entries()) await card(page, side, assigned[side][index]).locator("select").selectOption(role);
    await expect(board(page, side).locator(".draft-position-unassigned")).toHaveCount(0);
    await expect(board(page, side).locator(".draft-position-confirm")).toBeEnabled();
    await board(page, side).locator(".draft-position-confirm").click();
  }
  // Move to an empty role, then move onto an occupied role to exercise the swap.
  const [top, jungle] = assigned.blue;
  await card(page, "blue", top).locator("select").selectOption("");
  await expect(card(page, "blue", top).locator("select")).toHaveValue("");
  await expect(board(page, "blue").locator(`.draft-position-unassigned article[data-champion-id="${top}"]`)).toBeVisible();
  await showPanel(page, "SIMULATION");
  await expect(readinessRole(page, "blue", "TOP")).toHaveValue("");
  await showPanel(page, "DRAFT");
  await expect(board(page, "blue").locator(".draft-position-confirm")).toBeDisabled();
  await card(page, "blue", top).locator("select").selectOption("TOP");
  await card(page, "blue", top).locator("select").selectOption("JUNGLE");
  await expect(card(page, "blue", jungle).locator("select")).toHaveValue("TOP");
  [assigned.blue[0], assigned.blue[1]] = [jungle, top];
  for (const side of ["blue", "red"]) expect(await metadata(page, side)).toEqual(original[side]);
  await expect(progress(page)).toHaveAttribute("value", "20");
  await screenshots(page, testInfo, "assigned-swapped-positions");

  await showPanel(page, "SIMULATION");
  for (const side of ["blue", "red"]) for (const [index, role] of roles.entries()) {
    await expect(readinessRole(page, side, role)).toHaveValue(assigned[side][index]);
  }
  // Edits in readiness flow back into the same position board, including swaps.
  await readinessRole(page, "red", "MID").selectOption(assigned.red[0]);
  await showPanel(page, "DRAFT");
  await expect(card(page, "red", assigned.red[0]).locator("select")).toHaveValue("MID");
  await expect(card(page, "red", assigned.red[2]).locator("select")).toHaveValue("TOP");
  for (const side of ["blue", "red"]) expect(await metadata(page, side)).toEqual(original[side]);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("undo and reset clear explicit assignments rather than retaining stale roles", async ({ page }) => {
  await open(page);
  await advance(page, 20);
  const ids = {};
  for (const side of ["blue", "red"]) {
    ids[side] = (await metadata(page, side)).map(({ id }) => id);
    await card(page, side, ids[side][0]).locator("select").selectOption("SUPPORT");
  }
  await page.getByRole("button", { name: "한 수 되돌리기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "19");
  await expect(card(page, "red", ids.red[4])).toHaveCount(0);
  await expect(page.locator(".draft-position-copy").filter({ hasText: / · 배정/ })).toHaveCount(0);
  await advance(page, 20);
  await showPanel(page, "SIMULATION");
  for (const side of ["blue", "red"]) for (const role of roles) await expect(readinessRole(page, side, role)).toHaveValue("");
  await showPanel(page, "DRAFT");
  await card(page, "blue", ids.blue[0]).locator("select").selectOption("MID");
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true })
    .getByRole("button", { name: "초기화", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(page.locator(".draft-position-board article[data-champion-id]")).toHaveCount(0);
  await expect(page.locator(".draft-position-empty")).toHaveCount(10);
  // Repick the same champion: it must not inherit the previous set's explicit MID role.
  await advance(page, 7);
  await expect(card(page, "blue", ids.blue[0])).toHaveCount(1);
  await expect(page.locator(".draft-position-copy").filter({ hasText: / · 배정/ })).toHaveCount(0);
  await noOverflow(page);
});
