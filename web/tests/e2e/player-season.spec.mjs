import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

/**
 * Season history section in the real draft studio. Network responses for the season file are
 * served by route() from a synthetic fixture built from the published feed's roster basis, so
 * the UI flow is deterministic whether or not the derived file has been generated.
 */
const root = "/pro-meta-intelligence/";
const HISTORY = /\/history\/player-season-2026\.json$/;
const feed = JSON.parse(readFileSync(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
const basis = {
  patch_id: feed.patch_id, cutoff: feed.cutoff, fixture_only: feed.fixture_only,
  source_versions: (feed.evidence_index?.source_versions ?? []).map((s) => `${s.source_id}@${s.source_version}#${s.content_hash}`).sort(),
};
const EXTRA = ["Ahri", "Azir", "Orianna", "Sylas", "Taliyah", "Viktor"];

function fixture({ basisOverride } = {}) {
  const players = [];
  const seen = new Set();
  for (const team of feed.opponent_prep.teams) for (const profile of team.player_profiles ?? []) {
    const key = JSON.stringify([team.team_id, profile.player_id]);
    if (!profile.player_id || seen.has(key)) continue;
    seen.add(key);
    const names = [...new Set([...profile.champions.map((c) => c.champion_id), ...EXTRA])].slice(0, 8);
    const champions = names.map((champion_id, i) => ({ champion_id, games: i < 2 ? 10 : 1, example_event_ids: [`fixture:${i}`] }));
    const games = champions.reduce((sum, c) => sum + c.games, 0);
    const range = { first_observed_at: "2026-02-01T00:00:00+00:00", last_observed_at: "2026-10-01T00:00:00+00:00" };
    const stats = (list) => ({ games: list.reduce((s, c) => s + c.games, 0), ...range, champions: list });
    players.push({
      team_id: team.team_id, team_name: team.team_name, player_id: profile.player_id, player_name: profile.player_name,
      status: "FOUND", games,
      roles: { [profile.role]: {
        season: stats(champions), recent: stats(champions.slice(0, 2)), patch: { games: 0, first_observed_at: null, last_observed_at: null, champions: [] },
        by_patch: [{ id: "16.10", games, ...range }], by_league: [{ id: "TEST", games, ...range }],
      } },
    });
  }
  return JSON.stringify({
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: feed.cutoff, reference_patch: feed.patch_id,
    recent_game_limit: 20, roster_basis: basisOverride ?? basis,
    source: { source_id: "oracles-elixir-match-data", source_version: "sha256:fixture", content_hash: "sha256:fixture", retrieved_at: "2026-11-11T02:19:29.155420+00:00" },
    source_versions: ["oracles-elixir-match-data@sha256:fixture#sha256:fixture"], player_count: players.length,
    import_summary: { discovered_game_count: 1000, accepted_game_count: 900, rejected_game_count: 100, season_accepted_game_count: 900,
      season_first_observed_at: "2026-02-01T00:00:00+00:00", season_last_observed_at: "2026-10-01T00:00:00+00:00" },
    players,
  });
}

const roster = (page) => page.locator("details.roster-workshop");
const pool = (page) => page.locator("details.player-pool");
const season = (page) => page.locator("details.player-season");
const slot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const seasonRow = (page, side, role) => page.locator(`.player-season-team.${side} > ul > li[data-role="${role}"]`);
const poolRow = (page, side, role) => page.locator(`.player-pool-team.${side} > ul > li[data-role="${role}"]`);
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });

