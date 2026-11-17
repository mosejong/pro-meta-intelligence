import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite;
let S;
let C;
let R;
let P;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/player-season-history.ts");
  C = await vite.ssrLoadModule("/app/comparison-player-evidence.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  P = await vite.ssrLoadModule("/app/comparison-player-evidence-panel.tsx");
});
after(async () => { await vite?.close(); });

const CUTOFF = "2026-11-14T00:19:10.467435+00:00";
const basis = { patch_id: "16.20", cutoff: CUTOFF, fixture_only: false, source_versions: ["oe@sha256:new#sha256:new"] };
const t = (day) => `2026-${day}T00:00:00+00:00`;
const scope = (champions) => {
  const games = champions.reduce((sum, [, n]) => sum + n, 0);
  return { games, first_observed_at: games ? t("03-01") : null, last_observed_at: games ? t("10-01") : null,
    champions: champions.map(([champion_id, games]) => ({ champion_id, games })) };
};
const role = (season, recent = season, patch = []) => {
  const games = scope(season).games, patchGames = scope(patch).games;
  return { season: scope(season), recent: scope(recent), patch: scope(patch),
    by_patch: [["16.05", games - patchGames], ["16.20", patchGames]].filter(([, n]) => n > 0).map(([id, games]) => ({ id, games, first_observed_at: t("03-01"), last_observed_at: t("10-01") })),
    by_league: [{ id: "LCK", games, first_observed_at: t("03-01"), last_observed_at: t("10-01") }] };
};
const player = (team_id, player_id, player_name, roles, status = "FOUND") => ({
  team_id, team_name: team_id.toUpperCase(), player_id, player_name, status, roles,
  games: Object.values(roles).reduce((sum, r) => sum + r.season.games, 0),
});

function historyText(basisOverride = basis) {
  const players = [
    // Wukong recorded under its display alias; must match MonkeyKing locks/picks.
    player("t-a", "p-mid", "Core", { MID: role([["Ahri", 18], ["Wukong", 4], ["Syndra", 3], ["Azir", 1]], [["Ahri", 14], ["Wukong", 4], ["Syndra", 2]], [["Ahri", 2]]) }),
    // Same display name on another team: never merged with t-a/p-mid.
    player("t-b", "p-mid2", "Core", { MID: role([["Viktor", 4], ["Ahri", 2]]) }),
    // Substitute mid of t-a.
    player("t-a", "p-sub", "Bench", { MID: role([["Orianna", 7], ["Ahri", 1]]) }),
    // TOP only: assigned to SUPPORT → role 0 games.
    player("t-a", "p-top", "Rock", { TOP: role([["Gnar", 6]]) }),
    player("t-c", "p-jg", "Vine", { JUNGLE: role([["Sejuani", 5], ["Vi", 2]]) }),
  ];
  return JSON.stringify({
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: CUTOFF, reference_patch: "16.20",
    recent_game_limit: 20, roster_basis: basisOverride,
    source: { source_id: "oe", source_version: "sha256:old", content_hash: "sha256:old", retrieved_at: "2026-11-11T02:19:29.155420+00:00" },
    source_versions: ["oe@sha256:old#sha256:old"],
    import_summary: { discovered_game_count: 100, accepted_game_count: 90, rejected_game_count: 10, season_accepted_game_count: 80,
      season_first_observed_at: t("01-10"), season_last_observed_at: t("11-10") },
    player_count: players.length, players,
  });
}
function loaded(b = basis) {
  const result = S.parsePlayerSeasonHistory(historyText(b), { basis: b, season: 2026 });
  assert.equal(result.ok, true, result.error);
  return { basisKey: R.basisKey(b), history: result.value };
}

const slot = (source_team_id, player_id, player_name) => ({ source_team_id, player_id, player_name, source_team_name: source_team_id.toUpperCase() });
const pick = (side, slot, champion_id) => ({ side, kind: "PICK", slot, champion_id });
const ban = (side, slot, champion_id) => ({ side, kind: "BAN", slot, champion_id });

