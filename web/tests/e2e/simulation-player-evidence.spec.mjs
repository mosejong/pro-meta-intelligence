import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { enterDraftWorkspace, showPanel } from "./studio-panels.mjs";

/**
 * Season evidence of the assigned champions inside the simulation-readiness panel. The season file
 * is served by route() from a synthetic fixture built from the current roster and role choices, so
 * every displayed count is known in advance.
 */
const root = "/pro-meta-intelligence/";
const HISTORY = /\/history\/player-season-2026\.json$/;
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const ROSTER_KEY = "pro-meta-roster-scenario-v1";
const feed = JSON.parse(readFileSync(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
const basis = {
  patch_id: feed.patch_id, cutoff: feed.cutoff, fixture_only: feed.fixture_only,
  source_versions: (feed.evidence_index?.source_versions ?? []).map((s) => `${s.source_id}@${s.source_version}#${s.content_hash}`).sort(),
};

const progress = (page) => page.locator(".draft-turn-progress");
const panel = (page) => page.locator("details.simulation-readiness");
const evidence = (page) => page.locator("details.simulation-evidence");
const roster = (page) => page.locator("details.roster-workshop");
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const roleSlot = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
const row = (page, side, role) => page.locator(`.simulation-evidence-team.${side} li[data-role="${role}"]`);
const abButton = (page) => page.getByRole("region", { name: "드래프트 A/B 비교", exact: true })
  .getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true });

const range = { first_observed_at: "2026-02-01T00:00:00+00:00", last_observed_at: "2026-10-01T00:00:00+00:00" };
const stats = (list) => {
  const games = list.reduce((s, c) => s + c.games, 0);
  return games ? { games, ...range, champions: list } : { games: 0, first_observed_at: null, last_observed_at: null, champions: [] };
};
const roleRecord = (list) => {
  const games = list.reduce((s, c) => s + c.games, 0);
  return { season: stats(list), recent: stats(list), patch: stats([]), by_patch: [{ id: "fixture-older-patch", games, ...range }], by_league: [{ id: "TEST", games, ...range }] };
};

/** entries: [{ key: '["team","player"]', role, champions: [[id, games]] }] */
function fixture(entries, basisOverride) {
  const players = entries.map(({ key, role, champions }) => {
    const [team_id, player_id] = JSON.parse(key);
    const list = champions.map(([champion_id, games]) => ({ champion_id, games }));
    return { team_id, team_name: `T-${team_id}`, player_id, player_name: `P-${player_id}`, status: "FOUND",
      games: list.reduce((s, c) => s + c.games, 0), roles: { [role]: roleRecord(list) } };
  });
  return JSON.stringify({
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: feed.cutoff, reference_patch: feed.patch_id,
    recent_game_limit: 20, roster_basis: basisOverride ?? basis,
    source: { source_id: "oracles-elixir-match-data", source_version: "sha256:fixture", content_hash: "sha256:fixture", retrieved_at: "2026-11-11T02:19:29.155420+00:00" },
    source_versions: ["oracles-elixir-match-data@sha256:fixture#sha256:fixture"], player_count: players.length,
    import_summary: { discovered_game_count: 9642, accepted_game_count: 9000, rejected_game_count: 642, season_accepted_game_count: 900,
      season_first_observed_at: range.first_observed_at, season_last_observed_at: range.last_observed_at },
    players,
  });
}

function watch(page) {
  const state = { requests: 0, errors: [] };
  page.on("request", (request) => { if (HISTORY.test(new URL(request.url()).pathname)) state.requests += 1; });
  page.on("pageerror", (error) => state.errors.push(error.message));
  return state;
}

async function openDetails(locator) {
  if ((await locator.getAttribute("open")) === null) await locator.locator("> summary").click();
}

async function rosterValues(page) {
  const result = {};
  for (const side of ["blue", "red"]) for (const role of ROLES) result[`${side}.${role}`] = await rosterSlot(page, side, role).inputValue();
  return result;
}

async function unusedPlayer(page, side, role) {
  const used = Object.values(await rosterValues(page)).filter(Boolean);
  return rosterSlot(page, side, role).evaluate((select, taken) =>
    [...select.querySelectorAll("option")].map((option) => option.value).find((value) => value && !taken.includes(value)) ?? null, used);
}

