import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { CANDIDATE_COUNT, FROZEN_PROVENANCE, evaluateCurrentDraftRules, loadProductionApi, summarizeEvaluation } from "./current-draft-evaluation-lib.mjs";

// Synthetic structure only: the published feed is used as a schema template, never as evaluator input.
let vite, api, template, ids;
before(async () => {
  ({ vite, api } = await loadProductionApi());
  ids = api.SHARE_CHAMPIONS.map(([, id]) => id);
  template = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
});
after(async () => { await vite?.close(); });

const tendency = (champion_id, role, game_rate) => ({ champion_id, role, game_rate, game_count: 4, phase_1_count: 2, phase_2_count: 0, evidence_event_ids: [`e-${champion_id}`] });
function fixture({ firstPickSide = "BLUE", matchId = "held-out-1", order = ids.slice(0, 20) } = {}) {
  const report = structuredClone(template);
  report.fixture_only = true;
  report.opponent_prep.fixture_only = true;
  report.cutoff = FROZEN_PROVENANCE.candidate_retrieved_at;
  report.opponent_prep.cutoff = FROZEN_PROVENANCE.candidate_retrieved_at;
  report.opponent_prep.patch_id = report.patch_id;
  report.entries = [];
  report.opponent_prep.teams = report.opponent_prep.teams.slice(0, 2);
  report.opponent_prep.team_count = 2;
  for (const source of [...report.evidence_index.source_versions, ...report.opponent_prep.evidence_index.source_versions]) source.content_hash = FROZEN_PROVENANCE.candidate_source_hash;
  const [blue, red] = report.opponent_prep.teams;
  const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
  blue.priority_picks = ids.slice(30, 36).map((id, i) => tendency(id, roles[i % 5], 0.9 - i / 10));
  red.priority_picks = ids.slice(40, 46).map((id, i) => tendency(id, roles[i % 5], 0.9 - i / 10));
  for (const team of [blue, red]) { team.recent_games = []; team.player_profiles = []; }
  let selections = [];
  for (const id of order) selections = api.applyDraftSelection(selections, id, [], firstPickSide);
  return {
    schema_version: "1", artifact_type: "draft-historical-dataset", fixture_only: true, scope: "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
    snapshots: [{ id: "snap", cutoff: FROZEN_PROVENANCE.candidate_retrieved_at, source_hash: FROZEN_PROVENANCE.candidate_source_hash, report }],
    matches: [{ snapshot_id: "snap", match_id: matchId, game_number: 1, first_pick_side: firstPickSide, league: "TEST", patch_id: report.patch_id,
      observed_at: "2026-11-06T10:00:00+00:00", outcome_retrieved_at: FROZEN_PROVENANCE.outcome_retrieved_at,
      outcome_source_hash: FROZEN_PROVENANCE.outcome_source_hash, blue_team_id: blue.team_id, red_team_id: red.team_id, selections }],
    audit: { verified_capture_count: 2, eligible_matches: 1, exclusions: { NOT_CONFIRMED_FIRST_SET: 3 }, last_capture_at: FROZEN_PROVENANCE.outcome_retrieved_at },
  };
}
const run = (dataset, customApi = api) => evaluateCurrentDraftRules(dataset, customApi, { allowFixture: true });
function spy(onCall) {
  const calls = [];
  const wrap = (name) => (input) => {
    calls.push({ name, input: structuredClone(input) });
    const override = onCall?.(name, input);
    return override === undefined ? api[name](input) : override;
  };
  return { calls, api: { ...api, explainSoloDraftTurn: wrap("explainSoloDraftTurn"), suggestSoloDraftTurn: wrap("suggestSoloDraftTurn") } };
}

