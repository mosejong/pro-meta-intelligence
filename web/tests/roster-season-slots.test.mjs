import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite, S, R, M, N, Pool, Season, catalog;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  S = await vite.ssrLoadModule("/app/season-player-cards.ts");
  R = await vite.ssrLoadModule("/app/roster-scenario.ts");
  M = await vite.ssrLoadModule("/app/roster-season-slots.ts");
  N = await vite.ssrLoadModule("/app/roster-season-slot-note.tsx");
  Pool = await vite.ssrLoadModule("/app/player-pool-panel.tsx");
  Season = await vite.ssrLoadModule("/app/player-season-panel.tsx");
  catalog = S.parseSeasonCardCatalog(JSON.parse(await readFile(new URL("../public/history/season-player-cards.json", import.meta.url), "utf8")));
});
after(async () => { await vite?.close(); });

const empty = () => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
const marin = () => catalog.cards.filter(c => c.player_name === "MaRin" && c.season === 2015 && c.role === "TOP").sort((a, b) => b.game_count - a.game_count)[0];
const ref = c => ({ catalog_id: catalog.catalog_id, card_id: c.id, player_id: c.player_id });

const champ = (champion_id, game_count) => ({ champion_id, game_count, game_rate: 0, evidence_event_ids: [`ev:${champion_id}`] });
const player = (player_id, player_name, role, champions) => ({ player_id, player_name, role, roster_status: "CURRENT", game_count: 4, champions, evidence_match_ids: [`m:${player_id}`] });
const team = (team_id, team_name, player_profiles) => ({ team_id, team_name, game_count: 10, player_profiles, priority_picks: [], frequent_bans: [], received_bans: [],
  evidence: { first_observed_at: "2026-10-01T00:00:00Z", last_observed_at: "2026-11-10T00:00:00Z", match_ids: [], draft_event_ids: [] } });
const teams = () => [
  team("t-a", "Alpha", [player("a-top", "Ace", "TOP", [champ("Gnar", 3)]), player("a-mid", "Core", "MID", [champ("Ahri", 2)])]),
  team("t-b", "Beta", [player("b-top", "Gale", "TOP", [champ("Jax", 2)])]),
];
const basis = { patch_id: "16.21", cutoff: "2026-11-14T00:00:00Z", fixture_only: false, top_champions: 5, maximum_games_per_team: 10 };
// Blue TOP holds a season player: its current slot is empty, and Ace (the observed TOP) is not in it.
const rosters = () => ({
  "t-a": { ...empty(), MID: { source_team_id: "t-a", player_id: "a-mid" } },
  "t-b": { ...empty(), TOP: { source_team_id: "t-b", player_id: "b-top" } },
});
const seasonLineups = () => ({ "t-a": { ...empty(), TOP: ref(marin()) } });

test("identity: a season slot names the season player; no ref, an occupied slot or a prototype key is not a season slot", () => {
  const card = marin();
  const id = M.seasonSlotIdentity({ lineups: seasonLineups(), catalog, rosters: rosters(), teamId: "t-a", role: "TOP" });
  assert.deepEqual(id, { status: "SEASON", card_id: card.id, player_name: "MaRin", season: 2015, role: "TOP", game_count: card.game_count, team_names: card.team_names });
  assert.equal(M.seasonSlotLabel(id), "2015 MaRin · 시즌 선수");
  assert.equal(M.seasonSlotIdentity({ lineups: seasonLineups(), catalog, rosters: rosters(), teamId: "t-a", role: "MID" }), null);
  assert.equal(M.seasonSlotIdentity({ lineups: seasonLineups(), catalog, rosters: rosters(), teamId: "t-b", role: "TOP" }), null);
  const occupied = { ...rosters(), "t-a": { ...empty(), TOP: { source_team_id: "t-a", player_id: "a-top" } } };
  assert.equal(M.seasonSlotIdentity({ lineups: seasonLineups(), catalog, rosters: occupied, teamId: "t-a", role: "TOP" }), null);
  assert.equal(M.seasonSlotIdentity({ lineups: Object.create(seasonLineups()), catalog, rosters: rosters(), teamId: "t-a", role: "TOP" }), null);
  // Kept reference without a loaded/matching catalog: never a guessed name, never a current player.
  const unresolved = M.seasonSlotIdentity({ lineups: seasonLineups(), catalog: null, rosters: rosters(), teamId: "t-a", role: "TOP" });
  assert.deepEqual(unresolved, { status: "SEASON_UNRESOLVED" });
  assert.equal(M.seasonSlotLabel(unresolved), "시즌 선수 배정됨 · 시즌 자료 미확인");
});

