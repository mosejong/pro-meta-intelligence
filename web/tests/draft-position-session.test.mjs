import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, agent, session, positions, report, blue, red, ids;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  session = await vite.ssrLoadModule("/app/draft-session.ts");
  positions = await vite.ssrLoadModule("/app/draft-position-session.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  [blue, red] = report.opponent_prep.teams;
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
});
after(async () => { await vite?.close(); });

const empty = () => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
function draft(count = 20, first = "BLUE", locks = []) {
  let result = [];
  for (const id of ids.filter(id => !locks.includes(id)).slice(0, count)) result = agent.applyDraftSelection(result, id, locks, first);
  assert.equal(result.length, count);
  return result;
}
const picksOf = (selections, side) => selections.filter(s => s.kind === "PICK" && s.side === side).map(s => s.champion_id);
const save = (selections, record, games = [], first = "BLUE") => agent.serializeDraftScenario(report, blue, red, selections, games, null, first, record);
const parse = text => session.parseDraftSession(text);
const mutate = (text, fn) => { const value = JSON.parse(text); fn(value); return JSON.stringify(value); };

test("no explicit work keeps the exact v3 output for existing callers", () => {
  const selections = draft(20);
  const legacy = agent.serializeDraftScenario(report, blue, red, selections, [], null, "BLUE");
  assert.equal(JSON.parse(legacy).schema_version, "3");
  assert.equal(save(selections, null), legacy);
  assert.equal(save(selections, {}), legacy);
  const restored = parse(legacy);
  assert.equal(restored.ok, true);
  assert.equal(Object.hasOwn(restored.session, "positions"), false);
  assert.equal(JSON.stringify(legacy).includes("current_game_positions"), false);
});

test("partial explicit roles and explicit unassigned survive a v4 round trip; suggestions are not stored", () => {
  for (const first of ["BLUE", "RED"]) {
    const selections = draft(20, first);
    const [b1, b2, b3] = picksOf(selections, "BLUE");
    const [r1] = picksOf(selections, "RED");
    const roles = { [blue.team_id]: { ...empty(), TOP: b1, MID: b2.toUpperCase() }, [red.team_id]: { ...empty(), SUPPORT: r1 } };
    const record = positions.normalizeDraftPositions(roles, { [blue.team_id]: [b3] }, { blueTeamId: blue.team_id, redTeamId: red.team_id, selections });
    // ID alias normalized back to the team's own pick ID.
    assert.equal(record[blue.team_id].roles.MID, b2);
    assert.deepEqual(record[blue.team_id].unassigned, [b3]);
    const text = save(selections, record, [], first);
    assert.equal(JSON.parse(text).schema_version, "4");
    const restored = parse(text);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.session.positions, record);
    assert.equal(restored.session.firstPickSide, first);
    // Unassigned roles stay null: nothing is auto-confirmed on restore.
    assert.equal(restored.session.positions[blue.team_id].roles.JUNGLE, null);
    assert.deepEqual(restored.session.positions[red.team_id].unassigned, []);
    // Re-saving the restored record is idempotent.
    assert.equal(save(restored.session.selections, restored.session.positions, [], first), text);
  }
});

test("normalize drops other teams, opponent picks, bans, duplicates and stale picks; empty → null", () => {
  const selections = draft(10);
  const bluePicks = picksOf(selections, "BLUE");
  const redPicks = picksOf(selections, "RED");
  const ban = selections.find(s => s.kind === "BAN").champion_id;
  const matchup = { blueTeamId: blue.team_id, redTeamId: red.team_id, selections };
  const record = positions.normalizeDraftPositions({
    [blue.team_id]: { ...empty(), TOP: bluePicks[0], JUNGLE: bluePicks[0], MID: redPicks[0], BOTTOM: ban, SUPPORT: "Nonexistent" },
    other: { ...empty(), TOP: bluePicks[1] },
  }, { [blue.team_id]: [bluePicks[0], redPicks[0]], other: [bluePicks[1]] }, matchup);
  assert.deepEqual(record, { [blue.team_id]: { roles: { ...empty(), TOP: bluePicks[0] }, unassigned: [] } });
  assert.equal(positions.normalizeDraftPositions({}, {}, matchup), null);
  assert.equal(positions.normalizeDraftPositions({ [blue.team_id]: { ...empty(), TOP: ban } }, {}, matchup), null);
});

