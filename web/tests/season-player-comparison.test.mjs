import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite, S, X, P, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/season-player-cards.ts");
  X = await vite.ssrLoadModule("/app/season-player-comparison.ts");
  P = await vite.ssrLoadModule("/app/season-player-comparison-panel.tsx");
  catalog = S.parseSeasonCardCatalog(JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8")));
});
after(async () => { await vite?.close(); });

let n = 0;
const card = (player, season, champions, extra = {}) => ({
  id: (++n).toString(16).padStart(64, "0"), source_id: "oracles-elixir-match-data", player_id: `p:${player}`, player_name: player, season,
  team_id: `t:${player}`, team_names: [`Team ${player}`], role: "TOP", game_count: champions.reduce((s, c) => s + c.games, 0),
  champions, patches: [`${season - 2010}.1`], source_hashes: ["a".repeat(64)], ...extra,
});
const ch = (champion_id, games) => ({ champion_id, games });
const blue = () => card("A", 2015, [ch("Maokai", 9), ch("Gnar", 7), ch("Rumble", 5), ch("Jayce", 4), ch("Irelia", 3), ch("Ryze", 2), ch("Shen", 1), ch("Kennen", 1)]);
const red = () => card("B", 2022, [ch("Gnar", 2), ch("Jayce", 8), ch("Camille", 6), ch("Gwen", 5), ch("Kennen", 1), ch("Ornn", 4), ch("Aatrox", 3), ch("Irelia", 1), ch("Shen", 1)]);
const ids = rows => rows.map(r => r.champion_id);

test("common champions: full count, ID ascending, max 5, games kept per side (not summed or ranked)", () => {
  const r = X.compareSeasonCards(blue(), red(), [], []);
  assert.equal(r.ok, true);
  assert.equal(r.role, "TOP");
  assert.equal(r.common_count, 5);
  assert.deepEqual(r.common.map(c => [c.key, c.blue_games, c.red_games]), [["gnar", 7, 2], ["irelia", 3, 1], ["jayce", 4, 8], ["kennen", 1, 1], ["shen", 1, 1]]);
  for (const c of r.common) assert.equal("games" in c, false);
  const more = card("C", 2022, [...red().champions, ch("Maokai", 1)]);
  const m = X.compareSeasonCards(blue(), more, [], []);
  assert.equal(m.common_count, 6); assert.equal(m.common.length, 5);
  assert.deepEqual(m.common.map(c => c.key), ["gnar", "irelia", "jayce", "kennen", "maokai"]);
});

test("top 3 per card and only-observed (max 3, games desc / ID asc) without 0 for the other side", () => {
  const r = X.compareSeasonCards(blue(), red(), [], []);
  assert.deepEqual(ids(r.blue.top), ["Maokai", "Gnar", "Rumble"]);
  assert.deepEqual(ids(r.red.top), ["Jayce", "Camille", "Gwen"]);
  assert.deepEqual(ids(r.blue.only), ["Maokai", "Rumble", "Ryze"]); assert.equal(r.blue.only_count, 3);
  assert.deepEqual(ids(r.red.only), ["Camille", "Gwen", "Ornn"]); assert.equal(r.red.only_count, 4);
  for (const row of [...r.blue.only, ...r.red.only, ...r.blue.top, ...r.red.top]) assert.ok(row.games >= 1);
  const same = card("D", 2022, [ch("Gnar", 2), ch("Jayce", 1)], { champions: [ch("Jayce", 1), ch("Gnar", 2)] });
  assert.deepEqual(X.compareSeasonCards(blue(), same, [], []).red.only, []);
});

test("aliases collapse to the largest single row per card, never summed", () => {
  const b = card("A", 2015, [ch("Wukong", 2), ch("MonkeyKing", 4)]);
  const r = card("B", 2022, [ch("MonkeyKing", 1), ch("Wukong", 3)]);
  const out = X.compareSeasonCards(b, r, [], []);
  assert.equal(out.common_count, 1);
  assert.deepEqual(out.common[0], { key: "monkeyking", blue_champion_id: "MonkeyKing", red_champion_id: "Wukong", blue_games: 4, red_games: 3, state: "AVAILABLE" });
  assert.deepEqual(out.blue.top.map(x => x.games), [4]);
});

test("ban / pick / fearless lock / unused states use the live draft", () => {
  const r = X.compareSeasonCards(blue(), red(), [{ kind: "BAN", champion_id: "Maokai" }, { kind: "PICK", champion_id: "jayce" }], ["Camille"]);
  const states = Object.fromEntries([...r.blue.top, ...r.red.top].map(x => [x.champion_id, x.state]));
  assert.equal(states.Maokai, "BANNED_NOW"); assert.equal(states.Jayce, "PICKED_NOW"); assert.equal(states.Camille, "FEARLESS_LOCKED"); assert.equal(states.Gnar, "AVAILABLE");
  assert.equal(r.common.find(c => c.key === "jayce").state, "PICKED_NOW");
});

