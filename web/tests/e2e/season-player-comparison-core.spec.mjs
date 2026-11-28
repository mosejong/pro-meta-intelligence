import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

test("2015 MaRin and 2022 Nuguri compare observations without changing the draft", async ({ page }, testInfo) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await page.locator("#draft-search").fill("Maokai");
  await /* by portrait id: the Korean display name needs Data Dragon locale data */ page.locator(".draft-picker-grid button").filter({ has: page.locator('img[src$="/Maokai.png"]') }).click();
  await page.locator(".draft-lock-in").getByRole("button", { name: "밴 확정", exact: true }).click();
  await showPanel(page, "ROSTER");
  const season = page.locator("details.season-lineup");
  await season.locator(":scope > summary").click();
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  const year = season.getByLabel("선수 시즌", { exact: true });
  await year.selectOption("2015");
  const blue = season.getByLabel("BLUE 탑 시즌 선수", { exact: true });
  const marin = await blue.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 MaRin"))?.value);
  expect(marin).toBeTruthy(); await blue.selectOption(marin);
  const comparison = season.locator("details.season-compare");
  await expect(comparison).not.toHaveAttribute("open", "");
  await comparison.locator(":scope > summary").click();
  await expect(comparison).toContainText("레드 탑에도 시즌 선수를 배정하면");
  await year.selectOption("2022");
  const red = season.getByLabel("RED 탑 시즌 선수", { exact: true });
  const nuguri = await red.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2022 Nuguri"))?.value);
  expect(nuguri).toBeTruthy(); await red.selectOption(nuguri);
  await expect(comparison).toContainText("2015 MaRin");
  await expect(comparison).toContainText("2022 Nuguri");
  await expect(comparison).toContainText("Oracle’s Elixir");
  await expect(comparison).not.toContainText("oracles-elixir-match-data");
  await expect(comparison.locator(".season-compare-side").first()).toContainText("마오카이 30회");
  await expect(comparison.locator(".season-compare-side").first()).toContainText("이번 판 밴");
  await expect(comparison).toContainText("리워크·시대 차이");
  await expect(comparison).toContainText("미관측이며 0회가 아닙니다");
  // Only read-only champion detail buttons; no inputs or links that could change the draft.
  await expect(comparison.locator("input, select, a")).toHaveCount(0);
  await expect(comparison.locator("button:not(.season-compare-champ)")).toHaveCount(0);
  await expect(comparison).not.toContainText("레드 0회");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await comparison.screenshot({ path: testInfo.outputPath("season-player-comparison.png") });
  await red.selectOption("");
  await expect(comparison).toContainText("레드 탑에도 시즌 선수를 배정하면");
  await expect(comparison).not.toContainText("2022 Nuguri");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
});

test("a compared champion opens a read-only season/current detail and returns focus without touching the draft", async ({ page }, testInfo) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await page.locator("#draft-search").fill("Maokai");
  await page.locator(".draft-picker-grid button").filter({ has: page.locator('img[src$="/Maokai.png"]') }).click();
  await page.locator(".draft-lock-in").getByRole("button", { name: "밴 확정", exact: true }).click();
  await page.locator("#draft-search").fill("");
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click(); // staged, not confirmed
  const staged = await page.locator(".draft-lock-in > div > span").textContent();
  await showPanel(page, "ROSTER");
  const season = page.locator("details.season-lineup");
  await season.locator(":scope > summary").click();
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  const year = season.getByLabel("선수 시즌", { exact: true });
  const assign = async (side, label) => {
    const select = season.getByLabel(`${side} 탑 시즌 선수`, { exact: true });
    const value = await select.locator("option").evaluateAll((options, text) => options.find(o => o.textContent.includes(text))?.value, label);
    expect(value).toBeTruthy(); await select.selectOption(value);
  };
  await year.selectOption("2015"); await assign("BLUE", "2015 MaRin");
  await year.selectOption("2022"); await assign("RED", "2022 Nuguri");
  const comparison = season.locator("details.season-compare");
  await comparison.locator(":scope > summary").click();
  await expect(comparison).toContainText("2022 Nuguri");

  const snapshot = async () => ({
    progress: await page.locator(".draft-turn-progress").getAttribute("value"),
    staged: await page.locator(".draft-lock-in > div > span").textContent(),
    roster: await page.locator(".roster-team select").evaluateAll(list => list.map(s => s.value)),
    seasons: await season.locator(".season-lineup-role select").evaluateAll(list => list.map(s => s.value)),
    storage: await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))),
  });
  const before = await snapshot();
  expect(before.staged).toBe(staged);

  const detail = comparison.locator(".season-champ-detail");
  const maokai = comparison.locator(".season-compare-side").first().getByRole("button", { name: /상세 보기 \(탑 시즌 관측\)/ }).first();
  await maokai.click();
  await expect(detail).toHaveCount(1);
  await expect(detail.locator("h5")).toBeFocused();
  await expect(maokai).toHaveAttribute("aria-expanded", "true");
  const seasonPart = detail.locator('[data-part="season"]');
  await expect(seasonPart.locator('[data-side="BLUE"]')).toContainText("2015 MaRin · 탑 · 표본");
  await expect(seasonPart.locator('[data-side="BLUE"]')).toContainText("30회 관측");
  await expect(seasonPart.locator('[data-side="RED"]')).toContainText("2022 Nuguri");
  await expect(detail).toContainText("이번 판 밴");
  const current = detail.locator('[data-part="current"]');
  if (await current.getAttribute("data-analysis") === "linked") await expect(current).toContainText("현재 발행본 분석 · 패치");
  else await expect(current).toContainText("연결되지 않아");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await comparison.screenshot({ path: testInfo.outputPath("season-champion-detail.png") });

  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(maokai).toBeFocused();

  // Keyboard: open with Enter on a champion only the red card observed, close with the close button.
  const redOnly = comparison.locator(".season-compare-side").nth(1).locator("ol").nth(1).locator("button").first();
  await redOnly.focus(); await page.keyboard.press("Enter");
  await expect(detail.locator("h5")).toBeFocused();
  await expect(detail.locator('[data-side="BLUE"]')).toHaveAttribute("data-observed", "false");
  await expect(detail.locator('[data-side="BLUE"]')).toContainText("미관측");
  await detail.getByRole("button", { name: "상세 닫기", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(detail).toHaveCount(0);
  await expect(redOnly).toBeFocused();
  expect(await snapshot()).toEqual(before);

  // Changing a compared season card withdraws the old detail instead of re-pointing it.
  await maokai.click();
  await expect(detail).toHaveCount(1);
  await season.getByLabel("RED 탑 시즌 선수", { exact: true }).selectOption("");
  await expect(detail).toHaveCount(0);
  await assign("RED", "2022 Nuguri");
  await expect(comparison).toContainText("2022 Nuguri");
  await expect(detail).toHaveCount(0);
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", before.progress);
  await expect(page.locator(".draft-lock-in > div > span")).toHaveText(staged);
});