test("damaged, foreign-team or mismatched position records reject the whole file", () => {
  const selections = draft(20);
  const [b1, b2] = picksOf(selections, "BLUE");
  const [r1] = picksOf(selections, "RED");
  const good = save(selections, { [blue.team_id]: { roles: { ...empty(), TOP: b1 }, unassigned: [b2] } });
  assert.equal(parse(good).ok, true);
  const bad = {
    otherTeam: v => { v.current_game_positions.someone = { roles: empty(), unassigned: [] }; },
    opponentPick: v => { v.current_game_positions[blue.team_id].roles.MID = r1; },
    unknownRole: v => { v.current_game_positions[blue.team_id].roles.ADC = null; },
    missingRole: v => { delete v.current_game_positions[blue.team_id].roles.SUPPORT; },
    duplicateRole: v => { v.current_game_positions[blue.team_id].roles.MID = b1; },
    assignedAndUnassigned: v => { v.current_game_positions[blue.team_id].unassigned.push(b1); },
    duplicateUnassigned: v => { v.current_game_positions[blue.team_id].unassigned.push(b2); },
    unassignedNotList: v => { v.current_game_positions[blue.team_id].unassigned = b2; },
    longUnassigned: v => { v.current_game_positions[blue.team_id].unassigned = [1, 2, 3, 4, 5, 6]; },
    nonStringRole: v => { v.current_game_positions[blue.team_id].roles.MID = 7; },
    extraKey: v => { v.current_game_positions[blue.team_id].note = "x"; },
    teamNotObject: v => { v.current_game_positions[blue.team_id] = [b1]; },
    missingRecord: v => { delete v.current_game_positions; },
    nullRecord: v => { v.current_game_positions = null; },
    positionsInV3: v => { v.schema_version = "3"; },
    unknownVersion: v => { v.schema_version = "5"; },
  };
  for (const [name, fn] of Object.entries(bad)) {
    const result = parse(mutate(good, fn));
    assert.equal(result.ok, false, name);
  }
  // Swapping sides makes the stored blue picks the other team's champions → rejected.
  assert.equal(parse(mutate(good, v => { [v.blue_team, v.red_team] = [v.red_team, v.blue_team]; })).ok, false);
});

test("'__proto__' team IDs stay own properties and never mutate prototypes in parse or normalize", () => {
  const selections = [{ champion_id: "Ahri", side: "BLUE", kind: "PICK", slot: 1, turn: 7, phase: 1 }, { champion_id: "Vi", side: "RED", kind: "PICK", slot: 1, turn: 8, phase: 1 }];
  const matchup = { blueTeamId: "__proto__", redTeamId: "red", selections };
  const team = { roles: { ...empty(), TOP: "Ahri" }, unassigned: [] };
  const check = (result) => {
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.deepEqual(Object.keys(result), ["__proto__"]);
    assert.equal(Object.hasOwn(result, "__proto__"), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, "__proto__").value, team);
    assert.equal(Object.prototype.roles, undefined);
    assert.equal({}.roles, undefined);
    // Serialized form keeps the role (no silent loss) and parses back identically.
    const again = positions.parseDraftPositions(JSON.parse(JSON.stringify(result)), matchup);
    assert.deepEqual(Object.keys(again), ["__proto__"]);
    assert.equal(Object.getOwnPropertyDescriptor(again, "__proto__").value.roles.TOP, "Ahri");
  };
  check(positions.parseDraftPositions(Object.fromEntries([["__proto__", team]]), matchup));
  check(positions.normalizeDraftPositions(Object.fromEntries([["__proto__", team.roles]]), {}, matchup));
  // An ordinary object without an own "__proto__" key supplies nothing via its prototype.
  assert.deepEqual(positions.parseDraftPositions({}, matchup), {});
  assert.equal(positions.normalizeDraftPositions({}, {}, matchup), null);
  // Non-matchup own "__proto__" key is a foreign team → whole record rejected.
  assert.equal(positions.parseDraftPositions(Object.fromEntries([["__proto__", team]]), { ...matchup, blueTeamId: "blue" }), null);
});

