import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let R;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
});
after(async () => { await vite?.close(); });

const player = (player_id, player_name, role, roster_status = "CURRENT") =>
  ({ player_id, player_name, role, roster_status, game_count: 3, champions: [], evidence_match_ids: [] });
const team = (team_id, team_name, player_profiles) => ({ team_id, team_name, player_profiles });

function fixture() {
  return [
    team("t-a", "Alpha", [
      player("a-top", "Ace", "TOP"), player("a-jg", "Bolt", "JUNGLE"), player("a-mid", "Core", "MID"),
      player("a-bot", "Dash", "BOTTOM"), player("a-sup", "Echo", "SUPPORT"), player("a-old", "Fox", "MID", "OTHER_OBSERVED"),
    ]),
    // Two CURRENT junglers (ambiguous role), a name shared with Alpha but a different ID, no support.
    team("t-b", "Beta", [
      player("b-top", "Gale", "TOP"), player("b-jg1", "Hawk", "JUNGLE"), player("b-jg2", "Iris", "JUNGLE"),
      player("b-mid", "Core", "MID"), player("b-bot", "Jet", "BOTTOM"),
    ]),
    // Same (team, player) ID twice: unsafe to select; plus a player observed in two roles.
    team("t-c", "Gamma", [
      player("c-top", "Kite", "TOP"), player("c-top", "Kite", "TOP"), player("c-flex", "Lux", "MID"), player("c-flex", "Lux", "BOTTOM"),
      player("c-sup", "Moss", "SUPPORT"),
    ]),
    team("t-d", "Delta", []),
  ];
}
const report = { patch_id: "16.21", cutoff: "2026-11-01T00:00:00Z", fixture_only: false,
  evidence_index: { source_versions: [{ source_id: "s2", source_version: "2", content_hash: "h2" }, { source_id: "s1", source_version: "1", content_hash: "h1" }] } };

test("index keeps players apart by source team + player ID, never by name", () => {
  const teams = fixture();
  const before = JSON.stringify(teams);
  const index = R.buildRosterIndex(teams);
  assert.ok(index.players.has(R.playerKey("t-a", "a-mid")));
  assert.ok(index.players.has(R.playerKey("t-b", "b-mid")));
  assert.equal(index.players.get(R.playerKey("t-a", "a-mid")).player_name, index.players.get(R.playerKey("t-b", "b-mid")).player_name);
  assert.ok(index.collidingNames.has("core"));
  assert.ok(index.ambiguous.has(R.playerKey("t-c", "c-top")));
  assert.ok(!index.players.has(R.playerKey("t-c", "c-top")));
  assert.equal(JSON.stringify(teams), before, "source data is not mutated");
});

test("observed defaults fill only unique CURRENT observations and leave ambiguity empty", () => {
  const teams = fixture();
  const index = R.buildRosterIndex(teams);
  const state = R.observedRosters(teams, ["t-a", "t-b"], index);
  assert.deepEqual(state["t-a"].MID, { source_team_id: "t-a", player_id: "a-mid" }, "OTHER_OBSERVED Fox does not compete");
  assert.equal(state["t-b"].JUNGLE, null, "two CURRENT junglers stay unconfirmed");
  assert.equal(state["t-b"].SUPPORT, null, "missing evidence stays empty");
  assert.deepEqual(state["t-b"].MID, { source_team_id: "t-b", player_id: "b-mid" }, "same name, different ID is a separate player");
  const gamma = R.observedRosters(teams, ["t-c", "t-d"], index);
  assert.equal(gamma["t-c"].TOP, null, "duplicate (team, player) observation is not forced");
  assert.equal(gamma["t-c"].MID, null, "one player observed CURRENT in two roles is not forced into either");
  assert.equal(gamma["t-c"].BOTTOM, null);
  assert.deepEqual(gamma["t-c"].SUPPORT, { source_team_id: "t-c", player_id: "c-sup" });
  assert.deepEqual(gamma["t-d"], R.emptySlots());
});

test("a player CURRENT for both teams of the pair is not placed twice", () => {
  const teams = [team("x", "X", [player("p1", "Same", "TOP")]), team("y", "Y", [player("p1", "Same", "TOP")])];
  const index = R.buildRosterIndex(teams);
  const state = R.observedRosters(teams, ["x", "y"], index);
  assert.equal(state.x.TOP, null);
  assert.equal(state.y.TOP, null);
});