test("calls the real production solo rules once per state and reports their choice", () => {
  const dataset = fixture();
  const { calls, api: spied } = spy();
  const result = run(dataset, spied);
  assert.equal(calls.filter((c) => c.name === "explainSoloDraftTurn").length, 20);
  assert.equal(calls.filter((c) => c.name === "suggestSoloDraftTurn").length, 20);
  const match = dataset.matches[0];
  const [blueTeam, redTeam] = dataset.snapshots[0].report.opponent_prep.teams;
  for (const row of result.case_results) {
    const input = { report: dataset.snapshots[0].report, blueTeam, redTeam, selections: match.selections.slice(0, row.turn - 1), previousPicks: [],
      firstPickSide: "BLUE", manualSide: row.side === "BLUE" ? "RED" : "BLUE", seasonHistory: null };
    const direct = api.explainSoloDraftTurn(input);
    assert.deepEqual(row.candidates, [direct.selected, ...direct.alternatives].map((c) => c.champion_id));
    assert.equal(row.candidates[0], api.suggestSoloDraftTurn(input).champion_id);
  }
  assert.equal(result.overall.illegal_candidates, 0);
  assert.equal(result.season_history, null);
  assert.deepEqual(run(dataset), run(dataset), "deterministic");
});

test("each state sees only the chronological prefix; the actual action never feeds a recommendation", () => {
  const dataset = fixture();
  const { calls, api: spied } = spy();
  run(dataset, spied);
  const selections = dataset.matches[0].selections;
  for (const [n, call] of calls.filter((c) => c.name === "explainSoloDraftTurn").entries()) {
    assert.deepEqual(call.input.selections, selections.slice(0, n));
    assert.notEqual(call.input.manualSide, selections[n].side, "acting side is always the rules' side");
    assert.deepEqual(call.input.previousPicks, []);
    assert.equal(call.input.seasonHistory, null);
  }
  // Changing only the last observed action changes no candidate list (it can only change scoring).
  const changed = structuredClone(dataset);
  changed.matches[0].selections[19].champion_id = ids[25];
  const a = run(dataset), b = run(changed);
  assert.deepEqual(b.case_results.map((r) => r.candidates), a.case_results.map((r) => r.candidates));
  // Turn-by-turn: altering a future selection never alters earlier states.
  const tail = structuredClone(dataset);
  tail.matches[0].selections[12].champion_id = ids[26];
  const c = run(tail);
  assert.deepEqual(c.case_results.slice(0, 13).map((r) => r.candidates), a.case_results.slice(0, 13).map((r) => r.candidates));
});

test("true denominator: all twenty states, abstentions kept, unknown names excluded and counted", () => {
  const base = fixture();
  const result = run(base);
  assert.equal(result.denominator.states, 20);
  assert.equal(result.by_kind.BAN.states, 10);
  assert.equal(result.by_kind.PICK.states, 10);
  for (const side of ["BLUE", "RED"]) assert.equal(result.by_kind_side[`PICK:${side}`].states + result.by_kind_side[`BAN:${side}`].states, 10);
  assert.equal(result.overall.emitted_candidates, 20 * CANDIDATE_COUNT);
  const hits = result.case_results.filter((r) => r.candidates[0] && r.candidates[0].toLowerCase() === r.actual.toLowerCase()).length;
  assert.equal(result.overall.top1_agreements, hits);
  assert.deepEqual(result.denominator.preparer_exclusions, { NOT_CONFIRMED_FIRST_SET: 3 });

  const { api: abstaining } = spy((name, input) => input.selections.length === 6 ? null : undefined);
  const abstained = run(base, abstaining);
  assert.equal(abstained.overall.states, 20);
  assert.equal(abstained.overall.abstentions, 1);
  assert.equal(abstained.by_kind.PICK.abstentions, 1);

  const two = fixture();
  const unknown = fixture({ matchId: "held-out-2" }).matches[0];
  unknown.selections[3].champion_id = "NotARealChampion";
  two.matches.push(unknown);
  two.audit.eligible_matches = 2;
  const counted = run(two);
  assert.equal(counted.denominator.prepared_matches, 2);
  assert.equal(counted.denominator.evaluated_matches, 1);
  assert.deepEqual(counted.denominator.evaluator_exclusions, { UNKNOWN_CHAMPION_ID: 1 });
  assert.equal(counted.denominator.states, 20);
});

test("red first pick is honored and every emitted candidate is legal", () => {
  const result = run(fixture({ firstPickSide: "RED" }));
  assert.equal(result.case_results[6].side, "RED");
  assert.equal(result.case_results[6].kind, "PICK");
  assert.equal(result.overall.illegal_candidates, 0);
  assert.equal(result.overall.states, 20);
});

