import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const board = (page, side) => page.locator(`.draft-position-board[aria-label="${side === "blue" ? "블루" : "레드"} 포지션 배정"]`);
const card = (page, side, id) => board(page, side).locator(`article[data-champion-id="${id}"]`);
const progress = (page) => page.locator(".draft-turn-progress");
const available = (page) => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const explicit = (page) => page.locator(".draft-position-copy").filter({ hasText: / · 배정/ });

async function open(page) {
  await page.goto(root);
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await expect(page.locator(".draft-position-board")).toHaveCount(2);
}

async function advance(page, target) {
  while (Number(await progress(page).getAttribute("value")) < target) {
    const before = Number(await progress(page).getAttribute("value"));
    await available(page).first().click();
    await confirm(page).click();
    await expect(progress(page)).toHaveAttribute("value", String(before + 1));
  }
}

const ids = (page, side) => board(page, side).locator("article[data-champion-id]").evaluateAll((items) =>
  items.map((item) => ({ id: item.dataset.championId, slot: Number(item.dataset.slot) })).sort((a, b) => a.slot - b.slot).map(({ id }) => id));

/** Latest saved local draft (IndexedDB) parsed, or null. */
const stored = (page) => page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.open("pro-meta-draft", 1);
  request.onerror = () => resolve(null);
  request.onsuccess = () => {
    const get = request.result.transaction("sessions", "readonly").objectStore("sessions").get("current");
    get.onsuccess = () => { request.result.close(); resolve(typeof get.result === "string" ? JSON.parse(get.result) : null); };
    get.onerror = () => { request.result.close(); resolve(null); };
  };
}));

test("partial explicit roles and explicit unassigned survive a reload; suggestions stay suggestions", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await advance(page, 20);
  const blue = await ids(page, "blue");
  const red = await ids(page, "red");
  await card(page, "blue", blue[0]).locator("select").selectOption("SUPPORT");
  await card(page, "red", red[1]).locator("select").selectOption("TOP");
  // Explicitly clear a pick: it must not be re-suggested after reload either.
  await card(page, "blue", blue[2]).locator("select").selectOption("");
  await expect(board(page, "blue").locator(`.draft-position-unassigned article[data-champion-id="${blue[2]}"]`)).toBeVisible();
  await expect(explicit(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(page))?.schema_version).toBe("4");
  await expect.poll(async () => Object.values((await stored(page))?.current_game_positions ?? {}).flatMap(team => team.unassigned)).toContain(blue[2]);
  const saved = await stored(page);
  // Only the explicit work is stored: no suggested role appears as assigned.
  const savedRoles = Object.values(saved.current_game_positions).flatMap((team) => Object.values(team.roles).filter(Boolean));
  expect(savedRoles.sort()).toEqual([blue[0], red[1]].sort());

  await page.reload();
  await expect(progress(page)).toHaveAttribute("value", "20");
  await expect(card(page, "blue", blue[0]).locator("select")).toHaveValue("SUPPORT");
  await expect(card(page, "red", red[1]).locator("select")).toHaveValue("TOP");
  await expect(board(page, "blue").locator(`.draft-position-unassigned article[data-champion-id="${blue[2]}"]`)).toBeVisible();
  await expect(card(page, "blue", blue[2]).locator("select")).toHaveValue("");
  await expect(explicit(page)).toHaveCount(2);
  await showPanel(page, "SIMULATION");
  await expect(page.locator(`.simulation-readiness-team.blue li[data-role="SUPPORT"] select`)).toHaveValue(blue[0]);
  await expect(page.locator(`.simulation-readiness-team.red li[data-role="TOP"] select`)).toHaveValue(red[1]);
  await showPanel(page, "DRAFT");
  expect(errors).toEqual([]);
});

test("undo after reload still clears restored explicit roles and saves v3 again", async ({ page }) => {
  await open(page);
  await advance(page, 20);
  const blue = await ids(page, "blue");
  await card(page, "blue", blue[0]).locator("select").selectOption("MID");
  await expect.poll(async () => (await stored(page))?.schema_version).toBe("4");
  await page.reload();
  await expect(card(page, "blue", blue[0]).locator("select")).toHaveValue("MID");
  await page.getByRole("button", { name: "한 수 되돌리기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "19");
  await expect(explicit(page)).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.schema_version).toBe("3");
});

test("downloaded scenario file carries roles and re-imports them", async ({ page }, testInfo) => {
  await open(page);
  await advance(page, 20);
  const red = await ids(page, "red");
  await card(page, "red", red[0]).locator("select").selectOption("JUNGLE");
  const fileTools = page.locator(".draft-session-details");
  if ((await fileTools.getAttribute("open")) === null) await fileTools.locator("summary").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".draft-session-controls").getByRole("button", { name: "시리즈 JSON 저장", exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath("scenario.json");
  await download.saveAs(path);
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true }).getByRole("button", { name: "초기화", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await page.locator('.draft-session-controls input[type="file"]').setInputFiles(path);
  await expect(progress(page)).toHaveAttribute("value", "20");
  await expect(card(page, "red", red[0]).locator("select")).toHaveValue("JUNGLE");
  await expect(explicit(page)).toHaveCount(1);
});