test("assignments mark virtual transfers and role moves, move duplicates and keep the previous state", () => {
  const teams = fixture();
  const index = R.buildRosterIndex(teams);
  const observed = R.observedRosters(teams, ["t-a", "t-b"], index);
  const snapshot = JSON.stringify(observed);
  const transfer = R.assignSlot(observed, "t-b", "SUPPORT", { source_team_id: "t-c", player_id: "c-sup" }, index);
  assert.ok(transfer.ok);
  assert.equal(JSON.stringify(observed), snapshot, "previous state preserved");
  const status = R.slotStatus("t-b", "SUPPORT", transfer.value.state["t-b"].SUPPORT, observed["t-b"].SUPPORT, index);
  assert.deepEqual([status.changed, status.otherTeam, status.roleMoved, status.virtual], [true, true, false, true]);
  const roleMove = R.assignSlot(transfer.value.state, "t-a", "TOP", { source_team_id: "t-a", player_id: "a-old" }, index);
  const roleStatus = R.slotStatus("t-a", "TOP", roleMove.value.state["t-a"].TOP, observed["t-a"].TOP, index);
  assert.deepEqual([roleStatus.otherTeam, roleStatus.roleMoved, roleStatus.notCurrent], [false, true, true]);
  const moved = R.assignSlot(roleMove.value.state, "t-b", "TOP", { source_team_id: "t-a", player_id: "a-mid" }, index);
  assert.ok(moved.ok);
  assert.deepEqual(moved.value.movedFrom, { teamId: "t-a", role: "MID" });
  assert.equal(moved.value.state["t-a"].MID, null, "moved player leaves an empty slot, never a duplicate");
  const cleared = R.assignSlot(moved.value.state, "t-a", "MID", null, index);
  assert.equal(cleared.value.state["t-a"].MID, null);
  assert.equal(R.assignSlot(observed, "t-a", "TOP", { source_team_id: "t-a", player_id: "nope" }, index).code, "UNKNOWN_PLAYER");
  assert.equal(R.assignSlot(observed, "t-a", "TOP", { source_team_id: "t-c", player_id: "c-top" }, index).code, "AMBIGUOUS_PLAYER");
  assert.equal(R.assignSlot(observed, "t-z", "TOP", null, index).code, "TEAM_MISMATCH");
  assert.equal(R.assignSlot(observed, "t-a", "ADC", null, index).code, "TEAM_MISMATCH");
});

test("roster-scenario v1 round-trips by team ID independent of side order", () => {
  const teams = fixture();
  const index = R.buildRosterIndex(teams);
  const basis = R.rosterBasis(report);
  assert.deepEqual(basis.source_versions, ["s1@1#h1", "s2@2#h2"]);
  const observed = R.observedRosters(teams, ["t-b", "t-a"], index);
  const edited = R.assignSlot(observed, "t-b", "SUPPORT", { source_team_id: "t-c", player_id: "c-sup" }, index).value.state;
  const text = R.serializeRosterScenario({ basis, team_ids: ["t-b", "t-a"], rosters: edited }, index);
  const file = JSON.parse(text);
  assert.equal(file.artifact_type, "roster-scenario");
  assert.equal(file.schema_version, 1);
  assert.deepEqual(file.team_ids, ["t-a", "t-b"]);
  assert.equal(file.rosters["t-b"].SUPPORT.player_name, "Moss");
  const parsed = R.parseRosterScenario(text, { basis, teamIds: ["t-a", "t-b"], index });
  assert.ok(parsed.ok, parsed.error);
  assert.deepEqual(parsed.value.rosters, edited);
  const swapped = R.parseRosterScenario(text, { basis, teamIds: ["t-b", "t-a"], index });
  assert.deepEqual(swapped.value.rosters, edited, "swapping sides keeps each team's lineup");
});