/** Completed draft, ten players, explicit roles: a ready input. */
async function readyInput(page, url = root) {
  await page.goto(url);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  for (let i = 0; i < 20; i += 1) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(progress(page)).toHaveAttribute("value", String(i + 1));
  }
  await showPanel(page, "ROSTER");
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    if (await rosterSlot(page, side, role).inputValue()) continue;
    const value = await unusedPlayer(page, side, role);
    expect(value).not.toBeNull();
    await rosterSlot(page, side, role).selectOption(value);
  }
  await showPanel(page, "SIMULATION");
  await openDetails(panel(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await expect(panel(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
  const champions = {};
  for (const side of ["blue", "red"]) for (const role of ROLES) champions[`${side}.${role}`] = await roleSlot(page, side, role).inputValue();
  return { players: await rosterValues(page), champions };
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("details.simulation-evidence");
    return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: el ? el.scrollWidth - el.clientWidth : 0 };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.panel).toBeLessThanOrEqual(0);
}

test("the actual season artifact matches assigned-player counts on the nested draft route", async ({ page }, testInfo) => {
  const state = watch(page);
  const real = JSON.parse(readFileSync(new URL("../../public/history/player-season-2026.json", import.meta.url), "utf8"));
  const input = await readyInput(page, `${root}draft/`);
  expect(state.requests).toBe(0);
  await evidence(page).locator("> summary").click();
  await expect(evidence(page).locator(".simulation-evidence-source")).toContainText(`원본 제외 ${real.import_summary.rejected_game_count}경기`);
  await expect(evidence(page).locator(".simulation-evidence-source")).toContainText("원본이 분석 기준 시각보다 오래되어");
  const key = id => {
    const normalized = id.toLowerCase().replace(/[^a-z0-9]/g, "");
    return ({ wukong: "monkeyking", renataglasc: "renata" })[normalized] ?? normalized;
  };
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    const [teamId, playerId] = JSON.parse(input.players[`${side}.${role}`]);
    const player = real.players.find(p => p.team_id === teamId && p.player_id === playerId);
    const view = row(page, side, role);
    if (!player || player.status !== "FOUND") {
      await expect(view).toHaveAttribute("data-status", "UNCONFIRMED");
      await expect(view.locator("[data-scope]")).toHaveCount(0);
      continue;
    }
    const record = player.roles[role];
    if (!record || record.season.games === 0) {
      await expect(view).toHaveAttribute("data-status", "ZERO_IN_ROLE");
      continue;
    }
    await expect(view).toHaveAttribute("data-status", "OBSERVED");
    for (const scope of ["season", "recent", "patch"]) {
      const stats = record[scope];
      const picks = stats.champions.find(c => key(c.champion_id) === key(input.champions[`${side}.${role}`]))?.games ?? 0;
      await expect(view.locator(`[data-scope="${scope}"]`)).toHaveAttribute("data-games", String(stats.games));
      await expect(view.locator(`[data-scope="${scope}"]`)).toHaveAttribute("data-picks", String(picks));
    }
  }
  expect(state.requests).toBe(1);
  await expect(progress(page)).toHaveAttribute("value", "20");
  await expectNoOverflow(page);
  await evidence(page).screenshot({ path: testInfo.outputPath("real-assigned-evidence.png") });
  expect(state.errors).toEqual([]);
});

test("opens lazily, counts the assigned champion per role and follows player and readiness changes", async ({ page }, testInfo) => {
  const state = watch(page);
  let body = "";
  await page.route(HISTORY, (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  const input = await readyInput(page);

  // Fix the input first: opening the evidence must not change it.
  await panel(page).getByRole("button", { name: "준비된 입력 고정", exact: true }).click();
  const fixedRegion = panel(page).getByRole("region", { name: "고정한 시뮬레이션 입력" });
  await expect(fixedRegion).toContainText("현재 입력과 같음");
  const replacement = await unusedPlayer(page, "blue", "MID");
  expect(replacement).not.toBeNull();
  const entries = [];
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    const key = input.players[`${side}.${role}`];
    if (side === "red" && role === "BOTTOM") continue; // absent from the file → unknown, not 0
    if (side === "blue" && role === "SUPPORT") { entries.push({ key, role: "TOP", champions: [["FixtureTop", 6]] }); continue; } // found, other role only
    entries.push({ key, role, champions: [[input.champions[`${side}.${role}`], 7], ["FixtureOther", 13]] });
  }
  entries.push({ key: replacement, role: "MID", champions: [["FixtureMid", 5]] }); // assigned champion not in the list → 0/5
  body = fixture(entries);

  const storedBefore = await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);
  await expect(evidence(page)).toBeVisible();
  await expect(evidence(page)).not.toHaveAttribute("open", "");
  expect(state.requests).toBe(0);
  await evidence(page).locator("> summary").click();
  await expect(evidence(page)).toContainText("manager-scenario");
  await expect(evidence(page).locator(".simulation-evidence-source")).toContainText("원본 제외 642경기");
  await expect(evidence(page).locator(".simulation-evidence-source")).toContainText("올해 모든 실제 경기는 아닙니다");
  expect(state.requests).toBe(1);

  const blueMid = row(page, "blue", "MID");
  await expect(blueMid).toHaveAttribute("data-player-key", input.players["blue.MID"]);
  await expect(blueMid).toHaveAttribute("data-status", "OBSERVED");
  await expect(blueMid.locator('[data-scope="season"]')).toHaveAttribute("data-picks", "7");
  await expect(blueMid.locator('[data-scope="season"]')).toHaveAttribute("data-games", "20");
  await expect(blueMid.locator('[data-scope="patch"]')).toContainText("0경기");
  await expect(row(page, "blue", "SUPPORT")).toHaveAttribute("data-status", "ZERO_IN_ROLE");
  await expect(row(page, "blue", "SUPPORT")).toContainText("합치지 않음");
  await expect(row(page, "red", "BOTTOM")).toHaveAttribute("data-status", "UNCONFIRMED");
  await expect(row(page, "red", "BOTTOM")).toContainText("자료 없음/확인 불가");
  await expect(row(page, "red", "BOTTOM").locator("[data-picks]")).toHaveCount(0);

  // Draft, roster storage, fixed input and A/B are untouched by loading the evidence.
  await expect(progress(page)).toHaveAttribute("value", "20");
  expect(await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY)).toBe(storedBefore);
  await expect(fixedRegion).toContainText("현재 입력과 같음");
  await showPanel(page, "COMPARISON");
  await expect(abButton(page)).toBeEnabled();
  await showPanel(page, "SIMULATION");
  await expectNoOverflow(page);
  await evidence(page).screenshot({ path: testInfo.outputPath("simulation-evidence.png") });

  // Replace the blue MID player: the row switches to the new player without another request.
  await showPanel(page, "ROSTER");
  await rosterSlot(page, "blue", "MID").selectOption(replacement);
  await showPanel(page, "SIMULATION");
  await expect(blueMid).toHaveAttribute("data-player-key", replacement);
  await expect(blueMid.locator('[data-scope="season"]')).toHaveAttribute("data-picks", "0");
  await expect(blueMid.locator('[data-scope="season"]')).toHaveAttribute("data-games", "5");
  await expect(fixedRegion).toContainText("고정 뒤 현재 입력이 바뀌었습니다");
  expect(state.requests).toBe(1);

  // Input no longer ready: no old rows are shown as current evidence; ready again → rows return (cached).
  const blueTop = await roleSlot(page, "blue", "TOP").inputValue();
  await roleSlot(page, "blue", "TOP").selectOption("");
  await expect(evidence(page).locator('[data-evidence-state="not-ready"]')).toBeVisible();
  await expect(page.locator(".simulation-evidence-team")).toHaveCount(0);
  await roleSlot(page, "blue", "TOP").selectOption(blueTop);
  await expect(row(page, "blue", "TOP")).toHaveAttribute("data-player-key", input.players["blue.TOP"]);
  expect(state.requests).toBe(1);
  expect(state.errors).toEqual([]);
});

