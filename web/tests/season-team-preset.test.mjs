import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
let vite, S, P, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/season-player-cards.ts"); P = await vite.ssrLoadModule("/app/season-team-preset.ts");
  catalog = S.parseSeasonCardCatalog(JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8")));
});
after(async () => { await vite?.close(); });
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
let n = 0;
const card = (role, player, games, team = "t1", extra = {}) => ({ id: (++n).toString(16).padStart(64, "0"), source_id: "oracles-elixir-match-data", player_id: `p:${player}`, player_name: player, season: 2015, team_id: team, team_names: [`Team ${team}`], role, game_count: games, champions: [], patches: ["5.1"], source_hashes: ["a".repeat(64)], ...extra });
const synthetic = cards => ({ catalog_id: "c".repeat(64), cards });
const full = (team = "t1") => ROLES.map((r, i) => card(r, `${team}-${r}`, 10 + i, team));

test("actual catalog: 2015 SK Telecom T1 most-played lineup with exact refs", () => {
  const teams = P.observedSeasonTeams(catalog, 2015);
  const skt = teams.filter(t => t.team_names.includes("SK Telecom T1"));
  assert.equal(skt.length, 1);
  const [t] = skt;
  assert.equal(t.status, "READY");
  const got = Object.fromEntries(ROLES.map(r => [r, [t.picks[r].player_name, t.picks[r].game_count]]));
  assert.deepEqual(got, { TOP: ["MaRin", 114], JUNGLE: ["Bengi", 97], MID: ["Faker", 77], BOTTOM: ["Bang", 114], SUPPORT: ["Wolf", 102] });
  const result = P.seasonPresetSlots(t, catalog);
  assert.equal(result.ok, true);
  for (const r of ROLES) {
    const c = catalog.cards.find(x => x.id === result.slots[r].card_id);
    assert.deepEqual(result.slots[r], { catalog_id: catalog.catalog_id, card_id: c.id, player_id: c.player_id });
    assert.equal(c.role, r); assert.equal(c.team_id, t.team_id); assert.equal(c.season, 2015);
    assert.doesNotThrow(() => S.resolveSeasonRef(result.slots[r], r, catalog));
  }
});

test("team list order does not depend on card order; teams are not merged by name", () => {
  const a = full("t1"), b = full("t2").map(c => ({ ...c, team_names: ["Team t1"] }));
  const forward = P.observedSeasonTeams(synthetic([...a, ...b]), 2015).map(t => t.key);
  const reversed = P.observedSeasonTeams(synthetic([...a, ...b].reverse()), 2015).map(t => t.key);
  assert.deepEqual(forward, reversed);
  assert.equal(forward.length, 2);
  const real = P.observedSeasonTeams(catalog, 2015).map(t => t.key);
  assert.deepEqual(P.observedSeasonTeams({ ...catalog, cards: [...catalog.cards].reverse() }, 2015).map(t => t.key), real);
});

test("tied most-played role is rejected, not guessed", () => {
  const cards = [...full(), card("MID", "other-mid", 12)];
  const [t] = P.observedSeasonTeams(synthetic(cards), 2015);
  assert.equal(t.status, "TIED"); assert.deepEqual(t.tiedRoles, ["MID"]); assert.equal(t.picks.MID, null);
  assert.match(P.presetBlockReason(t), /직접/);
  assert.equal(P.seasonPresetSlots(t, synthetic(cards)).ok, false);
});

test("empty role is listed but rejected", () => {
  const cards = full().filter(c => c.role !== "SUPPORT");
  const [t] = P.observedSeasonTeams(synthetic(cards), 2015);
  assert.equal(t.status, "INCOMPLETE"); assert.deepEqual(t.emptyRoles, ["SUPPORT"]);
  assert.equal(P.seasonPresetSlots(t, synthetic(cards)).ok, false);
});

test("same player as most-played in two roles is rejected", () => {
  const cards = full(); cards.push(card("BOTTOM", "t1-TOP", 99));
  const [t] = P.observedSeasonTeams(synthetic(cards), 2015);
  assert.equal(t.status, "DUPLICATE_PLAYER");
  assert.equal(P.seasonPresetSlots(t, synthetic(cards)).ok, false);
});

test("mixed team/season/source in picks is rejected at slot building", () => {
  const cards = full(), cat = synthetic(cards);
  const [t] = P.observedSeasonTeams(cat, 2015);
  const foreign = card("TOP", "x", 50, "t9"); cat.cards.push(foreign);
  assert.equal(P.seasonPresetSlots({ ...t, picks: { ...t.picks, TOP: foreign } }, cat).ok, false);
  const otherYear = { ...cards[0], season: 2022 };
  assert.equal(P.seasonPresetSlots(t, synthetic([otherYear, ...cards.slice(1)])).ok, false);
});

test("inputs are not mutated", () => {
  const cards = [...full(), card("MID", "other-mid", 12)], cat = synthetic(cards), before = structuredClone(cat);
  const real = structuredClone(catalog);
  for (const t of P.observedSeasonTeams(cat, 2015)) P.seasonPresetSlots(t, cat);
  for (const t of P.observedSeasonTeams(catalog, 2015)) P.seasonPresetSlots(t, catalog);
  assert.deepEqual(cat, before); assert.deepEqual(catalog, real);
});
