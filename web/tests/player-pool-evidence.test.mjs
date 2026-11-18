import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let P;
let R;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  P = await vite.ssrLoadModule("/app/player-pool-evidence.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
});
after(async () => { await vite?.close(); });

const champ = (champion_id, game_count, ids = [`ev:${champion_id}`]) => ({ champion_id, game_count, game_rate: 0, evidence_event_ids: ids });
const player = (player_id, player_name, role, game_count, champions, roster_status = "CURRENT") =>
  ({ player_id, player_name, role, roster_status, game_count, champions, evidence_match_ids: [`m:${player_id}`] });
const team = (team_id, team_name, player_profiles) => ({ team_id, team_name, game_count: 10, player_profiles,
  evidence: { first_observed_at: `2026-10-0${team_id.length}T00:00:00Z`, last_observed_at: "2026-11-10T00:00:00Z", match_ids: [], draft_event_ids: [] } });

function fixture() {
  return [
    team("t-a", "Alpha", [
      player("a-top", "Ace", "TOP", 4, [champ("Kai'Sa", 2), champ("Wukong", 1), champ("Ahri", 1)]),
      player("a-mid", "Core", "MID", 6, [champ("Ahri", 3), champ("Syndra", 2)]), // 5 listed of 6 games → limited
      player("a-sup", "Echo", "SUPPORT", 2, []), // empty list → unconfirmed
    ]),
    team("t-b", "Beta", [
      player("b-mid", "Core", "MID", 3, [champ("Orianna", 3)]), // same name, different ID
      player("b-top", "Gale", "TOP", 5, [champ("Gnar", 2), champ("Renekton", 1), champ("KSante", 1), champ("Jax", 1), champ("Aatrox", 1)]),
    ]),
    team("t-c", "Gamma", [player("c-dup", "Kite", "TOP", 2, [champ("Gnar", 2)]), player("c-dup", "Kite", "TOP", 2, [champ("Gnar", 2)])]),
  ];
}
const basis = { patch_id: "16.21", cutoff: "2026-11-14T00:00:00Z", fixture_only: false, top_champions: 5, maximum_games_per_team: 10 };
const at = (teams, teamId, role, sourceTeamId, playerId, extra = {}) => {
  const index = R.buildRosterIndex(teams);
  return P.slotEvidence({ teamId, role, assigned: sourceTeamId ? { source_team_id: sourceTeamId, player_id: playerId } : null,
    teams, index, basis, selections: [], previousPicks: [], ...extra });
};

test("slot evidence resolves by source team + player ID, never by name", () => {
  const teams = fixture();
  const alpha = at(teams, "t-a", "MID", "t-a", "a-mid");
  const beta = at(teams, "t-a", "MID", "t-b", "b-mid");
  assert.equal(alpha.player.player_id, "a-mid");
  assert.deepEqual(alpha.champions.map((item) => item.champion_id), ["Ahri", "Syndra"]);
  assert.equal(beta.player.player_id, "b-mid");
  assert.deepEqual(beta.champions.map((item) => item.champion_id), ["Orianna"]);
  assert.equal(beta.from_other_team, true);
  assert.equal(beta.source_team_name, "Beta");
  assert.equal(alpha.from_other_team, false);
  assert.equal(beta.window.first_observed_at, "2026-10-03T00:00:00Z");
  // Wrong source team for an existing player ID never falls back to a name/ID match elsewhere.
  assert.equal(at(teams, "t-a", "MID", "t-a", "b-mid").status, "UNRESOLVED");
});

test("empty, ambiguous and unknown slots are unconfirmed rather than zero", () => {
  const teams = fixture();
  assert.equal(at(teams, "t-a", "TOP", null).status, "EMPTY");
  assert.equal(at(teams, "t-c", "TOP", "t-c", "c-dup").status, "UNRESOLVED");
  assert.equal(at(teams, "t-a", "TOP", "t-a", "ghost").status, "UNRESOLVED");
  const echo = at(teams, "t-a", "SUPPORT", "t-a", "a-sup");
  assert.equal(echo.list_state, "EMPTY");
  assert.equal(echo.available_count, 0);
  assert.equal(echo.sample_games, 2);
});

test("role move keeps the observed role and never claims the assigned role", () => {
  const moved = at(fixture(), "t-a", "JUNGLE", "t-a", "a-top");
  assert.equal(moved.role, "JUNGLE");
  assert.equal(moved.observed_role, "TOP");
  assert.equal(moved.role_matches, false);
  assert.equal(at(fixture(), "t-a", "TOP", "t-a", "a-top").role_matches, true);
});

test("limited lists are flagged by cut length or uncovered games", () => {
  const teams = fixture();
  assert.equal(at(teams, "t-a", "MID", "t-a", "a-mid").list_state, "LIMITED");
  assert.equal(at(teams, "t-b", "TOP", "t-b", "b-top").list_state, "LIMITED");
  assert.equal(at(teams, "t-a", "TOP", "t-a", "a-top").list_state, "LISTED");
});