/** A DraftComparisonSnapshot-shaped value (the pure module reads only these fields). */
function snapshot(overrides = {}) {
  const value = {
    evidenceIdentity: "x", model: "m", patch: "16.20", cutoff: CUTOFF, fixtureOnly: false, firstPickSide: "BLUE", games: [],
    teams: { BLUE: { id: "t-a", name: "A" }, RED: { id: "t-b", name: "B" } },
    locks: [],
    selections: [
      ban("BLUE", 1, "Syndra"), ban("RED", 1, "Orianna"),
      pick("BLUE", 1, "Gnar"), pick("BLUE", 2, "Sejuani"), pick("BLUE", 3, "Ahri"), pick("BLUE", 4, "Jinx"), pick("BLUE", 5, "Rakan"),
      pick("RED", 1, "Ornn"), pick("RED", 2, "Vi"), pick("RED", 3, "Viktor"), pick("RED", 4, "Xayah"), pick("RED", 5, "Nautilus"),
    ],
    roster: { basis, team_ids: ["t-a", "t-b"], teams: {
      "t-a": { TOP: slot("t-a", "p-top", "Rock"), JUNGLE: slot("t-c", "p-jg", "Vine"), MID: slot("t-a", "p-mid", "Core"), BOTTOM: slot("t-a", "p-unknown", "Nobody"), SUPPORT: slot("t-a", "p-top", "Rock") },
      "t-b": { TOP: null, JUNGLE: slot("t-b", "p-x", "X"), MID: slot("t-b", "p-mid2", "Core"), BOTTOM: slot("t-b", "p-y", "Y"), SUPPORT: slot("t-b", "p-z", "Z") },
    } },
    roles: {
      "t-a": { TOP: "Gnar", JUNGLE: "Sejuani", MID: "Ahri", BOTTOM: "Jinx", SUPPORT: "Rakan" },
      "t-b": { TOP: "Ornn", JUNGLE: "Vi", MID: "Viktor", BOTTOM: "Xayah", SUPPORT: "Nautilus" },
    },
  };
  return { ...structuredClone(value), ...overrides };
}
const rowOf = (result, teamId, role) => result.rows.find((r) => r.team_id === teamId && r.role === role);
const compareOk = (a, b, l = loaded()) => { const result = C.compareAssignedEvidence(a, b, l); assert.equal(result.ok, true, result.message); return result; };

test("identical A/B: 10 rows by team ID, nothing changed, inputs not mutated", () => {
  const a = snapshot(), b = snapshot();
  const before = JSON.stringify([a, b]);
  const result = compareOk(a, b);
  assert.equal(result.rows.length, 10);
  assert.equal(result.rows.filter((r) => r.changed).length, 0);
  assert.equal(JSON.stringify([a, b]), before);
});

test("same champion, different player: player change is a sample difference, not skill", () => {
  const b = snapshot(); b.roster.teams["t-a"].MID = slot("t-a", "p-sub", "Bench");
  const row = rowOf(compareOk(snapshot(), b), "t-a", "MID");
  assert.equal(row.player_changed, true); assert.equal(row.champion_changed, false); assert.equal(row.changed, true);
  assert.deepEqual([row.a.row.scopes.season.picks, row.a.row.scopes.season.games], [18, 26]);
  assert.deepEqual([row.b.row.scopes.season.picks, row.b.row.scopes.season.games], [1, 8]);
  assert.deepEqual([row.newly_locked, row.reopened], [[], []], "lock deltas only for the same player");
  const text = C.explainRow(row, (id) => id).join(" ");
  assert.match(text, /선수 Core → Bench/);
  assert.match(text, /서로 다른 선수의 표본/);
  assert.match(text, /실력 비교가 아닙니다/);
  assert.match(text, /연간 관측 횟수 차이 -17회 \(분모 26→8경기, 원시 횟수\)/);
  assert.doesNotMatch(text, /유리|승리|숙련도|강함|%/);
});

test("same player, different champion: A→B counts with the same role denominator", () => {
  const b = snapshot();
  b.selections = b.selections.map((s) => s.champion_id === "Ahri" ? { ...s, champion_id: "Azir" } : s);
  b.roles["t-a"].MID = "Azir";
  const row = rowOf(compareOk(snapshot(), b), "t-a", "MID");
  assert.equal(row.player_changed, false); assert.equal(row.champion_changed, true);
  assert.deepEqual([row.b.row.scopes.season.picks, row.b.row.scopes.season.games], [1, 26]);
  // Ahri reopens for the next set (no longer picked), Azir becomes locked.
  assert.deepEqual(row.reopened, ["Ahri"]);
  assert.deepEqual(row.newly_locked, ["Azir"]);
  const text = C.explainRow(row, (id) => id).join(" ");
  assert.match(text, /챔피언 Ahri 연간 18\/26경기 → Azir 연간 1\/26경기/);
  assert.match(text, /새로 잠김: Azir/);
  assert.match(text, /다시 열림: Ahri/);
});

