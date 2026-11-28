import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite, S, D, V, P, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/season-player-cards.ts");
  D = await vite.ssrLoadModule("/app/season-champion-detail.ts");
  V = await vite.ssrLoadModule("/app/season-champion-detail-panel.tsx");
  P = await vite.ssrLoadModule("/app/season-player-comparison-panel.tsx");
  catalog = S.parseSeasonCardCatalog(JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8")));
});
after(async () => { await vite?.close(); });

const SIDES = { blue: "blue", red: "red" };
const empty = () => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
const pick = (name, season) => catalog.cards.filter(c => c.player_name === name && c.season === season && c.role === "TOP").sort((a, b) => b.game_count - a.game_count)[0];
const ref = c => ({ catalog_id: catalog.catalog_id, card_id: c.id, player_id: c.player_id });
const setup = () => {
  const marin = pick("MaRin", 2015), nuguri = pick("Nuguri", 2022);
  const lineups = { blue: { ...empty(), TOP: ref(marin) }, red: { ...empty(), TOP: ref(nuguri) } };
  return { marin, nuguri, lineups };
};
const targetFor = (marin, nuguri, champion_id) => ({ catalog_id: catalog.catalog_id, role: "TOP", champion_id, blue: { team_id: "blue", card_id: marin.id }, red: { team_id: "red", card_id: nuguri.id } });
const onlyOn = (have, lack) => have.champions.find(c => !lack.champions.some(o => o.champion_id.toLowerCase() === c.champion_id.toLowerCase()));

test("detail: per-side observed counts from the actual cards; a champion absent from a card is null (미관측), never 0", () => {
  const { marin, nuguri, lineups } = setup();
  const snap = structuredClone([catalog, lineups]);
  const only = onlyOn(marin, nuguri);
  assert.ok(only, "MaRin 2015 has a champion Nuguri 2022 lacks");
  const detail = D.seasonChampionDetail(targetFor(marin, nuguri, only.champion_id), catalog, lineups, SIDES, [{ kind: "BAN", champion_id: only.champion_id }], []);
  assert.equal(detail.state, "BANNED_NOW");
  assert.deepEqual(detail.sides.map(s => [s.side, s.player_name, s.season, s.game_count]), [["BLUE", "MaRin", 2015, marin.game_count], ["RED", "Nuguri", 2022, nuguri.game_count]]);
  assert.equal(detail.sides[0].games, only.games);
  assert.equal(detail.sides[1].games, null);
  assert.deepEqual([catalog, lineups], snap);
});

test("detail: aliases collapse to the largest single row, never summed", () => {
  const { marin, nuguri, lineups } = setup();
  const local = structuredClone(catalog);
  const blue = local.cards.find(c => c.id === marin.id);
  blue.champions = [{ champion_id: "Wukong", games: 2 }, { champion_id: "MonkeyKing", games: 5 }];
  const detail = D.seasonChampionDetail(targetFor(marin, nuguri, "MonkeyKing"), local, lineups, SIDES, [], ["Wukong"]);
  assert.equal(detail.sides[0].games, 5);
  assert.equal(detail.state, "FEARLESS_LOCKED");
});

test("target is withdrawn when the catalog version or either compared card changes", () => {
  const { marin, nuguri, lineups } = setup();
  const target = targetFor(marin, nuguri, "Gnar");
  assert.equal(D.seasonChampionTargetValid(target, catalog, lineups, SIDES), true);
  assert.equal(D.seasonChampionTargetValid(target, null, lineups, SIDES), false);
  assert.equal(D.seasonChampionTargetValid(target, { ...catalog, catalog_id: "f".repeat(64) }, lineups, SIDES), false);
  assert.equal(D.seasonChampionTargetValid(target, catalog, { ...lineups, red: empty() }, SIDES), false);
  const other = catalog.cards.find(c => c.role === "TOP" && c.id !== nuguri.id && c.player_id !== marin.player_id);
  assert.equal(D.seasonChampionTargetValid(target, catalog, { ...lineups, red: { ...empty(), TOP: ref(other) } }, SIDES), false);
  assert.equal(D.seasonChampionTargetValid({ ...target, role: "MID" }, catalog, lineups, SIDES), false);
  assert.equal(D.seasonChampionTargetValid(target, catalog, Object.create({ blue: lineups.blue, red: lineups.red }), SIDES), false);
  assert.equal(D.seasonChampionDetail(target, catalog, { blue: lineups.blue }, SIDES, [], []), null);
  assert.equal(D.seasonChampionDetail(null, catalog, lineups, SIDES, [], []), null);
});