test("a stalled history request times out and retries without changing the draft or roster", async ({ page }) => {
  await page.clock.install();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route(HISTORY, async route => {
    requests += 1;
    if (requests === 1) { await held; await route.fulfill({ status: 200, contentType: "application/json", body: fixture() }).catch(() => {}); }
    else await route.fulfill({ status: 200, contentType: "application/json", body: fixture() });
  });
  try {
    await openPool(page);
    const before = await slot(page, "blue", "TOP").inputValue();
    await showPanel(page, "DRAFT");
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await confirm(page).click();
    await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
    await showPanel(page, "ROSTER");
    await season(page).locator("> summary").click();
    await expect(season(page).getByRole("status")).toContainText("불러오는 중");
    await page.clock.fastForward(15001);
    await expect(season(page).getByRole("alert")).toContainText("응답 시간");
    await season(page).getByRole("button", { name: "연간 자료 다시 불러오기" }).click();
    await expect(seasonRow(page, "blue", "TOP")).toHaveAttribute("data-status", "OBSERVED");
    await expect(slot(page, "blue", "TOP")).toHaveValue(before);
    await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
    expect(requests).toBe(2);
  } finally { release(); }
});

test("the actual derived file loads from the draft route and matches all displayed role counts", async ({ page }, testInfo) => {
  const real = JSON.parse(readFileSync(new URL("../../public/history/player-season-2026.json", import.meta.url), "utf8"));
  const state = watch(page);
  await page.goto(`${root}draft/`);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await showPanel(page, "ROSTER");
  if ((await roster(page).getAttribute("open")) === null) await roster(page).locator("> summary").click();
  await pool(page).locator("> summary").click();
  expect(state.requests).toBe(0);
  await season(page).locator("> summary").click();
  await expect(season(page).locator("[data-history-coverage-notice]")).toContainText("2014년 이후 자료를 순차 확보 중");
  await expect(season(page).locator("[data-history-coverage-notice]")).toContainText("2026년 자료만 표시");
  await expect(season(page).getByRole("note")).toContainText(`제외 ${real.import_summary.rejected_game_count}경기`);
  expect(state.requests).toBe(1);
  for (const side of ["blue", "red"]) for (const role of ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"]) {
    const chosen = await slot(page, side, role).inputValue();
    if (!chosen) continue;
    const [teamId, playerId] = JSON.parse(chosen);
    const player = real.players.find(p => p.team_id === teamId && p.player_id === playerId);
    const record = player?.roles[role];
    const row = seasonRow(page, side, role);
    await expect(row).toHaveAttribute("data-player-key", chosen);
    if (!record) { await expect(row).toHaveAttribute("data-status", "ZERO_IN_ROLE"); continue; }
    await expect(row.locator(".player-season-champs li")).toHaveCount(record.season.champions.length);
    for (const scope of ["recent", "patch"]) {
      await season(page).getByLabel(scope === "recent" ? /최근 최대 20경기/ : /현재 패치/).check();
      await expect(row).toContainText(`${record[scope].games}경기`);
    }
    await season(page).getByLabel(/연간 전체/).check();
  }
  const refs = seasonRow(page, "blue", "TOP").locator("details");
  await refs.locator("summary").click();
  await expect(refs).toContainText("연간 선택 근거 예시");
  await expectNoOverflow(page);
  await season(page).screenshot({ path: testInfo.outputPath("actual-player-season.png") });
  expect(state.errors).toEqual([]);
});

async function openPool(page) {
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await showPanel(page, "ROSTER");
  if ((await roster(page).getAttribute("open")) === null) await roster(page).locator("> summary").click();
  await expect(slot(page, "blue", "TOP")).toBeEnabled();
  await pool(page).locator("> summary").click();
}

function watch(page) {
  const state = { requests: 0, errors: [] };
  page.on("request", (request) => { if (HISTORY.test(new URL(request.url()).pathname)) state.requests += 1; });
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) state.errors.push(message.text()); });
  return state;
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector("details.player-pool");
    return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel.scrollWidth - panel.clientWidth };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.panel).toBeLessThanOrEqual(0);
}

