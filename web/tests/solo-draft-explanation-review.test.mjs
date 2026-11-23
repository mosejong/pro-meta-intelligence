import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let vite, explain, Panel, report, history, teams, agent, ids;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ explainSoloDraftTurn: explain } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  ({ SoloDraftExplanationPanel: Panel } = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx"));
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  ({ SHARE_CHAMPIONS: ids } = await vite.ssrLoadModule("/app/share-champion-ids.ts"));
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  // Record-path coverage: the published feed now carries patch_presence (default policy), which these
  // branch tests deliberately exclude; the presence path is covered in solo-ban-policy.test.mjs.
  delete report.patch_presence;
  const parsed = parsePlayerSeasonHistory(await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8"), { basis: rosterBasis(report), season: 2026 });
  assert.ok(parsed.ok); history = parsed.value; teams = report.opponent_prep.teams;
});
after(async () => vite?.close());
const input = () => ({ report, blueTeam: teams[0], redTeam: teams[1], selections: [], previousPicks: [], firstPickSide: "BLUE", manualSide: "RED" });
const html = e => renderToStaticMarkup(React.createElement(Panel, { record: { turn: e.turn, champion_id: e.selected.champion_id, reason: e.selected.reason, prefix: [], context: "review", explanation: e }, nameOf: id => id }));
function pickState() {
  let selections = [];
  for (const [, id] of ids.slice(0, 6)) selections = agent.applyDraftSelection(selections, id);
  assert.equal(selections.length, 6); return selections;
}

test("fallback ban explanation does not claim unavailable opposing-team priority evidence", () => {
  const empty = team => ({ ...team, priority_picks: [], player_profiles: [] });
  const e = explain({ ...input(), report: { ...report, entries: [] }, blueTeam: empty(teams[0]), redTeam: empty(teams[1]) });
  assert.equal(e.selected.source, "FALLBACK");
  assert.doesNotMatch(html(e), /근거 범위[^<]*상대 팀[^<]*공개 우선 픽 기록/);
});
test("incompatible season data is not displayed as available same-team player evidence", () => {
  const stale = { ...history, cutoff: "2026-01-01T00:00:00Z" };
  const e = explain({ ...input(), selections: pickState(), seasonHistory: stale });
  assert.equal(e.kind, "PICK");
  assert.doesNotMatch(html(e), /같은 팀 현재 관측 선수 시즌 기록/);
});
test("a season file with no matching player records is not presented as actual player evidence", () => {
  const e = explain({ ...input(), selections: pickState(), seasonHistory: { ...history, players: new Map() } });
  assert.equal(e.kind, "PICK");
  assert.doesNotMatch(html(e), /같은 팀 현재 관측 선수 시즌 기록/);
});


test("a fallback pick does not claim acting-team or meta records that do not exist", () => {
  const empty = team => ({ ...team, priority_picks: [], player_profiles: [] });
  const e = explain({ ...input(), report: { ...report, entries: [] }, blueTeam: empty(teams[0]), redTeam: empty(teams[1]), selections: pickState() });
  assert.equal(e.selected.source, "FALLBACK");
  assert.doesNotMatch(html(e), /근거 범위[^<]*행동 팀[^<]*공개 기록/);
  assert.doesNotMatch(html(e), /근거 범위[^<]*현재 레이더 메타/);
});
test("without eligible radar rows the explanation does not claim current meta evidence", () => {
  const e = explain({ ...input(), report: { ...report, entries: [] }, selections: pickState() });
  assert.doesNotMatch(html(e), /근거 범위[^<]*현재 레이더 메타/);
});


test("collapsed selected summary does not call current-player-only evidence a priority-pick record", () => {
  const blueTeam = { ...teams[0], priority_picks: [], player_profiles: [{ player_id: "review-player", player_name: "Review", role: "SUPPORT", roster_status: "CURRENT", game_count: 4, champions: [{ champion_id: "Zyra", game_count: 4, game_rate: 1, evidence_event_ids: [] }], evidence_match_ids: [] }] };
  const e = explain({ ...input(), report: { ...report, entries: [] }, blueTeam, selections: pickState() });
  assert.equal(e.selected.champion_id, "Zyra");
  assert.equal(e.selected.evidence, "PLAYER_CURRENT");
  const summary = html(e).match(/<p class="solo-draft-last"[^>]*>(.*?)<\/p>/s)?.[1] ?? "";
  assert.ok(summary);
  assert.doesNotMatch(summary, /공개 우선 픽 기록/);
});


test("collapsed fallback pick summary keeps the insufficient-position-evidence warning", () => {
  const empty = team => ({ ...team, priority_picks: [], player_profiles: [] });
  const e = explain({ ...input(), report: { ...report, entries: [] }, blueTeam: empty(teams[0]), redTeam: empty(teams[1]), selections: pickState() });
  assert.equal(e.selected.source, "FALLBACK"); assert.equal(e.selected.role_supported, false);
  const summary = html(e).match(/<p class="solo-draft-last"[^>]*>(.*?)<\/p>/s)?.[1] ?? "";
  assert.match(summary, /포지션 근거.*부족/);
});