test("rejects different roles, the same player in another season, and invalid counts", () => {
  assert.deepEqual(X.compareSeasonCards(blue(), { ...red(), role: "MID" }, [], []), { ok: false, reason: "ROLE_MISMATCH" });
  assert.deepEqual(X.compareSeasonCards(blue(), { ...red(), player_id: "p:A" }, [], []), { ok: false, reason: "SAME_PLAYER" });
  const b = blue();
  for (const bad of [{ ...b, game_count: 0 }, { ...b, champions: [ch("Gnar", 0)] }, { ...b, champions: [ch("Gnar", 1.5)] }, { ...b, game_count: 3, champions: [ch("Gnar", 4)] }])
    assert.deepEqual(X.compareSeasonCards(bad, red(), [], []), { ok: false, reason: "INVALID_CARD" });
});

test("inputs are not mutated and outputs are fresh", () => {
  const b = blue(), r = red(), sel = [{ kind: "BAN", champion_id: "Gnar" }], prev = ["Ornn"];
  const snap = structuredClone([b, r, sel, prev]);
  const out = X.compareSeasonCards(b, r, sel, prev);
  assert.deepEqual([b, r, sel, prev], snap);
  out.blue.patches.push("x"); out.blue.team_names.length = 0; out.blue.top[0].games = 99;
  assert.deepEqual([b, r], snap.slice(0, 2));
  assert.deepEqual(X.compareSeasonCards(b, r, sel, prev).blue.top[0].games, 9);
});

const pick = (name, season) => catalog.cards.filter(c => c.player_name === name && c.season === season && c.role === "TOP").sort((a, b) => b.game_count - a.game_count)[0];
const ref = c => ({ catalog_id: catalog.catalog_id, card_id: c.id, player_id: c.player_id });
const teams = [{ id: "blue", name: "블루 관측팀", side: "BLUE" }, { id: "red", name: "레드 관측팀", side: "RED" }];
const empty = () => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
const render = (props) => renderToStaticMarkup(createElement(P.SeasonPlayerComparisonPanel, { catalog, teams, selections: [], previousPicks: [], nameOf: id => `N:${id}`, ...props }));

test("actual catalog: 2015 MaRin vs 2022 Nuguri, both TOP with different stable IDs", () => {
  const marin = pick("MaRin", 2015), nuguri = pick("Nuguri", 2022);
  assert.ok(marin && nuguri);
  assert.notEqual(marin.player_id, nuguri.player_id);
  const snap = structuredClone(catalog);
  const r = X.compareSeasonCards(marin, nuguri, [], []);
  assert.equal(r.ok, true); assert.equal(r.role, "TOP");
  assert.equal(r.blue.season, 2015); assert.equal(r.red.season, 2022);
  assert.equal(r.blue.game_count, marin.game_count); assert.deepEqual(r.red.patches, nuguri.patches);
  assert.equal(r.blue.source_id, "oracles-elixir-match-data");
  const html = render({ lineups: { blue: { ...empty(), TOP: ref(marin) }, red: { ...empty(), TOP: ref(nuguri) } } });
  assert.match(html, /시즌 선수 관측 비교/); assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /MaRin/); assert.match(html, /Nuguri/); assert.match(html, /블루 관측팀/);
  assert.match(html, /Oracle’s Elixir/); assert.doesNotMatch(html, /oracles-elixir-match-data|챔피언 ID순/);
  assert.match(html, new RegExp(catalog.cutoff.slice(0, 10)));
  assert.match(html, /리워크/);
  assert.deepEqual(catalog, snap);
});

test("panel: hidden without catalog or refs; guidance for one side; unresolved role does not erase others", () => {
  const marin = pick("MaRin", 2015), nuguri = pick("Nuguri", 2022);
  assert.equal(render({ catalog: null, lineups: { blue: { ...empty(), TOP: ref(marin) } } }), "");
  assert.equal(render({ lineups: { blue: empty(), red: empty() } }), "");
  const one = render({ lineups: { blue: { ...empty(), TOP: ref(marin) }, red: empty() } });
  assert.match(one, /레드 탑에도 시즌 선수를 배정하면/); assert.doesNotMatch(one, /Nuguri/);
  const sides = render({ teams: [teams[0]], lineups: { blue: { ...empty(), TOP: ref(marin) } } });
  assert.match(sides, /각각 하나씩/); assert.doesNotMatch(sides, /MaRin/);
  const mixed = render({ lineups: {
    blue: { ...empty(), TOP: ref(marin), MID: { catalog_id: "f".repeat(64), card_id: "0".repeat(64), player_id: "x" } },
    red: { ...empty(), TOP: ref(nuguri), MID: ref(nuguri) },
  } });
  assert.match(mixed, /미확인/); assert.match(mixed, /Nuguri/); assert.match(mixed, /MaRin/);
  const roleMismatch = render({ lineups: { blue: { ...empty(), MID: ref(marin) }, red: { ...empty(), MID: ref(nuguri) } } });
  assert.match(roleMismatch, /미확인/); assert.doesNotMatch(roleMismatch, /양쪽 모두 관측/);
});
