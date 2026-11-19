import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, suggest, explain, agent, ui, hist, panel, report, history, base, basisOf, ids;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ suggestSoloDraftTurn: suggest, explainSoloDraftTurn: explain } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  ui = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx");
  hist = await vite.ssrLoadModule("/app/solo-draft-history.ts");
  panel = await vite.ssrLoadModule("/app/solo-draft-history-panel.tsx");
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis, basisKey } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  basisOf = r => basisKey(rosterBasis(r));
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const parsed = parsePlayerSeasonHistory(await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8"), { basis: rosterBasis(report), season: 2026 });
  history = parsed.ok ? parsed.value : null;
  base = { report, blueTeam: report.opponent_prep.teams[0], redTeam: report.opponent_prep.teams[1], selections: [], previousPicks: [], firstPickSide: "BLUE", manualSide: "RED" };
});
after(async () => { await vite?.close(); });

const ctxOf = s => hist.soloHistoryContext(ui.soloAutoContext(s.blueTeam.team_id, s.redTeam.team_id, s.firstPickSide, s.manualSide, s.previousPicks), basisOf(s.report));

/** Mirrors draft-lab: record built from the exact pre-choice input, appended only for real auto turns. */
function autoRecord(state) {
  const chosen = suggest(state);
  if (!chosen) return null;
  const e = explain(state);
  const turn = state.selections.length + 1;
  return { turn, champion_id: chosen.champion_id, reason: chosen.reason, prefix: state.selections.map(s => s.champion_id), context: ctxOf(state),
    explanation: e?.selected.champion_id === chosen.champion_id && e.turn === turn ? e : null };
}

/** Plays a full set; manual turns take the first legal canonical id. Returns history and boards. */
function play(state, steps = 20) {
  let h = [], selections = state.selections, manual = 0;
  for (let step = 0; step < steps; step++) {
    const now = { ...state, selections };
    const rec = autoRecord(now);
    let id;
    if (rec) { h = hist.appendSoloAutoHistory(h, rec); id = rec.champion_id; }
    else { manual++; id = ids.find(c => agent.applyDraftSelection(selections, c, state.previousPicks, state.firstPickSide) !== selections); }
    selections = agent.applyDraftSelection(selections, id, state.previousPicks, state.firstPickSide);
    h = hist.pruneSoloAutoHistory(h, selections, ctxOf(state));
  }
  return { h, selections, manual };
}

test("every real auto turn of a full set is kept in order with its frozen pre-choice explanation; manual turns are absent", () => {
  for (const seasonHistory of [null, history]) for (const manualSide of ["BLUE", "RED"]) for (const firstPickSide of ["BLUE", "RED"]) {
    const state = { ...base, seasonHistory, manualSide, firstPickSide };
    const { h, selections, manual } = play(state);
    assert.equal(h.length, 10); assert.equal(manual, 10);
    for (const r of h) {
      assert.notEqual(selections[r.turn - 1].side, manualSide, "manual turn never recorded");
      assert.equal(selections[r.turn - 1].champion_id, r.champion_id);
      assert.ok(Object.isFrozen(r) && Object.isFrozen(r.prefix) && (!r.explanation || Object.isFrozen(r.explanation.alternatives)));
      // Identical to recomputing from the exact pre-choice board, i.e. the selection rule is unchanged.
      assert.deepEqual(r, autoRecord({ ...state, selections: selections.slice(0, r.turn - 1) }));
    }
    assert.deepEqual(h.map(r => r.turn), [...h.map(r => r.turn)].sort((a, b) => a - b));
  }
});

