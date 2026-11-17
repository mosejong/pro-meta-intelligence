import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let S;
let E;
let R;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/player-season-history.ts");
  E = await vite.ssrLoadModule("/app/simulation-player-evidence.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
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
    // Blue mid: Ahri played, Wukong recorded under its display alias.
    player("t-a", "p-mid", "Core", { MID: role([["Ahri", 18], ["Wukong", 4], ["Syndra", 3]], [["Ahri", 14], ["Wukong", 4], ["Syndra", 2]], [["Ahri", 2]]) }),
    // Same name, other team: must never be merged with t-a/p-mid.
    player("t-b", "p-mid2", "Core", { MID: role([["Viktor", 4]]) }),
    // Played TOP only; assigned to SUPPORT in the input → role 0 games.
    player("t-a", "p-top", "Rock", { TOP: role([["Gnar", 6]]) }),
    // Observed with team t-c; virtually moved to t-a JUNGLE.
    player("t-c", "p-jg", "Vine", { JUNGLE: role([["Sejuani", 5], ["Vi", 2]]) }),
    player("t-a", "p-gone", "Ghost", {}, "NOT_FOUND"),
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
function snapshot(overrides = {}) {
  return {
    evidenceIdentity: "x", model: "m", patch: "16.20", cutoff: CUTOFF, fixtureOnly: false, sourceVersions: basis.source_versions,
    rosterEvidenceScope: "CURRENT_REPORT_PLAYER_OBSERVATIONS", roleSource: "USER_ASSIGNED",
    draft: {
      teams: { BLUE: { id: "t-a", name: "A" }, RED: { id: "t-b", name: "B" } },
      roster: { basis, team_ids: ["t-a", "t-b"], teams: {
        "t-a": { TOP: slot("t-a", "p-gone", "Ghost"), JUNGLE: slot("t-c", "p-jg", "Vine"), MID: slot("t-a", "p-mid", "Core"), BOTTOM: slot("t-a", "p-unknown", "Nobody"), SUPPORT: slot("t-a", "p-top", "Rock") },
        "t-b": { TOP: null, JUNGLE: slot("t-b", "p-x", "X"), MID: slot("t-b", "p-mid2", "Core"), BOTTOM: slot("t-b", "p-y", "Y"), SUPPORT: slot("t-b", "p-z", "Z") },
      } },
    },
    roles: {
      "t-a": { TOP: "Gnar", JUNGLE: "Sejuani", MID: "Ahri", BOTTOM: "Jinx", SUPPORT: "Gnar" },
      "t-b": { TOP: "Ornn", JUNGLE: "Vi", MID: "Ahri", BOTTOM: "Xayah", SUPPORT: "Rakan" },
    },
    ...overrides,
  };
}
const row = (rows, teamId, role) => rows.find((r) => r.team_id === teamId && r.role === role);
const evidence = (snap = snapshot(), l = loaded()) => { const result = E.assignedChampionEvidence(snap, l); assert.equal(result.ok, true); return result.rows; };

test("assigned champion counts only within the assigned role per scope; absent champion is 0 of the role's games", () => {
  const rows = evidence();
  assert.equal(rows.length, 10);
  const mid = row(rows, "t-a", "MID");
  assert.equal(mid.status, "OBSERVED");
  assert.deepEqual([mid.scopes.season.picks, mid.scopes.season.games], [18, 25]);
  assert.deepEqual([mid.scopes.recent.picks, mid.scopes.recent.games], [14, 20]);
  assert.deepEqual([mid.scopes.patch.picks, mid.scopes.patch.games], [2, 2]);
  // Same player, champion not in the complete validated list → 0 with the role denominator.
  const snap = snapshot();
  snap.roles["t-a"] = { ...snap.roles["t-a"], MID: "Azir" };
  const zero = row(evidence(snap), "t-a", "MID");
  assert.equal(zero.status, "OBSERVED");
  assert.deepEqual(["season", "recent", "patch"].map((s) => [zero.scopes[s].picks, zero.scopes[s].games]), [[0, 25], [0, 20], [0, 2]]);
});

test("champion aliases resolve with the shared championKey", () => {
  const snap = snapshot();
  snap.roles["t-a"] = { ...snap.roles["t-a"], MID: "MonkeyKing" };
  assert.equal(row(evidence(snap), "t-a", "MID").scopes.season.picks, 4);
  snap.roles["t-a"].MID = "monkeyking";
  assert.equal(row(evidence(snap), "t-a", "MID").scopes.season.picks, 4);
});

test("found player without the assigned role is role 0 games; other roles are context only", () => {
  const support = row(evidence(), "t-a", "SUPPORT");
  assert.equal(support.status, "ZERO_IN_ROLE");
  assert.deepEqual(support.scopes.season, { games: 0, picks: 0, first_observed_at: null, last_observed_at: null });
  assert.deepEqual(support.other_roles, [{ role: "TOP", games: 6 }]);
});

test("missing, NOT_FOUND and empty slots are unknown, never 0", () => {
  const rows = evidence();
  for (const [teamId, role] of [["t-a", "TOP"], ["t-a", "BOTTOM"], ["t-b", "JUNGLE"]]) {
    const r = row(rows, teamId, role);
    assert.equal(r.status, "UNCONFIRMED");
    assert.equal(r.scopes, null);
  }
  assert.equal(row(rows, "t-b", "TOP").status, "EMPTY");
  assert.equal(row(rows, "t-b", "TOP").scopes, null);
});

test("same-name player of another team is never merged; source team meaning is kept for virtual moves", () => {
  const rows = evidence();
  const redMid = row(rows, "t-b", "MID");
  assert.equal(redMid.player_key, R.playerKey("t-b", "p-mid2"));
  assert.equal(redMid.scopes.season.picks, 0); // Ahri belongs to t-a/p-mid, not this "Core"
  assert.equal(redMid.scopes.season.games, 4);
  assert.equal(redMid.virtual, false);
  const jungle = row(rows, "t-a", "JUNGLE");
  assert.equal(jungle.virtual, true);
  assert.equal(jungle.source_team_id, "t-c");
  assert.equal(jungle.player_key, R.playerKey("t-c", "p-jg"));
  assert.deepEqual([jungle.scopes.season.picks, jungle.scopes.season.games], [5, 7]);
  // Looked up by the exact source team: the same player ID under the virtual team is unknown.
  const snap = snapshot();
  snap.draft.roster.teams["t-a"].JUNGLE = slot("t-a", "p-jg", "Vine");
  assert.equal(row(evidence(snap), "t-a", "JUNGLE").status, "UNCONFIRMED");
});

test("a history validated for another basis or a different snapshot cutoff/patch is refused", () => {
  const other = { ...basis, source_versions: ["oe@sha256:other#sha256:other"] };
  const result = E.assignedChampionEvidence(snapshot(), loaded(other));
  assert.equal(result.ok, false);
  assert.equal(result.code, "BASIS_MISMATCH");
  assert.equal(E.assignedChampionEvidence(snapshot({ patch: "16.21" }), loaded()).ok, false);
  assert.equal(E.assignedChampionEvidence(snapshot({ cutoff: "2026-11-15T00:00:00Z" }), loaded()).ok, false);
  // The loader itself refuses a mismatched file for the current basis.
  assert.equal(S.parsePlayerSeasonHistory(historyText(other), { basis, season: 2026 }).code, "BASIS_MISMATCH");
});

test("rows follow the current snapshot only and neither snapshot nor history is mutated", () => {
  const l = loaded();
  const snap = snapshot();
  const before = JSON.stringify(snap);
  const historyBefore = JSON.stringify([...l.history.players.entries()]);
  const first = evidence(snap, l);
  assert.equal(JSON.stringify(snap), before);
  assert.equal(JSON.stringify([...l.history.players.entries()]), historyBefore);
  // Replacing the MID player with an unknown one drops the previous player's numbers entirely.
  const next = structuredClone(snap);
  next.draft.roster.teams["t-a"].MID = slot("t-a", "p-new", "New");
  const after = row(evidence(next, l), "t-a", "MID");
  assert.equal(after.status, "UNCONFIRMED");
  assert.equal(after.scopes, null);
  assert.equal(row(first, "t-a", "MID").scopes.season.picks, 18);
});