test("counts: season slots are not 빈칸; empty + season equals the slots without a current player", () => {
  const slots = [
    { teamId: "t-a", role: "TOP", hasPlayer: false }, { teamId: "t-a", role: "MID", hasPlayer: true },
    { teamId: "t-a", role: "JUNGLE", hasPlayer: false }, { teamId: "t-b", role: "TOP", hasPlayer: true },
  ];
  assert.deepEqual(M.rosterSlotCounts(slots, seasonLineups()), { empty: 1, season: 1 });
  assert.deepEqual(M.rosterSlotCounts(slots, {}), { empty: 2, season: 0 });
  // A stale ref on an occupied slot is not counted as a season slot.
  assert.deepEqual(M.rosterSlotCounts([{ teamId: "t-a", role: "TOP", hasPlayer: true }], seasonLineups()), { empty: 0, season: 0 });
});

const renderPool = (extra = {}) => {
  const index = R.buildRosterIndex(teams());
  const [blueTeam, redTeam] = teams();
  return renderToStaticMarkup(createElement(Pool.PlayerPoolPanel, { basis, teams: teams(), index, rosters: rosters(), blueTeam, redTeam, selections: [], previousPicks: [], focusChampionId: null, ...extra }));
};
const li = (html, side, role) => html.match(new RegExp(`aria-label="${side} [^"]+ 선수 근거".*?<li data-role="${role}"[^>]*>(.*?)</li>`, "s"))?.[0] ?? "";

test("evidence panel: season slot shows identity + boundary, never the current roster player's evidence", () => {
  const html = renderPool({ seasonLineups: seasonLineups(), seasonCatalog: catalog });
  const top = li(html, "BLUE", "TOP");
  assert.match(top, /data-status="SEASON"/);
  assert.match(top, /2015 MaRin · 시즌 선수/); assert.match(top, /현재 발행본 선수 근거 미지원/);
  assert.doesNotMatch(top, /빈칸|Ace|Gnar|표본 4경기/);
  // Other slots are unchanged: a current player keeps its evidence, a plain empty slot stays 빈칸.
  assert.match(li(html, "BLUE", "MID"), /Core/);
  assert.match(li(html, "BLUE", "JUNGLE"), /빈칸 · 선수 근거 미확인/);
  assert.match(li(html, "RED", "TOP"), /Gale/);
  // Without season lineups (e.g. not wired), the slot is the previous 빈칸.
  assert.match(li(renderPool(), "BLUE", "TOP"), /빈칸 · 선수 근거 미확인/);
  // Existing boundary wording is kept.
  assert.match(html, /기존 추천 순위·예측\/시뮬레이션에는 반영되지 않습니다/);
});

test("annual record: season slot is named with the 2026-scope boundary, never a current player's annual record", () => {
  const index = R.buildRosterIndex(teams());
  const [blueTeam, redTeam] = teams();
  const history = { season: 2026, recent_game_limit: 10, reference_patch: "16.21", cutoff: "2026-11-14T00:00:00Z", source: { retrieved_at: "2026-11-10T00:00:00Z" },
    import_summary: { season_first_observed_at: null, season_last_observed_at: null, season_accepted_game_count: 0, accepted_game_count: null, rejected_game_count: null },
    players: new Map() };
  const render = (extra) => renderToStaticMarkup(createElement(Season.PlayerSeasonBody, { history, scope: "season", onScope: () => {}, index, rosters: rosters(), blueTeam, redTeam, selections: [], previousPicks: [], ...extra }));
  const html = render({ seasonLineups: seasonLineups(), seasonCatalog: catalog });
  const top = html.match(/aria-label="BLUE [^"]+ 연간 역할별 기록".*?<li data-role="TOP"[^>]*>(.*?)<\/li>/s)?.[0] ?? "";
  assert.match(top, /data-status="SEASON"/); assert.match(top, /2015 MaRin · 시즌 선수/);
  assert.match(top, /2026 연간 기록은 현재 스냅샷 선수만 대상/);
  assert.doesNotMatch(top, /탑<\/b> 빈칸|Ace/);
  const plain = render({});
  assert.match(plain.match(/aria-label="BLUE [^"]+ 연간 역할별 기록".*?<li data-role="TOP"[^>]*>(.*?)<\/li>/s)?.[0] ?? "", /data-status="EMPTY"/);
});

test("note: unresolved season slot keeps the boundary and names no player", () => {
  const html = renderToStaticMarkup(createElement(N.SeasonSlotNote, { identity: { status: "SEASON_UNRESOLVED" } }));
  assert.match(html, /data-season-slot="SEASON_UNRESOLVED"/); assert.match(html, /시즌 자료 미확인/); assert.match(html, /현재 발행본 선수 근거 미지원/);
  assert.doesNotMatch(html, /당시 표본/);
});