const team = (team_id, team_name, extra = {}) => ({ team_id, team_name, game_count: 10, priority_picks: [], frequent_bans: [], received_bans: [], recent_games: [], ...extra });
const report = { patch_id: "26.22", cutoff: "2026-11-20T00:00:00Z", entries: [{ champion_id: "Gnar", role: "TOP", metrics: { current_pick_count: 4, current_distinct_team_count: 3 }, eligible_for_review: true, evidence_event_ids: ["e1", "e2"] }] };
const view = (detail, analysis) => renderToStaticMarkup(createElement(V.SeasonChampionDetailView, { detail, analysis, nameOf: id => `N:${id}`, onClose: () => {} }));

test("side swap: the same two teams on swapped sides withdraw the detail instead of keeping old BLUE/RED labels", () => {
  const { marin, nuguri, lineups } = setup();
  const target = targetFor(marin, nuguri, "Maokai");
  assert.equal(D.seasonChampionTargetValid(target, catalog, lineups, SIDES), true);
  // Lineups stay keyed by team, so only the side check can notice the swap.
  assert.equal(D.seasonChampionTargetValid(target, catalog, lineups, { blue: "red", red: "blue" }), false);
  assert.equal(D.seasonChampionDetail(target, catalog, lineups, { blue: "red", red: "blue" }, [], []), null);
  assert.equal(D.seasonChampionTargetValid(target, catalog, lineups, { blue: "blue", red: null }), false);
  assert.equal(D.seasonChampionTargetValid(target, catalog, lineups, { blue: "other", red: "red" }), false);
  // Reopened after the swap, BLUE is the team now on blue (Nuguri's), never the old one.
  const reopened = { ...target, blue: { team_id: "red", card_id: nuguri.id }, red: { team_id: "blue", card_id: marin.id } };
  const detail = D.seasonChampionDetail(reopened, catalog, lineups, { blue: "red", red: "blue" }, [], []);
  assert.deepEqual(detail.sides.map(s => [s.side, s.player_name]), [["BLUE", "Nuguri"], ["RED", "MaRin"]]);
});

test("detail view: season and current publication halves are separate; unobserved stays 미관측", () => {
  const { marin, nuguri, lineups } = setup();
  const detail = { ...D.seasonChampionDetail(targetFor(marin, nuguri, "Gnar"), catalog, lineups, SIDES, [], []), champion_id: "Gnar" };
  detail.sides = [{ ...detail.sides[0], games: 7 }, { ...detail.sides[1], games: null }];
  const blueTeam = team("b", "블루팀", { priority_picks: [{ champion_id: "Gnar", role: "TOP", game_count: 3, evidence_event_ids: ["x1", "x2", "x3"] }] });
  const linked = view(detail, { report, blueTeam, redTeam: team("r", "레드팀") });
  assert.match(linked, /data-part="season"/); assert.match(linked, /data-analysis="linked"/);
  assert.match(linked, /2015 MaRin · 탑 · 표본 \d+경기 · N:Gnar 7회 관측/);
  assert.match(linked, /2022 Nuguri · 탑 · 표본 \d+경기 · N:Gnar 미관측/); assert.match(linked, /0회가 아니라/);
  assert.match(linked, /패치 26\.22/); assert.match(linked, /블루팀 팀 공개 요약 · 픽 3경기 · 밴 집계 미확인/);
  assert.match(linked, /메타 레이더 · 탑 · 최근 구간 픽 4 · 3개 팀/); assert.match(linked, /합치지 않습니다/);
  assert.match(linked, /상세 닫기/); assert.doesNotMatch(linked, /승률|추천 픽|능력치/);
  const unseen = view({ ...detail, champion_id: "Zeri" }, { report, blueTeam: team("b", "블루팀"), redTeam: team("r", "레드팀") });
  assert.match(unseen, /현재 발행본\(두 팀 공개 요약·메타 레이더\)에서 미관측/);
  const unlinked = view(detail, null);
  assert.match(unlinked, /data-analysis="unlinked"/); assert.match(unlinked, /연결되지 않아/); assert.doesNotMatch(unlinked, /패치 26/);
});

test("comparison panel: champion names are buttons that open the read-only detail; no detail is open by default", () => {
  const { lineups } = setup();
  const html = renderToStaticMarkup(createElement(P.SeasonPlayerComparisonPanel, { catalog, lineups, teams: [{ id: "blue", name: "블루 관측팀", side: "BLUE" }, { id: "red", name: "레드 관측팀", side: "RED" }], selections: [], previousPicks: [], nameOf: id => `N:${id}` }));
  assert.match(html, /class="season-compare-champ"[^>]*aria-expanded="false"[^>]*aria-label="N:[^"]+ 상세 보기 \(탑 시즌 관측\)"/);
  assert.match(html, /상세 보기 \(탑 양쪽 관측\)/);
  assert.doesNotMatch(html, /season-champ-detail/);
  assert.match(html, /밴픽 선택은 바뀌지 않습니다/);
});
