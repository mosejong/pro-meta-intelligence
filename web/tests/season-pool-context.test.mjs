import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, X;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  X = await vite.ssrLoadModule("/app/season-pool-context.ts");
});
after(async () => { await vite?.close(); });

const card = () => ({ champions: [
  { champion_id: "Gnar", games: 3 }, { champion_id: "Jayce", games: 5 }, { champion_id: "Camille", games: 3 },
  { champion_id: "Ornn", games: 4 }, { champion_id: "Kennen", games: 1 }, { champion_id: "Renekton", games: 2 },
  { champion_id: "Aatrox", games: 3 },
] });
const ids = rows => rows.map(r => r.champion_id);

test("top 5 sorted by games desc, champion ID ascending on ties", () => {
  const r = X.seasonPoolContext(card(), [], []);
  assert.deepEqual(ids(r.top), ["Jayce", "Ornn", "Aatrox", "Camille", "Gnar"]);
  assert.ok(r.top.every(x => x.state === "AVAILABLE"));
  assert.deepEqual(ids(r.remaining), ["Jayce", "Ornn", "Aatrox"]);
  assert.equal(r.focus, null);
  // Order of input does not change the result.
  const reversed = { champions: [...card().champions].reverse() };
  assert.deepEqual(X.seasonPoolContext(reversed, [], []), r);
});

test("ban / pick / fearless states, and remaining refills past top 5", () => {
  const r = X.seasonPoolContext(card(), [{ kind: "BAN", champion_id: "Jayce" }, { kind: "PICK", champion_id: "ornn" }], ["Aatrox", "Camille"]);
  const state = Object.fromEntries(r.top.map(x => [x.champion_id, x.state]));
  assert.deepEqual(state, { Jayce: "BANNED_NOW", Ornn: "PICKED_NOW", Aatrox: "FEARLESS_LOCKED", Camille: "FEARLESS_LOCKED", Gnar: "AVAILABLE" });
  assert.deepEqual(ids(r.remaining), ["Gnar", "Renekton", "Kennen"]);
});

test("previous-game bans are not passed in previousPicks and therefore never lock", () => {
  const r = X.seasonPoolContext(card(), [], []);
  assert.equal(r.top.find(x => x.champion_id === "Jayce").state, "AVAILABLE");
});

test("remaining is empty when every observed champion is used", () => {
  const c = { champions: [{ champion_id: "Jayce", games: 2 }, { champion_id: "Gnar", games: 1 }] };
  const r = X.seasonPoolContext(c, [{ kind: "BAN", champion_id: "Jayce" }], ["Gnar"]);
  assert.deepEqual(r.remaining, []);
  assert.equal(r.top.length, 2);
});

test("aliases normalize to one key and keep the largest row without summing", () => {
  const c = { champions: [{ champion_id: "Wukong", games: 2 }, { champion_id: "MonkeyKing", games: 4 }, { champion_id: "Kai'Sa", games: 3 }, { champion_id: "Kaisa", games: 3 }] };
  const r = X.seasonPoolContext(c, [{ kind: "PICK", champion_id: "MonkeyKing" }], []);
  assert.deepEqual(r.top.map(x => [x.champion_id, x.games, x.state]), [["MonkeyKing", 4, "PICKED_NOW"], ["Kai'Sa", 3, "AVAILABLE"]]);
  const f = X.seasonPoolContext(c, [], [], "Wukong");
  assert.deepEqual(f.focus, { champion_id: "Wukong", status: "OBSERVED", row: { champion_id: "MonkeyKing", games: 4, state: "AVAILABLE" } });
});

test("no focus (null) is distinct from a focus champion that was not observed", () => {
  assert.equal(X.seasonPoolContext(card(), [], [], null).focus, null);
  assert.equal(X.seasonPoolContext(card(), [], [], "").focus, null);
  const r = X.seasonPoolContext(card(), [], [], "Azir");
  assert.deepEqual(r.focus, { champion_id: "Azir", status: "NOT_OBSERVED", row: null });
  const o = X.seasonPoolContext(card(), [], ["Kennen"], "kennen");
  assert.deepEqual(o.focus, { champion_id: "kennen", status: "OBSERVED", row: { champion_id: "Kennen", games: 1, state: "FEARLESS_LOCKED" } });
});

test("inputs are not mutated and returned rows are fresh", () => {
  const c = card(), sel = [{ kind: "BAN", champion_id: "Jayce" }], prev = ["Ornn"];
  const snapshot = structuredClone([c, sel, prev]);
  const r = X.seasonPoolContext(c, sel, prev, "Gnar");
  assert.deepEqual([c, sel, prev], snapshot);
  r.top[0].games = 99; r.remaining.length = 0;
  assert.notEqual(r.focus.row, r.top.find(x => x.champion_id === "Gnar"));
  assert.deepEqual(X.seasonPoolContext(c, sel, prev, "Gnar").top[0].games, 5);
  assert.deepEqual(c, snapshot[0]);
});

test("labels never describe AVAILABLE as a recommendation", () => {
  assert.equal(X.seasonPoolStateLabel.AVAILABLE, "이번 밴픽 미사용");
  assert.deepEqual(Object.keys(X.seasonPoolStateLabel).sort(), ["AVAILABLE", "BANNED_NOW", "FEARLESS_LOCKED", "PICKED_NOW"]);
});