test("undo, reselect, reset, team/side/first pick/next set/basis changes drop the right entries for good", () => {
  const state = { ...base, seasonHistory: null };
  const { h, selections } = play(state, 8);
  const ctx = ctxOf(state);
  const autoTurns = h.map(r => r.turn);
  // Undo to turn 4: only entries before it survive; re-adding the same picks (now manually) does not revive them.
  const undone = hist.pruneSoloAutoHistory(h, selections.slice(0, 4), ctx);
  assert.deepEqual(undone.map(r => r.turn), autoTurns.filter(t => t <= 4));
  assert.deepEqual(hist.pruneSoloAutoHistory(undone, selections, ctx).map(r => r.turn), undone.map(r => r.turn), "stored prune is permanent");
  // Reselect a different champion at an earlier turn: that turn and every later entry are discarded.
  const first = autoTurns[0];
  let changed = selections.slice(0, first - 1);
  const other = ids.find(c => !selections.some(s => s.champion_id === c));
  changed = agent.applyDraftSelection(changed, other);
  for (const s of selections.slice(first)) changed = agent.applyDraftSelection(changed, s.champion_id);
  assert.deepEqual(hist.pruneSoloAutoHistory(h, changed, ctx), []);
  assert.deepEqual(hist.pruneSoloAutoHistory(h, [], ctx), [], "reset");
  for (const patch of [{ blueTeam: { ...base.blueTeam, team_id: "other-team" } }, { manualSide: "BLUE" }, { firstPickSide: "RED" }, { previousPicks: ["Ashe"] }, { report: { ...report, cutoff: "2020-01-01T00:00:00Z" } }])
    assert.deepEqual(hist.pruneSoloAutoHistory(h, selections, ctxOf({ ...state, ...patch })), [], JSON.stringify(Object.keys(patch)));
  // Appending onto a different past prefix discards stale later entries.
  const keep = hist.appendSoloAutoHistory(h, { ...h[0], turn: 9, prefix: selections.map(s => s.champion_id) });
  assert.deepEqual(keep.map(r => r.turn), [...autoTurns, 9], "consistent prefix keeps earlier entries");
  const altered = selections.map(s => s.champion_id); altered[first - 1] = other;
  const late = hist.appendSoloAutoHistory(h, { ...h[0], turn: 9, prefix: altered });
  assert.deepEqual(late.map(r => r.turn), [9], "changed past prefix discards every later entry");
  assert.ok(Object.isFrozen(late[0]));
  assert.equal(hist.pruneSoloAutoHistory(h, selections, ctx), h, "unchanged history keeps identity (no render loop)");
});

test("late season data never rewrites an earlier frozen entry", () => {
  const state = { ...base, seasonHistory: null };
  const { h, selections } = play(state, 12);
  const snapshot = JSON.stringify(h);
  const pick = h.find(r => r.explanation?.kind === "PICK");
  assert.ok(pick); assert.equal(pick.explanation.season_evidence, false);
  // Season arrives later: new turns may use it, old entries stay byte-identical and cannot be mutated.
  const next = autoRecord({ ...state, seasonHistory: history, selections });
  const grown = next ? hist.appendSoloAutoHistory(h, next) : h;
  assert.equal(JSON.stringify(grown.slice(0, h.length)), snapshot);
  assert.throws(() => { pick.explanation.season_evidence = true; });
  const source = autoRecord({ ...state, selections: [] });
  const before = JSON.stringify(source);
  const frozen = hist.freezeSoloAutoRecord(source);
  source.prefix.push("X"); if (source.explanation) { source.explanation.alternatives.length = 0; source.explanation.selected.reason = "changed"; }
  assert.equal(JSON.stringify(frozen), before, "copy is detached from the source record");
});

test("review panel is collapsed, preserves draft read-only semantics and provides explicit text copy", () => {
  const { h } = play({ ...base, seasonHistory: history }, 20);
  const html = renderToStaticMarkup(createElement(panel.SoloDraftHistoryPanel, { history: h, nameOf: id => id, patchId: report.opponent_prep.patch_id, cutoff: report.opponent_prep.cutoff }));
  assert.match(html, /^<details class="solo-history">/); assert.doesNotMatch(html, /<details[^>]* open/);
  assert.doesNotMatch(html, /<input|<select|<a /);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /자동 선택 복기 복사/);
  assert.match(html, /이번 세트 자동 선택 복기 \(10\)/);
  assert.equal((html.match(/<li>/g) ?? []).length, 10 + h.reduce((n, r) => n + (r.explanation?.alternatives.length ?? 0), 0));
  for (const r of h) assert.ok(html.includes(`${r.turn}번째 차례 · ${r.champion_id}`));
  assert.match(html, /선택 직전 상태 기준/); assert.match(html, /예측이 아닙니다/);
  assert.doesNotMatch(html, /마지막 상대 선택/);
  assert.equal(renderToStaticMarkup(createElement(panel.SoloDraftHistoryPanel, { history: [], nameOf: id => id })), "");
  // Last-choice panel markup is unchanged by the shared-body refactor.
  const last = renderToStaticMarkup(createElement(ui.SoloDraftExplanationPanel, { record: h.at(-1), nameOf: id => id }));
  assert.match(last, /^<div class="solo-explain"><p class="solo-draft-last" role="status">마지막 상대 선택 · /);
  assert.match(last, /<details><summary>선택 이유와 다른 후보<\/summary><p>\d+(<!-- -->)?번째 차례/);
});