test("swapping sides withdraws an open season champion detail instead of keeping the old BLUE/RED labels", async ({ page }) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page); // no turn taken: side swap is only offered while no work is in progress
  await showPanel(page, "ROSTER");
  const season = page.locator("details.season-lineup");
  await season.locator(":scope > summary").click();
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  const year = season.getByLabel("선수 시즌", { exact: true });
  const assign = async (side, label) => {
    const select = season.getByLabel(`${side} 탑 시즌 선수`, { exact: true });
    const value = await select.locator("option").evaluateAll((options, text) => options.find(o => o.textContent.includes(text))?.value, label);
    expect(value).toBeTruthy(); await select.selectOption(value);
  };
  await year.selectOption("2015"); await assign("BLUE", "2015 MaRin");
  await year.selectOption("2022"); await assign("RED", "2022 Nuguri");
  const comparison = season.locator("details.season-compare");
  await comparison.locator(":scope > summary").click();
  const sideNames = () => comparison.locator(".season-compare-side > strong").allInnerTexts();
  const [blueBefore, redBefore] = await sideNames();
  const detail = comparison.locator(".season-champ-detail");
  await comparison.locator(".season-compare-side").first().getByRole("button", { name: /상세 보기 \(탑 시즌 관측\)/ }).first().click();
  await expect(detail.locator('[data-side="BLUE"]')).toContainText("2015 MaRin");
  await expect(detail.locator('[data-side="RED"]')).toContainText("2022 Nuguri");

  await page.getByRole("button", { name: "팀 선택으로", exact: true }).click();
  const swap = page.locator(".draft-flow-setup .draft-match-setup > button");
  await expect(swap).toBeEnabled();
  await swap.click();
  await page.locator(".draft-flow-setup").getByRole("button", { name: /^밴픽 (시작|이어가기)$/ }).click();
  await showPanel(page, "ROSTER");
  // Both teams and their season lineups survive the swap, now on the other sides.
  const blueName = blueBefore.replace(/^블루 · /, ""), redName = redBefore.replace(/^레드 · /, "");
  expect(blueName).not.toBe(redName);
  await expect.poll(sideNames).toEqual([`블루 · ${redName}`, `레드 · ${blueName}`]);
  await expect(season.getByLabel("BLUE 탑 시즌 선수", { exact: true }).locator("option:checked")).toContainText("2022 Nuguri");
  await expect(detail).toHaveCount(0);

  // Reopened, the detail follows the current sides.
  await comparison.locator(".season-compare-side").first().getByRole("button", { name: /상세 보기 \(탑 시즌 관측\)/ }).first().click();
  await expect(detail.locator('[data-side="BLUE"]')).toContainText("2022 Nuguri");
  await expect(detail.locator('[data-side="RED"]')).toContainText("2015 MaRin");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "0");
});