test("season records load only on open, follow scope, roster edits and bans/undo", async ({ page }, testInfo) => {
  const state = watch(page);
  await page.route(HISTORY, (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture() }));
  await openPool(page);
  await expect(season(page)).toBeVisible();
  expect(state.requests).toBe(0);

  await season(page).locator("> summary").click();
  await expect(season(page).getByRole("note")).toContainText("오래된 원본");
  await expect(season(page).getByRole("note")).toContainText("선수별 누락률이 아님");
  expect(state.requests).toBe(1);

  // Every filled slot shows the assigned player's own record; > 4 champions are listed.
  const top = seasonRow(page, "blue", "TOP");
  const topKey = await slot(page, "blue", "TOP").inputValue();
  expect(topKey).not.toBe("");
  await expect(top).toHaveAttribute("data-player-key", topKey);
  await expect(top).toHaveAttribute("data-status", "OBSERVED");
  expect(await top.locator(".player-season-champs li").count()).toBeGreaterThan(4);
  // The snapshot pool above is unchanged and separate.
  await expect(poolRow(page, "blue", "TOP")).toHaveAttribute("data-player-key", topKey);

  // Scope: recent keeps two champions; the current patch has no games in this fixture (0, not unknown).
  await season(page).getByLabel(/최근 최대 20경기/).check();
  await expect(top.locator(".player-season-champs li")).toHaveCount(2);
  await season(page).getByLabel(/현재 패치/).check();
  await expect(top).toHaveAttribute("data-status", "ZERO_IN_ROLE");
  await season(page).getByLabel(/연간 전체/).check();
  await expect(top).toHaveAttribute("data-status", "OBSERVED");

  // Role move: the blue TOP player placed at SUPPORT shows 0 games in the assigned role.
  await slot(page, "blue", "SUPPORT").selectOption(topKey);
  await expect(seasonRow(page, "blue", "SUPPORT")).toHaveAttribute("data-player-key", topKey);
  await expect(seasonRow(page, "blue", "SUPPORT")).toHaveAttribute("data-status", "ZERO_IN_ROLE");
  await expect(seasonRow(page, "blue", "SUPPORT")).toContainText("이 역할에 합치지 않음");
  await expect(seasonRow(page, "blue", "TOP")).toHaveAttribute("data-status", "EMPTY");

  // Move the player back: SUPPORT becomes empty (no player), TOP shows the record again.
  await slot(page, "blue", "TOP").selectOption(topKey);
  await expect(top).toHaveAttribute("data-status", "OBSERVED");
  await expect(seasonRow(page, "blue", "SUPPORT")).toHaveAttribute("data-status", "EMPTY");

  // Ban a season champion of blue TOP, then undo.
  const listed = await top.locator('.player-season-champs li[data-state="AVAILABLE"]').evaluateAll((items) =>
    items.map((item) => ({ championId: item.dataset.champion, name: item.textContent.replace(/ \d+경기.*$/, "") })));
  let banned = null;
  await showPanel(page, "DRAFT");
  for (const candidate of listed) {
    await page.locator("#draft-search").fill(candidate.name);
    const button = page.locator(".draft-picker-grid button:not(:disabled)").filter({ has: page.getByText(candidate.name, { exact: true }) });
    if (await button.count()) { await button.first().click(); banned = candidate; break; }
  }
  expect(banned).not.toBeNull();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  const bannedChip = top.locator(`.player-season-champs li[data-champion="${banned.championId}"]`);
  await expect(bannedChip).toHaveAttribute("data-state", "BANNED_NOW");
  await page.getByRole("button", { name: "한 수 되돌리기", exact: true }).click();
  await expect(bannedChip).toHaveAttribute("data-state", "AVAILABLE");
  await page.locator("#draft-search").fill("");

  // Restore the observed roster: rows follow the slots without another request.
  await showPanel(page, "ROSTER");
  await roster(page).getByRole("button", { name: "원관측으로 되돌리기" }).click();
  for (const side of ["blue", "red"]) for (const role of ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"]) {
    const value = await slot(page, side, role).inputValue();
    if (value) await expect(seasonRow(page, side, role)).toHaveAttribute("data-player-key", value);
    else await expect(seasonRow(page, side, role)).toHaveAttribute("data-status", "EMPTY");
  }
  expect(state.requests).toBe(1);

  await expectNoOverflow(page);
  await season(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("player-season.png"), fullPage: true });
  expect(state.errors).toEqual([]);
});

