import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, build, reconcile, move, empty, key;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ buildDraftPositionBoard: build, reconcileChampionRoles: reconcile, moveChampionRole: move } = await vite.ssrLoadModule("/app/draft-position-board.ts"));
  ({ emptyChampionRoles: empty, championKey: key } = await vite.ssrLoadModule("/app/champion-roles.ts"));
});
after(async () => { await vite?.close(); });
const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const ids = ["Gnar", "Vi", "Ahri", "Kai'Sa", "Nautilus"];
const pick = (champion_id, side = "BLUE", slot = 1, kind = "PICK") => ({ champion_id, side, slot, kind, turn: slot, phase: 1 });
const row = (champion_id, role, game_count = 1) => ({ champion_id, role, game_count });
const team = (priority_picks = [], player_profiles = []) => ({ priority_picks, player_profiles });
const board = (selections, evidence = null, assignments = empty(), side = "BLUE") => build({ selections, team: evidence, assignments, side });
function unique(result, expected) {
  const actual = [...result.positions.filter(p => p.selection).map(p => p.selection), ...result.unassigned.map(p => p.selection)].map(s => key(s.champion_id));
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(actual.sort(), [...new Set(expected.map(key))].sort());
}

test("both sides and selection/evidence permutations produce unique suggestions", () => {
  for (const side of ["BLUE", "RED"]) {
    const selections = ids.map((id, i) => pick(id, side, i + 1));
    const evidence = team(ids.map((id, i) => row(id, roles[i] === "BOTTOM" ? "ADC" : roles[i])));
    for (const ordered of [selections, [...selections].reverse(), [selections[2], selections[4], selections[0], selections[3], selections[1]]]) {
      const result = board(ordered, evidence, empty(), side);
      assert.deepEqual(result.positions.map(p => p.champion_id), ["Gnar", "Vi", "Ahri", "Kaisa", "Nautilus"]);
      assert.ok(result.positions.every(p => p.source === "SUGGESTED"));
      assert.equal(result.canConfirm, true);
      unique(result, ids);
    }
    assert.deepEqual(board(selections, evidence, empty(), side), board([...selections].reverse(), team([...evidence.priority_picks].reverse()), empty(), side));
  }
});

test("only confirmed own picks occupy positions; no staged, banned, or opponent refs", () => {
  const selections = [pick("Ahri"), pick("Vi", "BLUE", 2, "BAN"), pick("Gnar", "RED")];
  const assignments = { ...empty(), TOP: "Gnar", MID: "Ahri", JUNGLE: "Vi", BOTTOM: "Staged" };
  const result = board(selections, team([row("Vi", "JUNGLE"), row("Gnar", "TOP"), row("Staged", "BOTTOM")]), assignments);
  assert.deepEqual(result.positions.map(p => p.champion_id), [null, null, "Ahri", null, null]);
  assert.equal(result.positions[2].source, "ASSIGNED");
  assert.equal(result.canConfirm, false);
  unique(result, ["Ahri"]);
});

test("union of positive team hints preserves flex and conflicts without guessing", () => {
  const selections = ["Ahri", "Akali", "Vi", "Unknown", "Gnar"].map((id, i) => pick(id, "BLUE", i));
  const evidence = team([row("Ahri", "MID"), row("Akali", "MID"), row("Vi", "JUNGLE", 0), row("Gnar", "TOP"), row("Unknown", "UNKNOWN")],
    [{ role: "TOP", champions: [row("Ahri", undefined)] }, { role: "MID", champions: [row("Ahri", undefined), row("Vi", undefined, -1)] }]);
  const result = board(selections, evidence);
  assert.ok(result.positions.every(p => p.source === "EMPTY"));
  assert.deepEqual(result.unassigned.find(p => p.selection.champion_id === "Ahri").observed_roles, ["TOP", "MID"]);
  assert.deepEqual(result.unassigned.find(p => p.selection.champion_id === "Vi").observed_roles, []);
  unique(result, selections.map(s => s.champion_id));
  assert.equal(board(selections).positions.every(p => p.source === "EMPTY"), true);
});

