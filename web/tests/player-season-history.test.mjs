import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let S;
let R;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/player-season-history.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
});
after(async () => { await vite?.close(); });

const CUTOFF = "2026-11-14T00:19:10.467435+00:00";
const basis = { patch_id: "16.20", cutoff: CUTOFF, fixture_only: false, source_versions: ["oe@sha256:new#sha256:new"] };
const t = (day) => `2026-${day}T00:00:00+00:00`;
const scope = (champions, first = t("03-01"), last = t("10-01")) => {
  const games = champions.reduce((sum, [, n]) => sum + n, 0);
  return { games, first_observed_at: games ? first : null, last_observed_at: games ? last : null,
    champions: champions.map(([champion_id, n]) => ({ champion_id, games: n, example_event_ids: [`ev:${champion_id}`] })) };
};
const role = (season, recent = season, patch = []) => {
  const s = scope(season), games = s.games;
  const patchGames = patch.reduce((sum, [, n]) => sum + n, 0);
  return { season: s, recent: scope(recent), patch: scope(patch),
    by_patch: [["16.05", games - patchGames], ["16.20", patchGames]].filter(([, n]) => n > 0).map(([id, games]) => ({ id, games, first_observed_at: t("03-01"), last_observed_at: t("10-01") })),
    by_league: [{ id: "LCK", games, first_observed_at: t("03-01"), last_observed_at: t("10-01") }] };
};
const player = (team_id, player_id, player_name, roles, status = "FOUND") => ({
  team_id, team_name: team_id.toUpperCase(), player_id, player_name, status, roles,
  games: Object.values(roles).reduce((sum, r) => sum + r.season.games, 0),
});

function history(overrides = {}) {
  const value = {
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: CUTOFF, reference_patch: "16.20",
    recent_game_limit: 20, roster_basis: basis,
    source: { source_id: "oe", source_version: "sha256:old", content_hash: "sha256:old", retrieved_at: "2026-11-11T02:19:29.155420+00:00" },
    source_versions: ["oe@sha256:old#sha256:old"],
    import_summary: { discovered_game_count: 100, accepted_game_count: 90, rejected_game_count: 10, season_accepted_game_count: 80,
      season_first_observed_at: t("01-10"), season_last_observed_at: t("11-10") },
    players: [
      player("t-a", "p-mid", "Core", { MID: role([["Ahri", 15], ["Kai'Sa", 3], ["Wukong", 2], ["Syndra", 2], ["Orianna", 1], ["Azir", 1]], [["Ahri", 15], ["Kai'Sa", 3], ["Wukong", 2]], [["Azir", 1]]) }),
      player("t-b", "p-mid2", "Core", { MID: role([["Viktor", 4]]), TOP: role([["Gnar", 2]]) }),
      player("t-a", "p-gone", "Ghost", {}, "NOT_FOUND"),
    ],
    ...overrides,
  };
  return { ...value, player_count: Array.isArray(value.players) ? value.players.length : 0 };
}
const parse = (value, b = basis) => S.parsePlayerSeasonHistory(typeof value === "string" ? value : JSON.stringify(value), { basis: b, season: 2026 });
const ok = (value) => { const result = parse(value); assert.equal(result.ok, true, result.error); return result.value; };

function checkRetainedAsset(text, currentBasis) {
  const archivedBasis = JSON.parse(text).roster_basis;
  const archived = S.parsePlayerSeasonHistory(text, { basis: archivedBasis });
  assert.equal(archived.ok, true, "retained history must remain internally valid even when a refresh failed");
  const result = S.parsePlayerSeasonHistory(text, { basis: currentBasis });
  if (!result.ok) {
    assert.equal(result.code, "BASIS_MISMATCH", result.error);
    assert.ok(Date.parse(archivedBasis.cutoff) <= Date.parse(currentBasis.cutoff), "a retained optional asset must not come from a future cutoff");
  }
  return result;
}

test("a retained valid asset is withheld after a feed refresh but corrupt or future assets still fail", () => {
  const text = JSON.stringify(history());
  assert.equal(checkRetainedAsset(text, basis).ok, true);
  const later = { ...basis, cutoff: "2026-11-15T00:00:00Z" };
  assert.equal(checkRetainedAsset(text, later).code, "BASIS_MISMATCH");
  assert.throws(() => checkRetainedAsset(text, { ...basis, cutoff: "2026-11-13T00:00:00Z" }));
  const broken = history(); broken.players[0].games += 1;
  assert.throws(() => checkRetainedAsset(JSON.stringify(broken), later));
});

