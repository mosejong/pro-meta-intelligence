import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { showPanel } from "./studio-panels.mjs";

test("restoring a preserved practice cancels an older manual catalog request", async ({ page }) => {
  const old = JSON.parse(await readFile(new URL("../../public/history/catalogs/b0f5e81bc19120632147dec7913ffd2c772aa17e63590e8b5570392a4e04c304.json", import.meta.url), "utf8"));
  await page.route("**/history/season-player-cards.json", route => route.fulfill({ json: old }), { times: 1 });
  await page.goto("/pro-meta-intelligence/");
  const ready = () => expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await ready();
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: "밴 확정", exact: true }).click();
  const season = page.locator("details.season-lineup");
  const openRoster = async () => {
    await showPanel(page, "ROSTER");
    if (await season.getAttribute("open") === null) await season.locator(":scope > summary").click();
  };
  await openRoster();
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  const nuguri = old.cards.find(c => c.player_name === "Nuguri" && c.season === 2022 && c.role === "TOP");
  await season.getByLabel("BLUE 탑 시즌 선수", { exact: true }).selectOption(nuguri.id);
  const library = page.locator("details.draft-practice-library");
  await showPanel(page, "DRAFT");
  await library.locator(":scope > summary").click();
  await library.getByLabel("연습 이름", { exact: true }).fill("과거 버전 복원 경합");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("시즌 선수 선택");
  await page.reload(); await ready();
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let manual, cancelled = false, count = 0;
  page.on("requestfailed", request => { if (request === manual) cancelled = true; });
  await page.route("**/history/season-player-cards.json", async route => {
    if (++count !== 1) { await route.continue(); return; }
    manual = route.request(); entered(); await barrier;
    await route.continue().catch(() => {});
  });
  try {
    await openRoster();
    await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
    await started;
    await showPanel(page, "DRAFT");
    await library.locator(":scope > summary").click();
    await library.getByRole("button", { name: "과거 버전 복원 경합 열기", exact: true }).click();
    await library.getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
    await expect(library.getByRole("status")).toContainText("시즌 선수 구성도 복원");
    await expect.poll(() => cancelled, { timeout: 8000 }).toBe(true);
    release();
    await openRoster();
    await expect(season.getByLabel("BLUE 탑 시즌 선수", { exact: true })).toHaveValue(nuguri.id);
    await expect(season).not.toContainText("저장된 시즌 선수를 확인하지 못했습니다");
  } finally { release(); }
});