test("roster files with another pair, basis, version, size or invalid players are rejected", () => {
  const teams = fixture();
  const index = R.buildRosterIndex(teams);
  const basis = R.rosterBasis(report);
  const expected = { basis, teamIds: ["t-a", "t-b"], index };
  const good = JSON.parse(R.serializeRosterScenario({ basis, team_ids: ["t-a", "t-b"], rosters: R.observedRosters(teams, ["t-a", "t-b"], index) }, index));
  const code = (mutate) => { const copy = structuredClone(good); mutate(copy); return R.parseRosterScenario(JSON.stringify(copy), expected).code; };
  assert.equal(R.parseRosterScenario("{", expected).code, "INVALID_JSON");
  assert.equal(R.parseRosterScenario("x".repeat(R.MAX_ROSTER_FILE_BYTES + 1), expected).code, "TOO_LARGE");
  assert.equal(code((f) => { f.artifact_type = "public-draft-scenario"; }), "WRONG_TYPE");
  assert.equal(code((f) => { f.schema_version = 2; }), "FUTURE_VERSION");
  assert.equal(code((f) => { f.schema_version = "1"; }), "BAD_VERSION");
  assert.equal(code((f) => { f.basis.patch_id = "16.20"; }), "BASIS_MISMATCH");
  assert.equal(code((f) => { f.basis.cutoff = "2026-10-01T00:00:00Z"; }), "BASIS_MISMATCH");
  assert.equal(code((f) => { f.basis.source_versions = ["s1@1#h1"]; }), "BASIS_MISMATCH");
  assert.equal(code((f) => { f.team_ids = ["t-a", "t-c"]; }), "TEAM_MISMATCH");
  assert.equal(code((f) => { f.rosters["t-c"] = f.rosters["t-b"]; delete f.rosters["t-b"]; }), "TEAM_MISMATCH");
  assert.equal(code((f) => { f.rosters["t-a"].TOP = { source_team_id: "t-a", player_id: "ghost" }; }), "UNKNOWN_PLAYER");
  assert.equal(code((f) => { f.rosters["t-a"].TOP = { source_team_id: "t-b", player_id: "a-top" }; }), "UNKNOWN_PLAYER", "player ID under the wrong source team");
  assert.equal(code((f) => { f.rosters["t-a"].TOP = { source_team_id: "t-c", player_id: "c-top" }; }), "AMBIGUOUS_PLAYER");
  assert.equal(code((f) => { f.rosters["t-b"].SUPPORT = { source_team_id: "t-a", player_id: "a-top" }; }), "DUPLICATE_PLAYER");
  assert.equal(code((f) => { delete f.rosters["t-a"].MID; }), "BAD_SHAPE");
  assert.equal(code((f) => { f.rosters["t-a"].MID = { player_id: "a-mid" }; }), "BAD_SHAPE");
  assert.equal(code((f) => { f.rosters["t-a"].MID = "a-mid"; }), "BAD_SHAPE");
  // Names are labels only: a renamed label does not change identity or fail the file.
  const renamed = structuredClone(good);
  renamed.rosters["t-a"].MID.player_name = "Someone";
  assert.ok(R.parseRosterScenario(JSON.stringify(renamed), expected).ok);
});

test("the shipped public snapshot yields safe, duplicate-free observed defaults for every team", async () => {
  const { readFile } = await import("node:fs/promises");
  const feed = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const teams = feed.opponent_prep?.teams ?? [];
  assert.ok(teams.length > 2, "multiple teams in the snapshot");
  const before = JSON.stringify(teams);
  const index = R.buildRosterIndex(teams);
  const basis = R.rosterBasis(feed);
  for (let i = 0; i < teams.length; i += 1) {
    const pair = [teams[i].team_id, teams[(i + 1) % teams.length].team_id];
    const state = R.observedRosters(teams, pair, index);
    const ids = Object.values(state).flatMap((slots) => Object.values(slots)).filter(Boolean).map((slot) => slot.player_id);
    assert.equal(new Set(ids).size, ids.length, `no duplicate default player for ${pair}`);
    for (const [teamId, slots] of Object.entries(state)) for (const role of R.ROSTER_ROLES) {
      const slot = slots[role];
      if (!slot) continue;
      const profile = index.players.get(R.playerKey(slot.source_team_id, slot.player_id));
      assert.equal(slot.source_team_id, teamId);
      assert.equal(profile.roster_status, "CURRENT");
      assert.equal(profile.observed_role, role);
    }
    const parsed = R.parseRosterScenario(R.serializeRosterScenario({ basis, team_ids: pair, rosters: state }, index), { basis, teamIds: pair, index });
    assert.ok(parsed.ok, parsed.error);
  }
  assert.equal(JSON.stringify(teams), before, "snapshot data is not mutated");
});

test("empty slots are allowed and remain empty after a round trip", () => {
  const teams = fixture();
  const index = R.buildRosterIndex(teams);
  const basis = R.rosterBasis(report);
  const rosters = { "t-a": R.emptySlots(), "t-b": R.emptySlots() };
  const parsed = R.parseRosterScenario(R.serializeRosterScenario({ basis, team_ids: ["t-a", "t-b"], rosters }, index), { basis, teamIds: ["t-a", "t-b"], index });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.rosters, rosters);
});