test("explicit position wins and releases contenders; flex never collapses to free role", () => {
  const selections = [pick("Ahri"), pick("Akali", "BLUE", 2)];
  const evidence = team([row("Ahri", "MID"), row("Ahri", "TOP"), row("Akali", "MID")]);
  const result = board(selections, evidence, { ...empty(), SUPPORT: "Ahri" });
  assert.equal(result.positions[4].source, "ASSIGNED");
  assert.equal(result.positions[2].champion_id, "Akali");
  assert.deepEqual(result.positions[4].observed_roles, ["TOP", "MID"]);
  const flex = board(selections, evidence, { ...empty(), MID: "Akali" });
  assert.equal(flex.positions[0].champion_id, null);
  assert.equal(flex.unassigned[0].selection.champion_id, "Ahri");
});

test("reconciliation canonicalizes aliases, prunes lost picks, and never mutates", () => {
  const current = Object.freeze({ ...empty(), TOP: "Wukong", MID: "MonkeyKing", BOTTOM: "Kai'Sa", SUPPORT: "Lost" });
  const picks = Object.freeze(["MonkeyKing", "Kaisa", "Kai'Sa"]);
  assert.deepEqual(reconcile(current, picks), { ...empty(), TOP: "MonkeyKing", BOTTOM: "Kaisa" });
  assert.deepEqual(reconcile(current, []), empty());
  assert.equal(current.MID, "MonkeyKing");
});

test("moves swap assigned occupants, displace from unassigned, and null unassigns", () => {
  const current = Object.freeze({ ...empty(), TOP: "Gnar", MID: "Ahri" });
  const picks = ["Gnar", "Ahri", "Vi"];
  assert.deepEqual(move(current, "Gnar", "MID", picks), { ...empty(), TOP: "Ahri", MID: "Gnar" });
  assert.deepEqual(move(current, "Vi", "MID", picks), { ...empty(), TOP: "Gnar", MID: "Vi" });
  assert.deepEqual(move(current, "Ahri", null, picks), { ...empty(), TOP: "Gnar" });
  assert.deepEqual(move(current, "Ahri", "MID", picks), current);
  for (const [id, role] of [["Banned", "TOP"], ["Ahri", "INVALID"], [null, "TOP"]]) assert.deepEqual(move(current, id, role, picks), current);
  assert.equal(current.MID, "Ahri");
  assert.deepEqual(move({ ...empty(), TOP: "MonkeyKing", MID: "Ahri" }, "Wukong", "MID", ["MonkeyKing", "Ahri"]), { ...empty(), TOP: "Ahri", MID: "MonkeyKing" });
});

test("duplicate selection aliases occur once and all source data stays unchanged", () => {
  const input = { selections: [pick("Kai'Sa"), pick("Kaisa", "BLUE", 2)], team: team([row("Kaisa", "ADC")]), assignments: { ...empty(), BOTTOM: "Kai'Sa", TOP: "Kaisa" }, side: "BLUE" };
  const before = structuredClone(input);
  const result = build(input);
  unique(result, ["Kaisa"]);
  assert.equal(result.positions[0].source, "ASSIGNED");
  assert.equal(result.positions[3].source, "EMPTY");
  assert.equal(result.canConfirm, false);
  assert.deepEqual(input, before);
});


test("explicitly cleared picks remain unassigned despite an unambiguous observation", () => {
  const result = build({ selections: [pick("Ahri")], team: team([row("Ahri", "MID")]), assignments: empty(), side: "BLUE", unassigned: ["ahri"] });
  assert.equal(result.positions.find(p => p.role === "MID").champion_id, null);
  assert.equal(result.unassigned[0].selection.champion_id, "Ahri");
  const placed = build({ selections: [pick("Ahri")], team: team([row("Ahri", "MID")]), assignments: { ...empty(), TOP: "Ahri" }, side: "BLUE", unassigned: ["ahri"] });
  assert.equal(placed.positions[0].source, "ASSIGNED");
});