test("404, other basis, timeout, retry and a late response after closing keep all work", async ({ page }) => {
  await page.clock.install();
  const state = watch(page);
  let mode = "missing";
  let body = "";
  const gates = [];
  await page.route(HISTORY, async (route) => {
    if (mode === "missing") return route.fulfill({ status: 404, body: "not found" });
    if (mode === "basis") return route.fulfill({ status: 200, contentType: "application/json", body: fixture([], { ...basis, patch_id: "0.0" }) });
    if (mode === "hold") {
      // Held responses are stale by construction; if one leaked, an alert would show.
      await new Promise((resolve) => gates.push(resolve));
      return route.fulfill({ status: 200, contentType: "application/json", body: fixture([], { ...basis, patch_id: "stale" }) }).catch(() => {});
    }
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  try {
    const input = await readyInput(page);
    body = fixture([{ key: input.players["blue.MID"], role: "MID", champions: [[input.champions["blue.MID"], 3]] }]);
    const storedBefore = await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);
    const unchanged = async () => {
      await expect(progress(page)).toHaveAttribute("value", "20");
      expect(await rosterValues(page)).toEqual(input.players);
      expect(await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY)).toBe(storedBefore);
      await expect(panel(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
    };

    await evidence(page).locator("> summary").click();
    await expect(evidence(page).getByRole("alert")).toContainText("HTTP 404");
    await unchanged();

    mode = "basis";
    await evidence(page).getByRole("button", { name: "연간 자료 다시 불러오기" }).click();
    await expect(evidence(page).getByRole("alert")).toContainText("참조 로스터");
    await expect(page.locator(".simulation-evidence-team")).toHaveCount(0);

    mode = "hold";
    await evidence(page).getByRole("button", { name: "연간 자료 다시 불러오기" }).click();
    await expect(evidence(page).getByRole("status")).toContainText("불러오는 중");
    await page.clock.fastForward(15_001);
    await expect(evidence(page).getByRole("alert")).toContainText("응답 시간");
    await unchanged();

    // Close while loading, then release the stale response: it must not reach the reopened view.
    await evidence(page).getByRole("button", { name: "연간 자료 다시 불러오기" }).click();
    await expect(evidence(page).getByRole("status")).toContainText("불러오는 중");
    await evidence(page).locator("> summary").click();
    await expect.poll(() => gates.length).toBe(2);
    mode = "ok";
    gates.forEach((release) => release());
    await evidence(page).locator("> summary").click();
    await expect(row(page, "blue", "MID")).toHaveAttribute("data-status", "OBSERVED");
    await expect(row(page, "blue", "MID").locator('[data-scope="season"]')).toHaveAttribute("data-picks", "3");
    await expect(evidence(page).getByRole("alert")).toHaveCount(0);
    expect(state.requests).toBe(5);
    await unchanged();
    await expectNoOverflow(page);
    expect(state.errors).toEqual([]);
  } finally { gates.forEach((release) => release()); }
});