test("same player, role change: the role record itself changes (role 0 stays distinct)", () => {
  const b = snapshot();
  b.roster.teams["t-a"].MID = slot("t-a", "p-top", "Rock");
  b.roster.teams["t-a"].TOP = slot("t-a", "p-mid", "Core");
  const result = compareOk(snapshot(), b);
  const mid = rowOf(result, "t-a", "MID");
  assert.equal(mid.b.row.status, "ZERO_IN_ROLE");
  assert.equal(C.annualText(mid.b), "미드 0경기");
  assert.deepEqual(mid.b.pool, { observed_unique: 0, available: 0, remaining: [], locked: [] }, "found player, 0 role games: empty pool, not unknown");
});

test("unknown, empty and role-0 stay distinct; unknown is never 0", () => {
  const result = compareOk(snapshot(), snapshot());
  const bottom = rowOf(result, "t-a", "BOTTOM");
  assert.equal(bottom.a.row.status, "UNCONFIRMED");
  assert.equal(bottom.a.pool, null);
  assert.equal(C.annualText(bottom.a), "기록 확인 불가");
  const empty = rowOf(result, "t-b", "TOP");
  assert.equal(empty.a.row.status, "EMPTY"); assert.equal(empty.a.pool, null);
  assert.equal(C.annualText(empty.a), "선수 빈칸");
  const support = rowOf(result, "t-a", "SUPPORT");
  assert.equal(support.a.row.status, "ZERO_IN_ROLE");
  assert.equal(C.annualText(support.a), "서포터 0경기");
  assert.match(C.explainRow(bottom, (id) => id).join(" "), /확인 불가 → 확인 불가/);
});

test("same display name on another team / virtual assignment keep source team and player ID", () => {
  const result = compareOk(snapshot(), snapshot());
  const redMid = rowOf(result, "t-b", "MID");
  assert.equal(redMid.a.row.player_key, JSON.stringify(["t-b", "p-mid2"]));
  assert.deepEqual([redMid.a.row.scopes.season.picks, redMid.a.row.scopes.season.games], [4, 6], "t-b/Core, not t-a/Core");
  const jungle = rowOf(result, "t-a", "JUNGLE");
  assert.equal(jungle.a.row.virtual, true);
  assert.equal(jungle.a.row.source_team_id, "t-c");
});

test("next-set pool: both teams' current picks and previous picks locked; current bans freed; aliases", () => {
  const a = snapshot();
  const mid = rowOf(compareOk(a, a), "t-a", "MID");
  // Observed: Ahri, Wukong, Syndra, Azir. Current picks lock Ahri; Syndra is only banned → stays available.
  assert.equal(mid.a.pool.observed_unique, 4);
  assert.deepEqual(mid.a.pool.remaining.map((c) => c.champion_id), ["Wukong", "Syndra", "Azir"], "by games desc");
  assert.deepEqual(mid.a.pool.locked, ["Ahri"]);
  // Previous-set lock recorded as MonkeyKing locks the Wukong alias.
  const withLocks = snapshot({ locks: ["MonkeyKing"] });
  const locked = rowOf(compareOk(withLocks, withLocks), "t-a", "MID");
  assert.deepEqual(locked.a.pool.remaining.map((c) => c.champion_id), ["Syndra", "Azir"]);
  assert.deepEqual(locked.a.pool.locked, ["Ahri", "Wukong"]);
  // Other team's current pick also locks (Viktor for t-b mid is its own pick; Ahri picked by t-a locks t-b's Ahri).
  const redMid = rowOf(compareOk(a, a), "t-b", "MID");
  assert.deepEqual(redMid.a.pool.remaining, [], "Viktor (own pick) and Ahri (other team's pick) both locked");
  assert.equal(C.nextSetLocks(a).has("syndra"), false, "bans are not next-set locks");
  assert.equal(C.nextSetLocks(withLocks).has("monkeyking"), true);
  const union = C.nextSetLocks(snapshot({ locks: ["Orianna"] }));
  assert.ok(union.has("orianna") && union.has("ahri"), "union of previous locks and current picks");
});

