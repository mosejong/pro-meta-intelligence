import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const catalogPath = /\/history\/season-player-cards\.json$/;
const storageKey = "pro-meta-guest-clubs-v1";
const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const panel = (page) => page.locator("details.season-lineup");
const club = (page) => page.locator(".guest-club");
const current = (page, side, role = "TOP") => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const seasonal = (page, side) => panel(page).getByLabel(`${side} 탑 시즌 선수`, { exact: true });
const loadButton = (page) => panel(page).getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true });
const progress = (page) => page.locator(".draft-turn-progress");

async function rosterValues(page) {
  return Promise.all(["blue", "red"].flatMap(side => roles.map(role => current(page, side, role).inputValue())));
}

async function openRoster(page) {
  await showPanel(page, "ROSTER");
  const workshop = page.locator("details.roster-workshop");
  if ((await workshop.getAttribute("open")) === null) await workshop.locator("> summary").click();
  await expect(club(page)).toBeVisible();
  await expect(current(page, "blue")).toBeEnabled();
  await expect(club(page).getByLabel("저장할 진영", { exact: true })).toBeEnabled();
  if ((await panel(page).getAttribute("open")) === null) await panel(page).locator("> summary").click();
  await expect(loadButton(page)).toBeEnabled();
}

async function openWithDraftTurn(page) {
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await openRoster(page);
}

async function loadPublishedNuguri(page) {
  const responsePromise = page.waitForResponse(response => catalogPath.test(new URL(response.url()).pathname));
  await loadButton(page).click();
  const response = await responsePromise;
  expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
  expect(response.status()).toBe(200);
  const catalog = await response.json();
  const matches = catalog.cards.filter(card => card.season === 2022 && card.player_name === "Nuguri" && card.role === "TOP" && card.game_count === 57);
  expect(matches).toHaveLength(1);
  const card = matches[0];
  await panel(page).getByLabel("선수 시즌", { exact: true }).selectOption("2022");
  await panel(page).getByLabel("시즌 선수 검색", { exact: true }).fill("Nuguri");
  await expect(seasonal(page, "BLUE").locator("option", { hasText: /^2022 Nuguri · .* · 57경기$/ })).toHaveAttribute("value", card.id);
  return { catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id };
}

test("실제 2022 Nuguri 시즌 선수를 구단에 저장하고 명시적으로 복원한 뒤 현재 선수로 전환한다", async ({ page }, testInfo) => {
  const requests = [];
  page.on("request", request => { if (catalogPath.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  await openWithDraftTurn(page);
  expect(requests).toHaveLength(0);
  const originalTop = await current(page, "blue").inputValue();
  expect(originalTop).not.toBe("");
  const ref = await loadPublishedNuguri(page);
  expect(requests).toHaveLength(1);
  await seasonal(page, "BLUE").selectOption(ref.card_id);
  await expect(current(page, "blue")).toHaveValue("");
  await expect(seasonal(page, "BLUE").locator("..").locator("..")).toContainText("57경기");
  await club(page).getByLabel("구단 이름", { exact: true }).fill("2022 너구리 구단");
  await club(page).getByLabel("저장할 진영", { exact: true }).selectOption("BLUE");
  await club(page).getByRole("button", { name: "새 구단으로 저장", exact: true }).click();
  const entry = page.locator(".guest-club-list article").filter({ hasText: "2022 너구리 구단" });
  await expect(entry).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.clubs).toHaveLength(1);
  expect(saved.clubs[0].seasonSlots.TOP).toEqual(ref);
  expect(saved.clubs[0].slots.TOP).toBeNull();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await page.locator("details.roster-workshop").screenshot({ path: testInfo.outputPath("season-lineup-saved.png") });

  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  expect(requests).toHaveLength(1);
  await expect(entry).toBeVisible();
  expect(await loadPublishedNuguri(page)).toEqual(ref);
  await expect(seasonal(page, "BLUE")).toHaveValue("");
  // Give the explicit club load an observable current roster change to restore.
  await current(page, "blue").selectOption(originalTop);
  await entry.getByRole("button", { name: "불러오기", exact: true }).click();
  const confirmation = page.getByRole("group", { name: "구단 불러오기 확인", exact: true });
  await expect(confirmation).toContainText("2022 Nuguri · 57경기");
  await expect(current(page, "blue")).toHaveValue(originalTop);
  await confirmation.getByRole("button", { name: "불러오기 확정", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(seasonal(page, "BLUE")).toHaveValue(ref.card_id);
  await expect(current(page, "blue")).toHaveValue("");
  await expect(progress(page)).toHaveAttribute("value", "1");
  await panel(page).screenshot({ path: testInfo.outputPath("season-lineup-restored.png") });

  await seasonal(page, "BLUE").selectOption("");
  await expect(current(page, "blue")).toHaveValue("");
  await current(page, "blue").selectOption(originalTop);
  await expect(current(page, "blue")).toHaveValue(originalTop);
  await expect(seasonal(page, "BLUE")).toHaveValue("");
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("시즌 자료 404는 기존 로스터를 유지하고 실제 자료 재시도를 허용한다", async ({ page }, testInfo) => {
  await page.route(catalogPath, route => route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" }));
  await openWithDraftTurn(page);
  const before = await rosterValues(page);
  const responsePromise = page.waitForResponse(response => catalogPath.test(new URL(response.url()).pathname));
  await loadButton(page).click();
  expect((await responsePromise).status()).toBe(404);
  await expect(panel(page).getByRole("alert")).toHaveText("시즌 선수 자료를 불러오지 못했습니다. 현재 구단과 선수 구성은 유지합니다.");
  await expect(loadButton(page)).toBeEnabled();
  expect(await rosterValues(page)).toEqual(before);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await panel(page).screenshot({ path: testInfo.outputPath("season-lineup-404-retry.png") });
  await page.unroute(catalogPath);
  await loadPublishedNuguri(page);
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  expect(await rosterValues(page)).toEqual(before);
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("같은 실제 시즌 선수는 블루와 레드에 동시에 배정할 수 없다", async ({ page }, testInfo) => {
  await openWithDraftTurn(page);
  const ref = await loadPublishedNuguri(page);
  await seasonal(page, "BLUE").selectOption(ref.card_id);
  const before = await rosterValues(page);
  await seasonal(page, "RED").selectOption(ref.card_id);
  await expect(seasonal(page, "BLUE")).toHaveValue(ref.card_id);
  await expect(seasonal(page, "RED")).toHaveValue("");
  await expect(page.locator(".roster-workshop-status").filter({ hasText: "이미 다른 자리에 있는 선수입니다." })).toBeVisible();
  expect(await rosterValues(page)).toEqual(before);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await panel(page).screenshot({ path: testInfo.outputPath("season-lineup-duplicate-blocked.png") });
});
