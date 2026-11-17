import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { showPanel, studioTab } from "./studio-panels.mjs";

/**
 * A/B player · champion observation differences. Roles are assigned in the simulation-readiness tab,
 * frozen into A together with the roster, then B changes a player and swaps two roles. The annual
 * file is served by route() from a synthetic fixture so every count is known in advance; it is only
 * requested after the user opens the collapsed section, and it never enters the v3 comparison file.
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
const readiness = (page) => page.locator("details.simulation-readiness");
const roster = (page) => page.locator("details.roster-workshop");
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const roleSlot = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
const comparison = (page) => page.getByRole("region", { name: "드래프트 A/B 비교", exact: true });
const liveComparison = (page) => comparison(page).locator(":scope > .draft-comparison-body");
const evidence = (page) => comparison(page).locator("details.comparison-evidence");
const card = (page, role) => evidence(page).locator(`.comparison-evidence-card[data-role="${role}"]`);

const range = { first_observed_at: "2026-02-01T00:00:00+00:00", last_observed_at: "2026-10-01T00:00:00+00:00" };
const stats = (list) => {
  const games = list.reduce((s, c) => s + c.games, 0);
  return games ? { games, ...range, champions: list } : { games: 0, first_observed_at: null, last_observed_at: null, champions: [] };
};
const roleRecord = (list) => {
  const games = list.reduce((s, c) => s + c.games, 0);
  return { season: stats(list), recent: stats(list), patch: stats([]), by_patch: [{ id: "fixture-older-patch", games, ...range }], by_league: [{ id: "TEST", games, ...range }] };
};
function fixture(entries) {
  const players = entries.map(({ key, role, champions }) => {
    const [team_id, player_id] = JSON.parse(key);
    const list = champions.map(([champion_id, games]) => ({ champion_id, games }));
    return { team_id, team_name: `T-${team_id}`, player_id, player_name: `P-${player_id}`, status: "FOUND",
      games: list.reduce((s, c) => s + c.games, 0), roles: { [role]: roleRecord(list) } };
  });
  return JSON.stringify({
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: feed.cutoff, reference_patch: feed.patch_id,
    recent_game_limit: 20, roster_basis: basis,
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
async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("details.comparison-evidence");
    return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: el ? el.scrollWidth - el.clientWidth : 0 };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.panel).toBeLessThanOrEqual(0);
}

test("roles → freeze A → change player and roles → annual evidence (error/close/retry) → v3 save/replay", async ({ page }, testInfo) => {
  const state = watch(page);
  let mode = "hold";
  let body = "";
  const gates = [];
  await page.route(HISTORY, async (route) => {
    if (mode === "hold") {
      await new Promise((resolve) => gates.push(resolve));
      return route.fulfill({ status: 200, contentType: "application/json", body: fixture([]) }).catch(() => {});
    }
    if (mode === "error") return route.fulfill({ status: 500, body: "error" });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  try {
    // Completed draft + ten players, no roles yet.
    await page.goto(root);
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

    // Freeze A without roles: structural comparison works; evidence asks for roles, no request.
    await showPanel(page, "COMPARISON");
    await comparison(page).getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true }).click();
    await expect(comparison(page).locator("[data-baseline-roles]")).toHaveAttribute("data-baseline-roles", "none");
    await expect(comparison(page).locator("[data-baseline-roles]")).toHaveText("역할 배정 기록 없음");
    await expect(liveComparison(page).locator('[data-role-diff="not-recorded"]')).toBeVisible();
    await expect(evidence(page)).not.toHaveAttribute("open", "");
    await evidence(page).locator("> summary").click();
    await expect(evidence(page).locator('[data-evidence-state="roles-missing"]')).toContainText("기준 A를 다시 고정");
    expect(state.requests).toBe(0);

    // The CTA really switches to the simulation tab's role assignment.
    await evidence(page).getByRole("button", { name: "시뮬레이션 준비 탭에서 역할 배정", exact: true }).click();
    await expect(studioTab(page, "SIMULATION")).toHaveAttribute("aria-selected", "true");
    await expect(roleSlot(page, "blue", "TOP")).toBeFocused();
    await openDetails(readiness(page));
    for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
    await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
    const playersA = await rosterValues(page);
    const champions = {};
    for (const side of ["blue", "red"]) for (const role of ROLES) champions[`${side}.${role}`] = await roleSlot(page, side, role).inputValue();

    // B now carries the ready roles; A does not until it is re-frozen.
    await showPanel(page, "COMPARISON");
    await expect(comparison(page).locator("[data-current-roles]")).toHaveAttribute("data-current-roles", "recorded");
    await expect(comparison(page).locator("[data-baseline-roles]")).toHaveAttribute("data-baseline-roles", "none");
    await comparison(page).getByRole("button", { name: "현재 B로 기준 A 교체", exact: true }).click();
    await expect(comparison(page).locator("[data-baseline-roles]")).toHaveAttribute("data-baseline-roles", "recorded");
    await expect(liveComparison(page).locator('[data-role-diff="same"]')).toBeVisible();

    // B: replace the blue MID player and swap blue TOP/JUNGLE champions.
    const replacement = await unusedPlayer(page, "blue", "MID");
    expect(replacement).not.toBeNull();
    body = fixture([
      { key: playersA["blue.MID"], role: "MID", champions: [[champions["blue.MID"], 7], ["FixtureOther", 13]] },
      { key: replacement, role: "MID", champions: [["FixtureMid", 5]] },
      { key: playersA["blue.TOP"], role: "TOP", champions: [[champions["blue.TOP"], 4], [champions["blue.JUNGLE"], 2]] },
    ]);
    await showPanel(page, "ROSTER");
    await rosterSlot(page, "blue", "MID").selectOption(replacement);
    await showPanel(page, "SIMULATION");
    await roleSlot(page, "blue", "TOP").selectOption(champions["blue.JUNGLE"]);
    await roleSlot(page, "blue", "JUNGLE").selectOption(champions["blue.TOP"]);
    await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
    await showPanel(page, "COMPARISON");
    await expect(liveComparison(page).locator('[data-role-diff="changed"]')).toContainText("변경된 역할 배정 2개");
    await expect(comparison(page).locator("[data-baseline-roles]")).toHaveAttribute("data-baseline-roles", "recorded");
    expect(state.requests).toBe(0);

    // Annual evidence: open (held) → close aborts → error → retry → rows.
    const storedBefore = await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);
    const unchanged = async () => {
      await expect(progress(page)).toHaveAttribute("value", "20");
      expect(await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY)).toBe(storedBefore);
      await expect(comparison(page).locator("[data-baseline-roles]")).toHaveAttribute("data-baseline-roles", "recorded");
      await expect(liveComparison(page).locator('[data-role-diff="changed"]')).toBeVisible();
    };
    // Still open from the roles-missing step: now eligible, it waits for an explicit request.
    await expect(evidence(page)).toHaveAttribute("open", "");
    expect(state.requests).toBe(0);
    await evidence(page).getByRole("button", { name: "연간 자료 불러오기", exact: true }).click();
    await expect(evidence(page).locator('[data-evidence-state="loading"]')).toBeVisible();
    await evidence(page).locator("> summary").click();
    await expect.poll(() => gates.length).toBe(1);
    mode = "error";
    await evidence(page).locator("> summary").click();
    await expect(evidence(page).locator('[data-evidence-state="error"]')).toBeVisible();
    await unchanged();
    mode = "ok";
    gates.forEach((release) => release());
    await evidence(page).getByRole("button", { name: "연간 자료 다시 불러오기", exact: true }).click();
    await expect(card(page, "MID").first()).toBeVisible();
    await expect(evidence(page).getByRole("alert")).toHaveCount(0);
    expect(state.requests).toBe(3);
    await expect(evidence(page).locator(".comparison-evidence-source")).toContainText("원본 제외 642경기");
    await expect(evidence(page).locator(".comparison-evidence-note").first()).toContainText("현재 추가 참고");

    const mid = evidence(page).locator('.comparison-evidence-card[data-role="MID"][data-changed="true"]');
    await expect(mid).toHaveCount(1);
    await expect(mid.locator('[data-side="A"]')).toHaveAttribute("data-player-key", playersA["blue.MID"]);
    await expect(mid.locator('[data-side="B"]')).toHaveAttribute("data-player-key", replacement);
    await expect(mid.locator('[data-side="A"] [data-scope="season"]')).toHaveAttribute("data-picks", "7");
    await expect(mid.locator('[data-side="A"] [data-scope="season"]')).toHaveAttribute("data-games", "20");
    await expect(mid.locator('[data-side="B"] [data-scope="season"]')).toHaveAttribute("data-picks", "0");
    await expect(mid.locator('[data-side="B"] [data-scope="season"]')).toHaveAttribute("data-games", "5");
    await expect(mid.locator('[data-side="A"] .comparison-evidence-pool')).toHaveAttribute("data-available", "1");
    await expect(mid.locator('[data-side="A"] .comparison-evidence-pool')).toHaveAttribute("data-observed", "2");
    await expect(mid.locator('[data-side="B"] .comparison-evidence-pool')).toHaveAttribute("data-observed", "1");
    await expect(mid).toContainText("실력 비교가 아닙니다");
    const top = evidence(page).locator('.comparison-evidence-card[data-role="TOP"][data-changed="true"]');
    await expect(top).toHaveCount(1);
    await expect(top.locator('[data-side="A"] [data-scope="season"]')).toHaveAttribute("data-picks", "4");
    await expect(top.locator('[data-side="B"] [data-scope="season"]')).toHaveAttribute("data-picks", "2");
    // Unknown players (not in the file) are never 0.
    await expect(evidence(page).locator(".comparison-evidence-summary")).toContainText("기록 확인 불가");
    await expect(evidence(page).locator(".comparison-evidence-unconfirmed > summary")).toBeVisible();
    await expect(evidence(page).locator('.comparison-evidence-same [data-status="UNCONFIRMED"]')).toHaveCount(0);
    await expect(evidence(page).locator('[data-status="UNCONFIRMED"]').first()).toContainText("기록 확인 불가");
    await expect(evidence(page).locator('[data-available="unknown"]').first()).toContainText("0 아님");
    await expect(evidence(page)).not.toContainText(/유리|승리|숙련도|강함/);
    await unchanged();
    await expectNoOverflow(page);
    await evidence(page).screenshot({ path: testInfo.outputPath("ab-player-evidence.png") });

    // Close and reopen: the validated file is reused (no new request).
    await evidence(page).locator("> summary").click();
    await evidence(page).locator("> summary").click();
    await expect(mid).toHaveCount(1);
    expect(state.requests).toBe(3);

    // v3 save: roles included, annual data not.
    const downloadPromise = page.waitForEvent("download");
    await comparison(page).getByRole("button", { name: "A/B 비교 JSON 저장", exact: true }).click();
    const filePath = testInfo.outputPath("ab-roles-comparison.json");
    await (await downloadPromise).saveAs(filePath);
    const text = await readFile(filePath, "utf8");
    const artifact = JSON.parse(text);
    expect(artifact.schema_version).toBe("3");
    expect(artifact.baseline_a.champion_roles).not.toBeNull();
    expect(artifact.current_b.champion_roles).not.toBeNull();
    expect(artifact.comparison.roles.status).toBe("COMPARED");
    expect(artifact.comparison.roles.changes).toHaveLength(2);
    expect(artifact.boundary).toContain("NOT included in or reproduced by this file");
    expect(text).not.toMatch(/player-season|season_accepted_game_count|FixtureOther/);

    // Read-only replay: role diff recomputed from the file; current work untouched.
    await comparison(page).locator(".draft-comparison-file input").setInputFiles(filePath);
    const replay = comparison(page).locator(".draft-comparison-replay");
    await expect(replay.getByRole("status").first()).toContainText("일치합니다");
    await expect(replay.locator('[data-role-diff="changed"]')).toContainText("변경된 역할 배정 2개");
    await expect(replay).toContainText("연간 선수·챔피언 기록은 비교 파일에 없으므로 재현하지 않습니다");
    await expect(replay.locator("details.comparison-evidence")).toHaveCount(0);
    await unchanged();
    expect(await rosterValues(page)).toEqual({ ...playersA, "blue.MID": replacement });
    expect(state.requests).toBe(3);
    await expectNoOverflow(page);
    expect(state.errors).toEqual([]);
  } finally { gates.forEach((release) => release()); }
});