test("rejects contradictory periods, provenance and role subset counts", () => {
  const cases = {
    reversed: p => { p.players[0].roles.MID.season.first_observed_at = t("10-02"); },
    outsideSeason: p => { p.players[0].roles.MID.season.first_observed_at = "2025-12-31T00:00:00Z"; },
    afterRetrieval: p => { p.players[0].roles.MID.season.last_observed_at = t("11-12"); },
    futureBreakdown: p => { p.players[0].roles.MID.by_patch[0].last_observed_at = "2027-01-01T00:00:00Z"; },
    duplicateBreakdown: p => { p.players[0].roles.MID.by_patch[1].id = "16.05"; },
    sourceMismatch: p => { p.source_versions = ["oe@different#different"]; },
    badPlayerCount: p => { p.player_count += 1; },
    badFileCounts: p => { p.import_summary.accepted_game_count += 1; },
    insufficientRecent: p => { p.players[0].roles.MID.recent = scope([["Ahri", 1]]); },
    foreignSubset: p => { p.players[0].roles.MID.recent.champions[0].champion_id = "Garen"; },
    duplicateAlias: p => { p.players[0].roles.MID.season.champions[2].champion_id = "Kaisa"; },
    mismatchedPatch: p => { p.players[0].roles.MID.by_patch[1].id = "16.19"; },
  };
  for (const [name, mutate] of Object.entries(cases)) { const value = history(); mutate(value); assert.equal(parse(value).ok, false, name); }
});

test("a valid file keeps every season champion, not just the top four", () => {
  const value = ok(history());
  const core = value.players.get(R.playerKey("t-a", "p-mid"));
  assert.equal(core.roles.MID.season.champions.length, 6);
  assert.equal(S.sourceIsOlder(value), true);
  const slot = S.seasonSlot({ history: value, role: "MID", assigned: { source_team_id: "t-a", player_id: "p-mid" }, scope: "season", selections: [], previousPicks: [] });
  assert.equal(slot.status, "OBSERVED");
  assert.equal(slot.champions.length, 6);
  assert.equal(slot.stats.games, 24);
});

test("rejects malformed, future, oversized and mismatched files", () => {
  const cases = [
    ["{", "INVALID_JSON"],
    [{ ...history(), artifact_type: "x" }, "WRONG_TYPE"],
    [{ ...history(), schema_version: 2 }, "FUTURE_VERSION"],
    [{ ...history(), schema_version: 0 }, "BAD_VERSION"],
    [{ ...history(), season: 2025 }, "SEASON_MISMATCH"],
    [{ ...history(), roster_basis: { ...basis, patch_id: "16.19" } }, "BASIS_MISMATCH"],
    [{ ...history(), roster_basis: { ...basis, source_versions: ["oe@other#other"] } }, "BASIS_MISMATCH"],
    [{ ...history(), cutoff: "2026-11-15T00:00:00+00:00" }, "BASIS_MISMATCH"],
    [{ ...history(), source: { ...history().source, retrieved_at: "2026-11-15T00:00:00+00:00" } }, "FUTURE_SOURCE"],
    [{ ...history(), import_summary: { ...history().import_summary, season_last_observed_at: "2026-11-20T00:00:00+00:00" } }, "FUTURE_SOURCE"],
    [history({ players: [player("t-a", "p", "P", { MID: role([["Ahri", 1]], [["Ahri", 1]], []) })].map((p) => ({ ...p, roles: { MID: { ...p.roles.MID, season: { ...p.roles.MID.season, last_observed_at: "2026-12-01T00:00:00+00:00" } } } })) }), "FUTURE_SOURCE"],
    [history({ players: [{ ...player("t-a", "p", "P", { MID: role([["Ahri", 2]]) }), games: 3 }] }), "BAD_SHAPE"],
    [history({ players: [player("t-a", "p", "P", { MID: { ...role([["Ahri", 2]]), season: { ...scope([["Ahri", 2]]), games: 3 } } })] }), "BAD_SHAPE"],
    [history({ players: [player("t-a", "p", "P", { JUNGLE_X: role([["Ahri", 2]]) })] }), "BAD_SHAPE"],
    [history({ players: [player("t-a", "p", "P", { MID: role([["Ahri", 1]])}), player("t-a", "p", "P", { MID: role([["Ahri", 1]]) })] }), "BAD_SHAPE"],
  ];
  for (const [value, code] of cases) {
    const result = parse(value);
    assert.equal(result.ok, false, `expected ${code}`);
    assert.equal(result.code, code);
  }
  const big = JSON.stringify(history()) + " ".repeat(S.MAX_PLAYER_SEASON_BYTES);
  assert.equal(parse(big).code, "TOO_LARGE");
});