test("inherited role/unassigned/team dictionaries never provide assignments", () => {
  const selections = [{ champion_id: "Ahri", side: "BLUE", kind: "PICK", slot: 1, turn: 7, phase: 1 }, { champion_id: "Vi", side: "BLUE", kind: "PICK", slot: 2, turn: 10, phase: 1 }];
  const matchup = { blueTeamId: "blue", redTeamId: "red", selections };
  const inheritedRoles = Object.create({ TOP: "Ahri", MID: "Vi" });
  const inheritedTeams = Object.create({ blue: { ...empty(), TOP: "Ahri" } });
  const inheritedUnassigned = Object.create({ blue: ["Vi"] });
  assert.equal(positions.normalizeDraftPositions({ blue: inheritedRoles }, {}, matchup), null);
  assert.equal(positions.normalizeDraftPositions(inheritedTeams, inheritedUnassigned, matchup), null);
  // Own and inherited mixed: only the own value counts.
  const mixed = Object.assign(Object.create({ MID: "Vi" }), { TOP: "Ahri" });
  assert.deepEqual(positions.normalizeDraftPositions({ blue: mixed }, {}, matchup), { blue: { roles: { ...empty(), TOP: "Ahri" }, unassigned: [] } });
  // Parse: inherited roles fail the exact own-key shape instead of being read.
  const protoRoles = Object.assign(Object.create({ TOP: "Ahri" }), { JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
  assert.equal(positions.parseDraftPositions({ blue: { roles: protoRoles, unassigned: [] } }, matchup), null);
  assert.equal(positions.parseDraftPositions({ blue: Object.assign(Object.create({ unassigned: [] }), { roles: empty() }) }, matchup), null);
  const fromProto = positions.parseDraftPositions(Object.create({ blue: { roles: { ...empty(), TOP: "Ahri" }, unassigned: [] } }), matchup);
  assert.deepEqual(Object.keys(fromProto), []);
  assert.equal(Object.hasOwn(fromProto, "blue"), false);
});

test("old v2/v3 files load without roles; v4 keeps earlier sets, Fearless and first pick intact", () => {
  const first = draft(20);
  const games = agent.completeFearlessGame([], { blue_team_id: blue.team_id, red_team_id: red.team_id, selections: first });
  const locks = agent.fearlessLocks(games);
  const current = draft(12, "RED", locks);
  const v3 = agent.serializeDraftScenario(report, blue, red, current, games, null, "RED");
  const v2 = mutate(agent.serializeDraftScenario(report, blue, red, draft(4), [], null, "BLUE"), v => { v.schema_version = "2"; delete v.first_pick_side; });
  for (const text of [v2, v3]) {
    const result = parse(text);
    assert.equal(result.ok, true);
    assert.equal(result.session.positions, undefined);
  }
  const redPick = picksOf(current, "RED")[0];
  const v4 = save(current, { [red.team_id]: { roles: { ...empty(), JUNGLE: redPick }, unassigned: [] } }, games, "RED");
  const result = parse(v4);
  assert.equal(result.ok, true);
  assert.deepEqual(result.session.games, games);
  assert.deepEqual(result.session.selections, current);
  assert.equal(result.session.firstPickSide, "RED");
  assert.deepEqual(JSON.parse(v4).previous_games, JSON.parse(v3).previous_games);
  assert.deepEqual(JSON.parse(v4).fearless_locks, JSON.parse(v3).fearless_locks);
  assert.equal(result.session.positions[red.team_id].roles.JUNGLE, redPick);
  // A previous-set pick cannot be used as a current-set role.
  const prior = picksOf(first, "RED")[0];
  assert.equal(parse(mutate(v4, v => { v.current_game_positions[red.team_id].roles.TOP = prior; })).ok, false);
});
