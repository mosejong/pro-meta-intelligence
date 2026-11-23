import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Production selection identity is checked independently by scripts/snapshot-solo-policy.mjs.
const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, suggest, explain, agent, ui, roles, report, history, ids, base;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ suggestSoloDraftTurn: suggest, explainSoloDraftTurn: explain } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  ui = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx");
  roles = await vite.ssrLoadModule("/app/solo-role-candidates.ts");
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  // These cases exercise the record-based path, which is the fallback when a feed has no patch presence.
  delete report.patch_presence;
  const parsed = parsePlayerSeasonHistory(await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8"), { basis: rosterBasis(report), season: 2026 });
  history = parsed.ok ? parsed.value : null;
  base = { report, blueTeam: report.opponent_prep.teams[0], redTeam: report.opponent_prep.teams[1],
    selections: [], previousPicks: [], firstPickSide: "BLUE", manualSide: "RED" };
});
after(async () => { await vite?.close(); });

const strip = value => value ? Object.fromEntries(Object.entries(value).filter(([key]) => !["inferred_roles", "evidence"].includes(key))) : value;

function checkState(state) {
  const frozen = structuredClone(state);
  const chosen = suggest(state);
  const explained = explain(state);
  assert.deepEqual(state, frozen, "inputs untouched");
  if (!chosen) { assert.equal(explained, null); return null; }
  assert.ok(explained);
  assert.deepEqual(strip(explained.selected), chosen, "selected equals the real suggestion");
  const turn = agent.nextDraftTurn(state.selections, state.firstPickSide);
  assert.equal(explained.turn, state.selections.length + 1);
  assert.equal(explained.kind, turn.kind); assert.equal(explained.side, turn.side);
  const acting = turn.side === "BLUE" ? state.blueTeam : state.redTeam;
  const opposing = turn.side === "BLUE" ? state.redTeam : state.blueTeam;
  assert.equal(explained.record_scope, turn.kind === "BAN" ? "OPPOSING_TEAM" : "ACTING_TEAM");
  assert.equal(explained.record_team, (turn.kind === "BAN" ? opposing : acting).team_name);
  // Season evidence must equal the selector's own eligibility, never the truthiness of a supplied object.
  assert.equal(explained.season_evidence, roles.soloRoleCandidates(acting, state.report, state.seasonHistory).some(c => c.season));
  if (!state.seasonHistory) assert.equal(explained.season_evidence, false);
  assert.ok(explained.alternatives.length <= 2);
  const all = [explained.selected, ...explained.alternatives];
  assert.equal(new Set(all.map(c => c.champion_id)).size, all.length, "distinct");
  const locked = new Set([...state.selections.map(s => s.champion_id), ...state.previousPicks].map(id => id.toLowerCase().replace(/[^a-z]/g, "")));
  for (const c of all) {
    assert.ok(ids.includes(c.champion_id), `canonical ${c.champion_id}`);
    assert.notEqual(agent.applyDraftSelection(state.selections, c.champion_id, state.previousPicks, state.firstPickSide), state.selections, "legal before the choice");
    assert.ok(!locked.has(c.champion_id.toLowerCase().replace(/[^a-z]/g, "")), "not banned/picked/previous-set locked");
    assert.ok(c.reason.length);
    assert.equal(c.evidence === "FALLBACK", c.source === "FALLBACK");
    assert.equal(c.evidence === "PLAYER_SEASON", c.source === "PLAYER_SEASON");
    assert.equal(c.evidence.startsWith("RADAR"), c.source === "RADAR");
    if (c.evidence === "PLAYER_SEASON") assert.equal(explained.season_evidence, true);
    if (turn.kind === "PICK") assert.equal(typeof c.role_supported, "boolean"); else assert.deepEqual(c.inferred_roles, []);
  }
  return explained;
}