test("role with zero games differs from a player missing in the file", () => {
  const value = ok(history());
  const at = (team, id, r, s = "season") => S.seasonSlot({ history: value, role: r, assigned: team ? { source_team_id: team, player_id: id } : null, scope: s, selections: [], previousPicks: [] });
  assert.equal(at(null, null, "MID").status, "EMPTY");
  assert.equal(at("t-a", "p-gone", "MID").status, "UNCONFIRMED");
  assert.equal(at("t-a", "unknown", "MID").status, "UNCONFIRMED");
  // Exact (team, player) only: the same player ID under another team is not found.
  assert.equal(at("t-b", "p-mid", "MID").status, "UNCONFIRMED");
  const moved = at("t-a", "p-mid", "SUPPORT");
  assert.equal(moved.status, "ZERO_IN_ROLE");
  assert.deepEqual(moved.other_roles, [{ role: "MID", games: 24 }]);
  assert.equal(moved.champions.length, 0);
  // Recent and current-patch scopes keep their own denominators.
  assert.equal(at("t-a", "p-mid", "MID", "recent").stats.games, 20);
  assert.deepEqual(at("t-a", "p-mid", "MID", "patch").champions.map((c) => c.champion_id), ["Azir"]);
  assert.equal(at("t-b", "p-mid2", "MID", "patch").status, "ZERO_IN_ROLE");
});

test("same name players stay separate and new selections switch records", () => {
  const value = ok(history());
  const first = S.seasonSlot({ history: value, role: "MID", assigned: { source_team_id: "t-a", player_id: "p-mid" }, scope: "season", selections: [], previousPicks: [] });
  const second = S.seasonSlot({ history: value, role: "MID", assigned: { source_team_id: "t-b", player_id: "p-mid2" }, scope: "season", selections: [], previousPicks: [] });
  assert.equal(first.player.player_name, second.player.player_name);
  assert.deepEqual(second.champions.map((c) => c.champion_id), ["Viktor"]);
  assert.notDeepEqual(first.champions.map((c) => c.champion_id), second.champions.map((c) => c.champion_id));
});

test("bans, picks and earlier-set locks use alias-normalized champion keys", () => {
  const value = ok(history());
  const slot = S.seasonSlot({ history: value, role: "MID", assigned: { source_team_id: "t-a", player_id: "p-mid" }, scope: "season",
    selections: [{ kind: "BAN", champion_id: "KaiSa" }, { kind: "PICK", champion_id: "Syndra" }], previousPicks: ["MonkeyKing", "Lux"] });
  const state = Object.fromEntries(slot.champions.map((c) => [c.champion_id, c.state]));
  assert.equal(state["Kai'Sa"], "BANNED_NOW");
  assert.equal(state.Syndra, "PICKED_NOW");
  assert.equal(state.Wukong, "FEARLESS_LOCKED");
  assert.equal(state.Ahri, "AVAILABLE");
  assert.equal(slot.available_count, 3);
});

test("loader reports unavailable, declared oversize and propagates aborts", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("missing", { status: 404 });
    assert.equal((await S.loadPlayerSeasonHistory("http://x/h.json", { basis })).code, "UNAVAILABLE");
    globalThis.fetch = async () => new Response("{}", { headers: { "content-length": String(S.MAX_PLAYER_SEASON_BYTES + 1) } });
    assert.equal((await S.loadPlayerSeasonHistory("http://x/h.json", { basis })).code, "TOO_LARGE");
    globalThis.fetch = async () => new Response(JSON.stringify(history()));
    assert.equal((await S.loadPlayerSeasonHistory("http://x/h.json", { basis })).ok, true);
    globalThis.fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const controller = new AbortController();
    const pending = S.loadPlayerSeasonHistory("http://x/h.json", { basis }, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  } finally { globalThis.fetch = original; }
});

const realPath = new URL("../public/history/player-season-2026.json", import.meta.url);
test("real derived file is valid and either matches the feed or is safely withheld", { skip: !existsSync(realPath) && "derived file not generated" }, async () => {
  const feed = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const text = await readFile(realPath, "utf8");
  assert.ok(Buffer.byteLength(text) <= S.MAX_PLAYER_SEASON_BYTES);
  const result = checkRetainedAsset(text, R.rosterBasis(feed));
  if (!result.ok) {
    return; // Accepted feed publication may continue; runtime must not apply these old records.
  }
  assert.equal(result.ok, true, result.error);
  const value = result.value;
  const teams = feed.opponent_prep.teams.filter((team) => (team.player_profiles ?? []).length);
  let found = 0, wide = 0, teamsWithFound = 0;
  for (const team of teams) {
    let teamFound = false;
    for (const profile of team.player_profiles) {
      const record = value.players.get(R.playerKey(team.team_id, profile.player_id));
      assert.ok(record, `${team.team_name} ${profile.player_name} is in the file`);
      assert.equal(record.team_id, team.team_id);
      if (record.status !== "FOUND") continue;
      found += 1; teamFound = true;
      for (const r of Object.values(record.roles)) if (r.season.champions.length > 4) wide += 1;
    }
    if (teamFound) teamsWithFound += 1;
  }
  assert.ok(teamsWithFound >= 5, `several teams have season records (${teamsWithFound})`);
  assert.ok(found > 0 && wide > 0, `some role lists exceed four champions (${wide})`);
});
