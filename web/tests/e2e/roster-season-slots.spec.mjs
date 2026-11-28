import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const ROSTER_KEY = "pro-meta-roster-scenario-v1";
const CLUB_KEY = "pro-meta-guest-clubs-v1";
const season = (page) => page.locator("details.season-lineup");
const club = (page) => page.locator(".guest-club");
const blueTopSlot = (page) => page.locator('.roster-team.blue li[data-role="TOP"]');
const progress = (page) => page.locator(".draft-turn-progress");

async function start(page) {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await openRoster(page);
}

async function openRoster(page) {
  await showPanel(page, "ROSTER");
  const workshop = page.locator("details.roster-workshop");
  if ((await workshop.getAttribute("open")) === null) await workshop.locator("> summary").click();
  await expect(blueTopSlot(page).locator("select")).toBeEnabled();
  if ((await season(page).getAttribute("open")) === null) await season(page).locator(":scope > summary").click();
}

async function loadCatalogAndMarin(page) {
  await season(page).getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  await season(page).getByLabel("선수 시즌", { exact: true }).selectOption("2015");
  const select = season(page).getByLabel("BLUE 탑 시즌 선수", { exact: true });
  const value = await select.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 MaRin"))?.value);
  expect(value).toBeTruthy();
  return { select, value };
}

/** Every place the blue TOP slot is described: summary, slot, snapshot evidence, annual record. */
async function slotViews(page) {
  const pool = page.locator("details.player-pool");
  if ((await pool.getAttribute("open")) === null) await pool.locator("> summary").click();
  const annual = page.locator("details.player-season");
  if ((await annual.getAttribute("open")) === null) await annual.locator("> summary").click();
  const annualTop = page.locator('.player-season-team.blue li[data-role="TOP"]');
  await expect(annualTop).toBeVisible();
  return {
    summary: await page.locator("details.roster-workshop > summary small").innerText(),
    option: await blueTopSlot(page).locator("select option:checked").innerText(),
    flags: await blueTopSlot(page).locator(".roster-slot-flags").innerText(),
    pool: await page.locator('.player-pool-team.blue li[data-role="TOP"]').innerText(),
    poolStatus: await page.locator('.player-pool-team.blue li[data-role="TOP"]').getAttribute("data-status"),
    annual: await annualTop.innerText(),
    annualStatus: await annualTop.getAttribute("data-status"),
  };
}

function expectSeasonViews(views, observedName) {
  expect(views.summary).toMatch(/빈칸 0 · 시즌 선수 1$/);
  expect(views.option).toBe("시즌 선수 배정 중 · 현재 선수 없음");
  expect(views.flags).toContain("2015 MaRin · 시즌 선수");
  expect(views.flags).toContain("현재 발행본 선수 근거 미지원");
  expect(views.poolStatus).toBe("SEASON");
  expect(views.pool).toContain("2015 MaRin · 시즌 선수");
  expect(views.pool).toContain("현재 발행본 선수 근거 미지원");
  expect(views.annualStatus).toBe("SEASON");
  expect(views.annual).toContain("2015 MaRin · 시즌 선수");
  expect(views.annual).toContain("2026 연간 기록은 현재 스냅샷 선수만 대상");
  // Never "빈칸", never the current roster player's evidence in the season slot.
  for (const text of [views.pool, views.annual]) { expect(text).not.toContain("빈칸"); expect(text).not.toContain(observedName); }
}

test("a season player's slot is named consistently in the summary, slot, evidence and annual record", async ({ page }, testInfo) => {
  await start(page);
  const observedTop = await blueTopSlot(page).locator("select option:checked").innerText();
  const observedName = observedTop.split(" · ")[0];
  const { select, value } = await loadCatalogAndMarin(page);
  await select.selectOption(value);
  await expect(blueTopSlot(page).locator("select")).toHaveValue("");
  const views = await slotViews(page);
  expectSeasonViews(views, observedName);
  // The existing boundaries stay: season choices are not in A/B, recommendation or simulation.
  await expect(season(page)).toContainText("아직 밴픽 추천·A/B의 선수 효과·시뮬레이션에는 연결하지 않습니다");
  await expect(page.locator(".roster-workshop-note")).toContainText("기존 추천 순위·예측/시뮬레이션에는 로스터 변경이 아직 반영되지 않습니다");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(".player-pool-team.blue").screenshot({ path: testInfo.outputPath("season-slot-evidence.png") });

  // Releasing the season player turns the slot back into a plain 빈칸 (no automatic current player).
  await select.selectOption("");
  await expect(page.locator("details.roster-workshop > summary small")).toHaveText(/빈칸 1$/);
  await expect(blueTopSlot(page).locator(".roster-slot-flags")).toContainText("빈칸 · 미확인");
  await expect(page.locator('.player-pool-team.blue li[data-role="TOP"]')).toHaveAttribute("data-status", "EMPTY");
  await expect(page.locator('.player-season-team.blue li[data-role="TOP"]')).toHaveAttribute("data-status", "EMPTY");
});