test("real feed: explanations match the production selection on every opponent turn (sides, first picks, Fearless, season)", () => {
  assert.ok(history, "season companion matches the current feed so both season states are covered");
  let explainedTurns = 0;
  for (const seasonHistory of [null, history]) for (const manualSide of ["BLUE", "RED"]) for (const firstPickSide of ["BLUE", "RED"]) {
    let previousPicks = [];
    for (let game = 0; game < 2; game++) {
      let selections = [];
      for (let step = 0; step < 20; step++) {
        const state = { ...base, seasonHistory, manualSide, firstPickSide, previousPicks, selections };
        const turn = agent.nextDraftTurn(selections, firstPickSide);
        const explained = checkState(state);
        let id;
        if (turn.side === manualSide) { assert.equal(explained, null); id = ids.find(c => agent.applyDraftSelection(selections, c, previousPicks, firstPickSide) !== selections); }
        else { assert.ok(explained); explainedTurns++; id = explained.selected.champion_id; }
        selections = agent.applyDraftSelection(selections, id, previousPicks, firstPickSide);
      }
      checkState({ ...base, seasonHistory, manualSide, firstPickSide, previousPicks, selections });
      previousPicks = [...previousPicks, ...selections.filter(s => s.kind === "PICK").map(s => s.champion_id)];
    }
  }
  assert.equal(explainedTurns, 2 * 2 * 2 * 2 * 10);
});

const tendency = (champion_id, role, game_rate = 0.8) => ({ champion_id, role, game_rate, game_count: 4, phase_1_count: 4, phase_2_count: 0, evidence_event_ids: [] });
function fixture(blue = [], red = [], entries = []) {
  return { ...base, report: { ...report, entries }, blueTeam: { ...base.blueTeam, priority_picks: blue, player_profiles: [] },
    redTeam: { ...base.redTeam, priority_picks: red, player_profiles: [] } };
}

test("ban alternatives follow the opposing team's record order, excluding Fearless locks without fake locks", () => {
  const input = fixture([], [tendency("Ahri", "MID", 0.9), tendency("Zyra", "SUPPORT", 0.7), tendency("Akali", "TOP", 0.5)]);
  const e = checkState(input);
  assert.deepEqual([e.selected, ...e.alternatives].map(c => c.champion_id), ["Ahri", "Zyra", "Akali"]);
  assert.ok([e.selected, ...e.alternatives].every(c => c.source === "TEAM_RECORD"));
  const locked = checkState({ ...input, previousPicks: ["Zyra"] });
  const firstFallback = ids.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0).find(id => !["Ahri", "Akali", "Zyra"].includes(id));
  assert.deepEqual([locked.selected, ...locked.alternatives].map(c => c.champion_id), ["Ahri", "Akali", firstFallback]);
  assert.equal(locked.alternatives[1].source, "FALLBACK");
});

test("fallback and unsupported roles stay visible; invalid inputs give no explanation", () => {
  const empty = checkState(fixture());
  assert.ok([empty.selected, ...empty.alternatives].every(c => c.source === "FALLBACK"));
  let selections = [];
  for (const id of ids.filter(id => !["Ahri", "Akali", "Ashe", "Velkoz", "Zyra"].includes(id)).slice(0, 6)) selections = agent.applyDraftSelection(selections, id);
  const sparse = checkState({ ...fixture(), selections });
  assert.equal(sparse.kind, "PICK");
  assert.equal(sparse.selected.role_supported, false);
  assert.match(sparse.selected.reason, /포지션 근거가 부족/);
  for (const patch of [{ blueTeam: null }, { redTeam: base.blueTeam }, { manualSide: "BLUE" }, { firstPickSide: "BAD" }, { previousPicks: ["UnknownChampion"] }])
    assert.equal(checkState({ ...base, ...patch }), null);
});