test("current ban/pick vs earlier picks, aliases, and earlier bans never lock", () => {
  const teams = fixture();
  const selections = [{ kind: "BAN", champion_id: "kaisa" }, { kind: "PICK", champion_id: "Ahri" }];
  const row = at(teams, "t-a", "TOP", "t-a", "a-top", { selections, previousPicks: ["MonkeyKing"] });
  assert.deepEqual(Object.fromEntries(row.champions.map((item) => [item.champion_id, item.state])),
    { "Kai'Sa": "BANNED_NOW", Wukong: "FEARLESS_LOCKED", Ahri: "PICKED_NOW" });
  assert.equal(row.available_count, 0);
  assert.equal(row.listed_count, 3);
  // A champion only banned in an earlier game is not in previousPicks and stays available.
  const free = at(teams, "t-a", "TOP", "t-a", "a-top", { previousPicks: [] });
  assert.equal(free.available_count, 3);
  assert.equal(P.poolChampionState("Nunu & Willump", [], ["Nunu"]), "FEARLESS_LOCKED");
  assert.equal(P.poolChampionState("Ahri", [{ kind: "BAN", champion_id: "Ahri" }], ["Ahri"]), "BANNED_NOW");
});

test("focus champion outside the list is unconfirmed", () => {
  const teams = fixture();
  const listed = at(teams, "t-a", "TOP", "t-a", "a-top", { focusChampionId: "Kaisa" });
  assert.equal(listed.focus.status, "LISTED");
  assert.equal(listed.focus.champion.game_count, 2);
  const outside = at(teams, "t-a", "TOP", "t-a", "a-top", { focusChampionId: "Zed" });
  assert.equal(outside.focus.status, "UNCONFIRMED");
  assert.equal(outside.focus.champion, null);
  assert.equal(at(teams, "t-a", "TOP", "t-a", "a-top").focus, null);
});

test("teamEvidence follows the edited roster and inputs are never mutated", () => {
  const teams = fixture();
  const index = R.buildRosterIndex(teams);
  const before = JSON.stringify(teams);
  let state = { "t-a": R.emptySlots(), "t-b": R.emptySlots() };
  state["t-a"].TOP = { source_team_id: "t-a", player_id: "a-top" };
  state["t-b"].MID = { source_team_id: "t-b", player_id: "b-mid" };
  const snapshot = JSON.stringify(state);
  const selections = [{ kind: "PICK", champion_id: "Ahri" }];
  const previousPicks = ["Wukong"];
  const run = () => P.teamEvidence({ teamId: "t-a", rosters: state, teams, index, basis, selections, previousPicks, focusChampionId: null });
  assert.deepEqual(run().map((row) => row.player?.player_id ?? null), ["a-top", null, null, null, null]);
  const moved = R.assignSlot(state, "t-a", "MID", { source_team_id: "t-b", player_id: "b-mid" }, index);
  state = moved.value.state;
  const rows = run();
  assert.equal(rows[2].player.player_id, "b-mid");
  assert.equal(rows[2].from_other_team, true);
  assert.equal(P.teamEvidence({ teamId: "t-b", rosters: state, teams, index, basis, selections, previousPicks }).every((row) => row.status === "EMPTY"), true);
  rows[0].champions[0].evidence_event_ids.push("tamper");
  assert.equal(JSON.stringify(teams), before);
  assert.notEqual(JSON.stringify(state), snapshot);
  assert.deepEqual(selections, [{ kind: "PICK", champion_id: "Ahri" }]);
  assert.deepEqual(previousPicks, ["Wukong"]);
});

test("every team and player in the public feed resolves safely", async () => {
  const feed = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const teams = feed.opponent_prep?.teams ?? [];
  const before = JSON.stringify(teams);
  const feedBasis = P.poolBasis(feed);
  const index = R.buildRosterIndex(teams);
  const allChamps = teams.flatMap((t) => (t.player_profiles ?? []).flatMap((p) => p.champions.map((c) => c.champion_id)));
  const previousPicks = allChamps.slice(0, 5);
  const selections = allChamps.slice(5, 9).map((champion_id, i) => ({ kind: i % 2 ? "PICK" : "BAN", champion_id }));
  let checked = 0;
  for (const t of teams) {
    const observed = R.observedRosters(teams, [t.team_id], index);
    for (const row of P.teamEvidence({ teamId: t.team_id, rosters: observed, teams, index, basis: feedBasis, selections, previousPicks, focusChampionId: "Ahri" })) {
      if (row.status !== "OBSERVED") continue;
      checked++;
      assert.equal(row.player.source_team_id, t.team_id);
      assert.equal(row.role_matches, true);
      assert.ok(row.available_count <= row.listed_count);
      assert.equal(Object.hasOwn(feedBasis, "top_champions"), false, "team ranking limit must not be presented as a player pool cap");
      if (row.list_state === "LISTED") assert.equal(row.champions.reduce((s, c) => s + c.game_count, 0), row.sample_games);
    }
    for (const player of index.players.values()) if (player.source_team_id === t.team_id) {
      const row = P.slotEvidence({ teamId: teams[0].team_id, role: "MID", assigned: { source_team_id: t.team_id, player_id: player.player_id },
        teams, index, basis: feedBasis, selections, previousPicks });
      assert.equal(row.status, "OBSERVED");
      assert.equal(row.player.key, player.key);
    }
  }
  assert.ok(checked > 0);
  assert.equal(JSON.stringify(teams), before);
});