test("saving to a club and restoring after reload keeps the assignment, the display and the stored format", async ({ page }) => {
  await start(page);
  const observedName = (await blueTopSlot(page).locator("select option:checked").innerText()).split(" · ")[0];
  const { select, value } = await loadCatalogAndMarin(page);
  await select.selectOption(value);
  const before = await slotViews(page);
  expectSeasonViews(before, observedName);
  await club(page).getByLabel("구단 이름", { exact: true }).fill("시즌 슬롯 확인");
  await club(page).getByLabel("저장할 진영", { exact: true }).selectOption("BLUE");
  await club(page).getByRole("button", { name: "새 구단으로 저장", exact: true }).click();
  const entry = page.locator(".guest-club-list article").filter({ hasText: "시즌 슬롯 확인" });
  await expect(entry).toBeVisible();
  const stored = await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [ROSTER_KEY, CLUB_KEY]);
  const [rosterCopy, clubCopy] = stored.map(text => JSON.parse(text));
  // Stored formats as before: the device roster copy holds no season data; the club keeps the season ref.
  expect(JSON.stringify(rosterCopy)).not.toContain(value);
  expect(rosterCopy.rosters).toBeTruthy();
  expect(clubCopy.clubs[0].slots.TOP).toBeNull();
  expect(clubCopy.clubs[0].seasonSlots.TOP.card_id).toBe(value);
  expect(Object.keys(clubCopy.clubs[0].seasonSlots.TOP).sort()).toEqual(["card_id", "catalog_id", "player_id"]);

  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  // The device copy alone does not carry season players: that slot is honestly empty until the club is loaded.
  await expect(page.locator("details.roster-workshop > summary small")).toHaveText(/빈칸 1$/);
  await loadCatalogAndMarin(page);
  await entry.getByRole("button", { name: "불러오기", exact: true }).click();
  await page.getByRole("group", { name: "구단 불러오기 확인", exact: true }).getByRole("button", { name: "불러오기 확정", exact: true }).click();
  await expect(season(page).getByLabel("BLUE 탑 시즌 선수", { exact: true })).toHaveValue(value);
  expect(await slotViews(page)).toEqual(before);
  // Loading changed no stored format: the club entry is byte-identical.
  expect(await page.evaluate(key => localStorage.getItem(key), CLUB_KEY)).toBe(stored[1]);
  expect(JSON.stringify(JSON.parse(await page.evaluate(key => localStorage.getItem(key), ROSTER_KEY)))).not.toContain(value);
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("a practice-library save restores the season slot with the same display", async ({ page }) => {
  await start(page);
  const observedName = (await blueTopSlot(page).locator("select option:checked").innerText()).split(" · ")[0];
  const { select, value } = await loadCatalogAndMarin(page);
  await select.selectOption(value);
  const before = await slotViews(page);
  expectSeasonViews(before, observedName);
  const rosterBefore = await page.evaluate(key => localStorage.getItem(key), ROSTER_KEY);
  await showPanel(page, "DRAFT");
  const library = page.locator("details.draft-practice-library");
  await library.locator(":scope > summary").click();
  await library.getByLabel("연습 이름", { exact: true }).fill("시즌 슬롯 연습");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("시즌 선수 선택");

  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await showPanel(page, "DRAFT");
  if ((await library.getAttribute("open")) === null) await library.locator(":scope > summary").click();
  await library.getByRole("button", { name: "시즌 슬롯 연습 열기", exact: true }).click();
  const confirm = library.getByRole("alertdialog");
  if (await confirm.count()) await confirm.getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("시즌 선수 구성도 복원");
  await openRoster(page);
  await expect(season(page).getByLabel("BLUE 탑 시즌 선수", { exact: true })).toHaveValue(value);
  expect(await slotViews(page)).toEqual(before);
  expect(await page.evaluate(key => localStorage.getItem(key), ROSTER_KEY)).toBe(rosterBefore);
  await expect(progress(page)).toHaveAttribute("value", "1");
});