test("missing or mismatched files keep the draft, roster and snapshot evidence", async ({ page }) => {
  const state = watch(page);
  let mode = "missing";
  await page.route(HISTORY, (route) => mode === "missing"
    ? route.fulfill({ status: 404, body: "not found" })
    : route.fulfill({ status: 200, contentType: "application/json", body: fixture({ basisOverride: { ...basis, patch_id: "0.0" } }) }));
  await openPool(page);
  const before = await slot(page, "blue", "MID").inputValue();
  const poolBefore = await poolRow(page, "blue", "MID").getAttribute("data-player-key");

  await season(page).locator("> summary").click();
  await expect(season(page).getByRole("alert")).toContainText("연간 자료 미연결");
  await expect(season(page).getByRole("alert")).toContainText("HTTP 404");
  await expect(slot(page, "blue", "MID")).toHaveValue(before);
  await expect(poolRow(page, "blue", "MID")).toHaveAttribute("data-player-key", poolBefore);

  mode = "mismatch";
  await season(page).locator("> summary").click(); // close
  await season(page).locator("> summary").click(); // reopen → retry
  await expect(season(page).getByRole("alert")).toContainText("참조 로스터");
  await expect(slot(page, "blue", "MID")).toHaveValue(before);
  await expect(page.locator(".player-season-team")).toHaveCount(0);
  await expectNoOverflow(page);
  expect(state.errors).toEqual([]);
});

test("a late response after closing or changing teams never reaches the new view", async ({ page }) => {
  const state = watch(page);
  const gates = [];
  await page.route(HISTORY, async (route) => {
    // Held responses are stale by construction (wrong basis); if one leaked, an alert would show.
    if (gates.length < 2) {
      await new Promise((resolve) => gates.push(resolve));
      return route.fulfill({ status: 200, contentType: "application/json", body: fixture({ basisOverride: { ...basis, patch_id: "stale" } }) }).catch(() => {});
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: fixture() });
  });
  await openPool(page);

  // 1) Close while loading.
  await season(page).locator("> summary").click();
  await expect(season(page).getByRole("status")).toContainText("불러오는 중");
  await season(page).locator("> summary").click();
  await expect.poll(() => gates.length).toBe(1);
  gates[0]();

  // 2) Change the red team while loading: the editor remounts for the new pair.
  await season(page).locator("> summary").click();
  await expect(season(page).getByRole("status")).toContainText("불러오는 중");
  await expect.poll(() => gates.length).toBe(2);
  const blueName = (await page.locator(".draft-match-setup .team-chooser-trigger strong").first().textContent()).trim();
  const redBefore = (await page.locator(".draft-match-setup .team-chooser-trigger strong").nth(1).textContent()).trim();
  await page.locator(".draft-match-setup .team-chooser-trigger").nth(1).click();
  const sheet = page.locator("dialog.team-chooser-sheet[open]");
  await sheet.locator(".team-chooser-search input").fill("");
  const choice = sheet.locator('.team-choice-grid button[aria-pressed="false"]').filter({ hasNotText: blueName }).first();
  const redAfter = (await choice.locator("strong").textContent()).trim();
  await choice.click();
  await expect(page.locator(".draft-match-setup .team-chooser-trigger strong").nth(1)).toHaveText(redAfter);
  expect(redAfter).not.toBe(redBefore);
  gates[1]();

  if ((await roster(page).getAttribute("open")) === null) await roster(page).locator("> summary").click();
  if ((await pool(page).getAttribute("open")) === null) await pool(page).locator("> summary").click();
  await expect(season(page)).not.toHaveAttribute("open", "");
  await season(page).locator("> summary").click();
  await expect(page.locator(".player-season-team.red h4")).toContainText(redAfter);
  const redTop = await slot(page, "red", "TOP").inputValue();
  if (redTop) await expect(seasonRow(page, "red", "TOP")).toHaveAttribute("data-player-key", redTop);
  else await expect(seasonRow(page, "red", "TOP")).toHaveAttribute("data-status", "EMPTY");
  await expect(season(page).getByRole("alert")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