test("side swap is matched by team ID, not by side", () => {
  const b = snapshot();
  b.teams = { BLUE: { id: "t-b", name: "B" }, RED: { id: "t-a", name: "A" } };
  b.selections = b.selections.map((s) => ({ ...s, side: s.side === "BLUE" ? "RED" : "BLUE" }));
  const result = compareOk(snapshot(), b);
  assert.equal(result.rows.filter((r) => r.changed).length, 0);
  const row = rowOf(result, "t-a", "MID");
  assert.deepEqual([row.side_a, row.side_b], ["BLUE", "RED"]);
  assert.equal(result.rows[0].team_id, "t-b", "rows follow B's sides");
});

test("holds: roles missing, pair changed, evidence or basis mismatch", () => {
  const hold = (a, b, l = loaded()) => C.compareAssignedEvidence(a, b, l);
  assert.equal(hold(snapshot({ roles: null }), snapshot()).code, "ROLES_MISSING");
  assert.equal(hold(snapshot(), snapshot({ roster: null })).code, "ROLES_MISSING");
  assert.equal(C.hasRoleRecord(snapshot({ roles: null })), false);
  const other = snapshot(); other.roster.team_ids = ["t-a", "t-c"];
  assert.equal(hold(snapshot(), other).code, "PAIR_CHANGED");
  assert.equal(hold(snapshot(), snapshot({ evidenceIdentity: "y" })).code, "EVIDENCE_MISMATCH");
  assert.equal(hold(snapshot(), snapshot({ model: "m2" })).code, "EVIDENCE_MISMATCH");
  const otherBasis = { ...basis, source_versions: ["oe@sha256:other#sha256:other"] };
  assert.equal(hold(snapshot(), snapshot(), loaded(otherBasis)).code, "BASIS_MISMATCH", "file validated for another basis");
  assert.equal(hold(snapshot({ patch: "16.21" }), snapshot({ patch: "16.21" })).code, "BASIS_MISMATCH", "patch differs from the file");
});

test("panel: collapsed by default, no request until opened, roles CTA and fixed wording", async () => {
  const markup = renderToStaticMarkup(createElement(P.ComparisonPlayerEvidence, { a: snapshot(), b: snapshot(), basis, publicationRoot: "./", nameOf: (id) => id }));
  assert.match(markup, /<details class="comparison-evidence">/);
  assert.match(markup, /선수·챔피언 경험 차이/);
  assert.match(markup, /펼칠 때 불러옴/);
  assert.doesNotMatch(markup, /comparison-evidence-body/, "body (and request) only after the user opens it");
  const noRoles = renderToStaticMarkup(createElement(P.ComparisonPlayerEvidence, { a: snapshot({ roles: null }), b: snapshot(), basis, publicationRoot: "./", nameOf: (id) => id }));
  assert.match(noRoles, /역할 배정 기록 필요/);
  const source = await readFile(new URL("../app/comparison-player-evidence-panel.tsx", import.meta.url), "utf8");
  const pure = await readFile(new URL("../app/comparison-player-evidence.ts", import.meta.url), "utf8");
  for (const text of [source, pure]) {
    assert.doesNotMatch(text, /localStorage|writeLocalDraft|setBaseline|onRosterChange/, "never touches storage, A or the roster");
    assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /유리|승리|숙련도|강함/, "no advantage/win/proficiency wording");
  }
  assert.match(source, /loadPlayerSeasonHistory\(url, \{ basis, season: PLAYER_SEASON_YEAR \}, request\.signal\)/, "reuses the existing loader (timeout, basis check, abort)");
  assert.match(source, /request\.signal\.aborted \|\| currentKey\.current !== key/, "late responses after cancel/key change dropped");
  assert.match(source, /현재 추가 참고/);
  assert.match(source, /A\/B 비교 JSON에 포함되지 않아/);
  assert.match(source, /0이 아니라 확인 불가/);
});