test("record matcher hides stale explanations after undo, reset, team/set change, or a lost race", () => {
  const ctx = ui.soloAutoContext("a", "b", "BLUE", "RED", []);
  let selections = [];
  for (const id of ["Aatrox", "Ahri", "Akali"]) selections = agent.applyDraftSelection(selections, id);
  const record = { turn: 3, champion_id: "Akali", reason: "r", prefix: ["Aatrox", "Ahri"], context: ctx, explanation: null };
  assert.equal(ui.soloAutoRecordMatches(record, selections, ctx), true);
  assert.equal(ui.soloAutoRecordMatches(record, selections.slice(0, 2), ctx), false, "undo");
  assert.equal(ui.soloAutoRecordMatches(record, [], ctx), false, "reset");
  assert.equal(ui.soloAutoRecordMatches(record, selections, ui.soloAutoContext("a", "c", "BLUE", "RED", [])), false, "team");
  assert.equal(ui.soloAutoRecordMatches(record, selections, ui.soloAutoContext("a", "b", "BLUE", "RED", ["Ashe"])), false, "next set");
  assert.equal(ui.soloAutoRecordMatches(record, selections, ui.soloAutoContext("a", "b", "BLUE", "BLUE", [])), false, "side");
  let raced = agent.applyDraftSelection([], "Aatrox"); raced = agent.applyDraftSelection(raced, "Ashe"); raced = agent.applyDraftSelection(raced, "Akali");
  assert.equal(ui.soloAutoRecordMatches(record, raced, ctx), false, "prefix changed");
  assert.equal(ui.soloAutoRecordMatches(null, selections, ctx), false);
});

test("panel is compact, read-only, and does not claim prediction or zero season use", () => {
  const e = checkState({ ...base, selections: [] });
  const record = { turn: 1, champion_id: e.selected.champion_id, reason: e.selected.reason, prefix: [], context: "", explanation: e };
  const html = renderToStaticMarkup(createElement(ui.SoloDraftExplanationPanel, { record, nameOf: id => id }));
  assert.match(html, /<details>/); assert.doesNotMatch(html, /<details open/);
  assert.doesNotMatch(html, /<button|<input|<select/);
  assert.match(html, /마지막 상대 선택/); assert.match(html, /선택 직전 상태 기준/);
  assert.match(html, /상대 팀\(/); assert.match(html, /예측이 아닙니다/);
  let pickSel = [];
  for (const id of ids.slice(0, 6)) pickSel = agent.applyDraftSelection(pickSel, id);
  const pick = checkState({ ...base, selections: pickSel, seasonHistory: null });
  const render = explanation => renderToStaticMarkup(createElement(ui.SoloDraftExplanationPanel, { record: { ...record, turn: explanation.turn, explanation }, nameOf: id => id }));
  const pickHtml = render(pick);
  assert.match(pickHtml, /행동 팀\(/); assert.match(pickHtml, /시즌 사용 경험이 없다는 뜻이 아닙니다/); assert.match(pickHtml, /사용자가 지정한 포지션이 아닙니다/);
  assert.doesNotMatch(pickHtml, /같은 팀 현재 관측 선수 시즌 기록/);
  // Visible roles use the existing Korean labels, not engine enums.
  assert.doesNotMatch(pickHtml, /포지션 후보 [^<]*(TOP|JUNGLE|MID|BOTTOM|SUPPORT|ADC)/);
  assert.match(pickHtml, /포지션 후보 (탑|정글|미드|바텀|서포터)/);
  const withSeason = checkState({ ...base, selections: pickSel, seasonHistory: history });
  assert.equal(withSeason.season_evidence, true, "compatible current feed + companion yields usable season evidence");
  const seasonHtml = render(withSeason);
  assert.match(seasonHtml, /근거 범위[^<]*같은 팀 현재 관측 선수 시즌 기록/);
  assert.doesNotMatch(seasonHtml, /사용 경험이 없다는/);
  // Supplied but unusable season objects are unknown, not evidence and not zero use.
  for (const unusable of [{ ...history, cutoff: "2026-01-01T00:00:00Z" }, { ...history, players: new Map() }]) {
    const e = checkState({ ...base, selections: pickSel, seasonHistory: unusable });
    assert.equal(e.season_evidence, false);
    assert.doesNotMatch(render(e), /같은 팀 현재 관측 선수 시즌 기록/);
    assert.match(render(e), /시즌 사용 경험이 없다는 뜻이 아닙니다/);
  }
  // Fallback with no team/meta rows: the lookup target is named, but not claimed as evidence.
  const empty = team => ({ ...team, priority_picks: [], player_profiles: [] });
  const bare = checkState({ ...base, report: { ...report, entries: [] }, blueTeam: empty(base.blueTeam), redTeam: empty(base.redTeam) });
  const bareHtml = render(bare);
  assert.match(bareHtml, /근거 범위 · 사용할 수 있는 기록 없음/);
  assert.match(bareHtml, /확인 대상/);
});