test("aggregate summary omits team IDs and per-case rows", () => {
  const summary = summarizeEvaluation(run(fixture()));
  assert.equal("by_team" in summary, false);
  assert.equal("case_results" in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /held-out-1/);
});

const forbidden = "sha256:76b7cb8afc1c65c7e220053b1c5296c593e00c3a6dfaee4ef47373aa64b42a0a";
for (const [name, mutate, error, options] of [
  ["real dataset without explicit fixture permission", () => {}, /Fixture datasets/, {}],
  ["wrong artifact", (d) => { d.artifact_type = "other"; }, /Unsupported/],
  ["missing audit", (d) => { delete d.audit; }, /audit/],
  ["audit outcome is 76b7", (d) => { d.audit.last_capture_at = "2026-11-18T00:45:22.279927+00:00"; }, /fcd2/],
  ["audit count mismatch", (d) => { d.audit.eligible_matches = 2; }, /audit/],
  ["outcome hash is 76b7", (d) => { d.matches[0].outcome_source_hash = forbidden; }, /Forbidden outcome/],
  ["candidate is not 2374", (d) => { d.snapshots[0].source_hash = `sha256:${"c".repeat(64)}`; }, /2374/],
  ["source version provenance mismatch", (d) => { d.snapshots[0].report.evidence_index.source_versions[0].content_hash = `sha256:${"d".repeat(64)}`; }, /provenance/],
  ["cutoff mismatch", (d) => { d.snapshots[0].report.opponent_prep.cutoff = "2026-11-05T00:00:00+00:00"; }, /cutoff/],
  ["naive timestamp", (d) => { d.matches[0].observed_at = "2026-11-06T10:00:00"; }, /Timezone-aware/],
  ["match before candidate capture", (d) => { d.matches[0].observed_at = "2026-11-04T03:00:00+00:00"; }, /Future leakage/],
  ["match after outcome capture", (d) => { d.matches[0].observed_at = "2026-11-12T00:00:00+00:00"; }, /Future leakage/],
  ["target in evidence", (d) => { d.snapshots[0].report.opponent_prep.teams[0].evidence.match_ids.push("held-out-1"); }, /Target match/],
  ["future recent game", (d) => { d.snapshots[0].report.opponent_prep.teams[0].recent_games = [{ match_id: "x", observed_at: "2026-11-05T00:00:00+00:00",
    league: "TEST", tournament: "TEST", side: "BLUE", opponent_team_id: "o", opponent_team_name: "o", result: "WIN", first_pick: true, picks: [] }]; }, /Future evidence/],
  ["missing first-pick side", (d) => { delete d.matches[0].first_pick_side; }, /first_pick_side/],
  ["first-pick side contradicts order", (d) => { d.matches[0].first_pick_side = "RED"; }, /draft order/],
  ["later set", (d) => { d.matches[0].game_number = 2; }, /first-set/],
  ["short draft", (d) => { d.matches[0].selections.pop(); }, /first-set/],
  ["duplicate champion", (d) => { d.matches[0].selections[8].champion_id = d.matches[0].selections[0].champion_id; }, /Duplicate or empty/],
  ["missing team", (d) => { d.matches[0].red_team_id = "absent-team"; }, /team evidence/],
  ["patch mismatch", (d) => { d.matches[0].patch_id = "0.0"; }, /Patch mismatch/],
  ["duplicate match", (d) => { d.matches.push(structuredClone(d.matches[0])); d.audit.eligible_matches = 2; }, /Duplicate outcome/],
]) {
  test(`rejects ${name}`, () => {
    const dataset = fixture();
    mutate(dataset);
    assert.throws(() => evaluateCurrentDraftRules(dataset, api, options ?? { allowFixture: true }), error);
  });
}

test("rejects a substitute scorer that disagrees with suggestSoloDraftTurn", () => {
  const { api: broken } = spy((name, input) => {
    if (name !== "suggestSoloDraftTurn") return undefined;
    const real = api.suggestSoloDraftTurn(input);
    return { ...real, champion_id: real.champion_id === ids[50] ? ids[51] : ids[50] };
  });
  assert.throws(() => run(fixture(), broken), /selected differs/);
  assert.throws(() => evaluateCurrentDraftRules(fixture(), { ...api, explainSoloDraftTurn: undefined }, { allowFixture: true }), /Production API missing/);
});
