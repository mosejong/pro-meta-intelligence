import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { CANDIDATE_COUNT, EVALUATOR_VERSION, FROZEN_PROVENANCE, evaluateCurrentDraftRules, summarizeEvaluation } from "./current-draft-evaluation-lib.mjs";
import {
  EVIDENCE_ARTIFACT_TYPE, EVIDENCE_PREPARER_VERSION, OE_SOURCE_ID, SEASON_EVALUATOR_VERSION, evaluateWithSeasonEvidence, loadSeasonApi,
} from "./current-draft-season-evaluation-lib.mjs";

// Synthetic structure only: the published feed is a schema template, never evaluator or season input.
let vite, api, template, ids;
before(async () => {
  ({ vite, api } = await loadSeasonApi());
  ids = api.SHARE_CHAMPIONS.map(([, id]) => id);
  template = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
});
after(async () => { await vite?.close(); });

const VERSION = "oe-2374-version";
const CUTOFF = FROZEN_PROVENANCE.candidate_retrieved_at;
const sha256 = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const tendency = (champion_id, role, game_rate) => ({ champion_id, role, game_rate, game_count: 4, phase_1_count: 2, phase_2_count: 0, evidence_event_ids: [`e-${champion_id}`] });
const profile = (player_id, role) => ({ player_id, player_name: player_id, role, roster_status: "CURRENT", game_count: 0, champions: [], evidence_match_ids: [] });

function fixture() {
  const report = structuredClone(template);
  report.fixture_only = true;
  report.opponent_prep.fixture_only = true;
  report.cutoff = CUTOFF;
  report.opponent_prep.cutoff = CUTOFF;
  report.opponent_prep.patch_id = report.patch_id;
  report.entries = [];
  report.opponent_prep.teams = report.opponent_prep.teams.slice(0, 2);
  report.opponent_prep.team_count = 2;
  report.evidence_index.source_versions = [{ ...report.evidence_index.source_versions[0] }];
  report.opponent_prep.evidence_index.source_versions = [{ ...report.opponent_prep.evidence_index.source_versions[0] }];
  for (const source of [...report.evidence_index.source_versions, ...report.opponent_prep.evidence_index.source_versions]) {
    Object.assign(source, { source_id: OE_SOURCE_ID, source_version: VERSION, content_hash: FROZEN_PROVENANCE.candidate_source_hash });
  }
  const [blue, red] = report.opponent_prep.teams;
  const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
  blue.priority_picks = ids.slice(30, 36).map((id, i) => tendency(id, roles[i % 5], 0.9 - i / 10));
  red.priority_picks = ids.slice(40, 46).map((id, i) => tendency(id, roles[i % 5], 0.9 - i / 10));
  for (const team of [blue, red]) { team.recent_games = []; team.player_profiles = []; }
  blue.player_profiles = [profile("p-blue-mid", "MID")];
  let selections = [];
  for (const id of ids.slice(0, 20)) selections = api.applyDraftSelection(selections, id, [], "BLUE");
  return {
    schema_version: "1", artifact_type: "draft-historical-dataset", fixture_only: true, scope: "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
    snapshots: [{ id: "snap", cutoff: CUTOFF, source_hash: FROZEN_PROVENANCE.candidate_source_hash, report }],
    matches: [{ snapshot_id: "snap", match_id: "held-out-1", game_number: 1, first_pick_side: "BLUE", league: "TEST", patch_id: report.patch_id,
      observed_at: "2026-11-06T10:00:00+00:00", outcome_retrieved_at: FROZEN_PROVENANCE.outcome_retrieved_at,
      outcome_source_hash: FROZEN_PROVENANCE.outcome_source_hash, blue_team_id: blue.team_id, red_team_id: red.team_id, selections }],
    audit: { verified_capture_count: 2, eligible_matches: 1, exclusions: { NOT_CONFIRMED_FIRST_SET: 3 }, last_capture_at: FROZEN_PROVENANCE.outcome_retrieved_at },
  };
}

const FIRST = "2026-10-01T10:00:00+00:00", LAST = "2026-10-02T10:00:00+00:00";
const scope = (games, champion) => games
  ? { games, first_observed_at: FIRST, last_observed_at: LAST, champions: [{ champion_id: champion, games }] }
  : { games: 0, first_observed_at: null, last_observed_at: null, champions: [] };
const row = (id) => ({ id, games: 2, first_observed_at: FIRST, last_observed_at: LAST });

/** Parser-valid history shaped like player_season.build_player_season_history output. */
function history(dataset, { found = true } = {}) {
  const report = dataset.snapshots[0].report;
  const blue = report.opponent_prep.teams[0];
  const player = { team_id: blue.team_id, team_name: String(blue.team_name ?? ""), player_id: "p-blue-mid", player_name: "p-blue-mid" };
  return {
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: report.cutoff, reference_patch: report.patch_id,
    recent_game_limit: 20, roster_basis: api.rosterBasis(report),
    source: { source_id: OE_SOURCE_ID, source_version: VERSION, content_hash: FROZEN_PROVENANCE.candidate_source_hash, retrieved_at: CUTOFF },
    source_versions: [`${OE_SOURCE_ID}@${VERSION}#${FROZEN_PROVENANCE.candidate_source_hash}`],
    import_summary: { discovered_game_count: 2, accepted_game_count: 2, rejected_game_count: 0, season_accepted_game_count: 2,
      season_first_observed_at: FIRST, season_last_observed_at: LAST, excluded: {}, note: "" },
    scope: {}, player_count: 1,
    players: [found
      ? { ...player, status: "FOUND", games: 2, roles: { MID: { season: scope(2, ids[60]), recent: scope(2, ids[60]), patch: scope(0),
          by_patch: [row("older-patch")], by_league: [row("TEST")] } } }
      : { ...player, status: "NOT_FOUND", games: 0, roles: {} }],
  };
}

function evidence(dataset, { found = true, mutateHistory, mutateEntry, mutateEvidence } = {}) {
  const value = history(dataset, { found });
  mutateHistory?.(value);
  const text = JSON.stringify(value);
  const report = dataset.snapshots[0].report;
  const entry = { snapshot_id: "snap", patch_id: report.patch_id, season: 2026, cutoff: report.cutoff, roster_basis: api.rosterBasis(report),
    roster_reference_count: 1, history_sha256: sha256(text), history_json: text };
  mutateEntry?.(entry);
  const result = {
    schema_version: "1", artifact_type: EVIDENCE_ARTIFACT_TYPE, preparer_version: EVIDENCE_PREPARER_VERSION,
    dataset_sha256: sha256(JSON.stringify(dataset)), season: 2026,
    source: { source_id: OE_SOURCE_ID, source_version: VERSION, content_hash: FROZEN_PROVENANCE.candidate_source_hash, retrieved_at: CUTOFF },
    claims: ["BASE_COHORT_ALREADY_OBSERVED", "BASELINE_MISSING_SEASON_HISTORY", "EXPLORATORY_INTEGRATION_DIAGNOSTIC", "NOT_A_CONFIRMATORY_TRIAL"],
    histories: [entry],
  };
  mutateEvidence?.(result);
  return result;
}

const base = (dataset) => evaluateCurrentDraftRules(dataset, api, { allowFixture: true });
const season = (dataset, value, customApi = api) => evaluateWithSeasonEvidence(dataset, sha256(JSON.stringify(dataset)), value, customApi, { allowFixture: true });

test("season path calls the unchanged production rules with the validated history and supplies season evidence", () => {
  const dataset = fixture();
  const calls = [];
  const wrap = (name) => (input) => { calls.push({ name, input }); return api[name](input); };
  const spied = { ...api, explainSoloDraftTurn: wrap("explainSoloDraftTurn"), suggestSoloDraftTurn: wrap("suggestSoloDraftTurn") };
  const result = season(dataset, evidence(dataset), spied);
  assert.equal(calls.length, 40);
  for (const call of calls) {
    assert.ok(call.input.seasonHistory instanceof Object && call.input.seasonHistory.players instanceof Map);
    assert.equal(call.input.seasonHistory.cutoff, CUTOFF);
    assert.equal(call.input.report, dataset.snapshots[0].report);
    assert.deepEqual(call.input.previousPicks, []);
  }
  assert.ok(result.season_evidence_state_count > 0, "eligible season history reaches the production rules");
  assert.equal(result.artifact_type, "current-draft-rule-season-evaluation");
  assert.equal(result.evaluator_version, SEASON_EVALUATOR_VERSION);
  assert.equal(result.base_evaluator_version, EVALUATOR_VERSION);
  assert.equal(result.candidate_count, CANDIDATE_COUNT);
  assert.equal(result.comparison_status, "EXPLORATORY_INTEGRATION_DIAGNOSTIC");
  assert.equal(result.base_cohort.already_observed, true);
  assert.equal(result.base_cohort.baseline_season_history, null);
  for (const claim of ["BASE_COHORT_ALREADY_OBSERVED", "BASELINE_MISSING_SEASON_HISTORY", "NOT_A_CONFIRMATORY_TRIAL", "NOT_A_FRESH_HOLDOUT", "NOT_PROOF_OF_UTILITY"]) {
    assert.ok(result.claims.includes(claim), claim);
  }
  assert.ok(!result.claims.includes("SEASON_HISTORY_NOT_SUPPLIED"));
  assert.equal(result.season_history.snapshots[0].found_player_count, 1);
  assert.equal(result.denominator.states, 20);
  const summary = summarizeEvaluation(result);
  assert.equal(summary.by_team, undefined);
  assert.equal(summary.case_results, undefined);
  assert.deepEqual(season(dataset, evidence(dataset)), season(dataset, evidence(dataset)), "deterministic");
});

test("base output is unchanged: baseline before and after the season run is identical and still has no season history", () => {
  const dataset = fixture();
  const pristine = structuredClone(dataset);
  const before = base(dataset);
  season(dataset, evidence(dataset));
  const afterRun = base(dataset);
  assert.deepEqual(afterRun, before);
  assert.deepEqual(dataset, pristine, "season path does not mutate the prepared dataset");
  assert.equal(JSON.stringify(afterRun), JSON.stringify(base(structuredClone(pristine))), "byte-identical baseline output");
  assert.equal(before.season_history, null);
  assert.equal(before.artifact_type, "current-draft-rule-evaluation");
  assert.equal(before.evaluator_version, EVALUATOR_VERSION);
  assert.equal(before.season_evidence_state_count, 0);
  assert.ok(before.claims.includes("SEASON_HISTORY_NOT_SUPPLIED"));
});

test("history without an observed current player leaves every candidate list equal to the baseline", () => {
  const dataset = fixture();
  const withSeason = season(dataset, evidence(dataset, { found: false }));
  assert.equal(withSeason.season_evidence_state_count, 0);
  assert.deepEqual(withSeason.case_results, base(dataset).case_results);
});

const rejections = [
  ["missing evidence: no fallback", () => null, /no fallback/],
  ["wrong artifact", { mutateEvidence: (e) => { e.artifact_type = "player-season-history"; } }, /Unsupported season evidence/],
  ["different dataset", { mutateEvidence: (e) => { e.dataset_sha256 = `sha256:${"0".repeat(64)}`; } }, /different prepared dataset/],
  ["outcome capture as source", { mutateEvidence: (e) => { e.source.content_hash = FROZEN_PROVENANCE.outcome_source_hash; } }, /Forbidden season source/],
  ["2022 capture as source", { mutateEvidence: (e) => { e.source.content_hash = FROZEN_PROVENANCE.forbidden_source_hashes[0]; } }, /Forbidden season source/],
  ["other capture as source", { mutateEvidence: (e) => { e.source.content_hash = `sha256:${"1".repeat(64)}`; } }, /frozen 2374 capture/],
  ["other retrieval time", { mutateEvidence: (e) => { e.source.retrieved_at = "2026-11-04T03:03:23.056760+00:00"; } }, /retrieval time/],
  ["malformed retrieval time", { mutateEvidence: (e) => { e.source.retrieved_at = "2026-11-04T03:03:22.056760"; } }, /retrieval time/],
  ["evidence year", { mutateEvidence: (e) => { e.season = 2025; } }, /year mismatch/],
  ["missing claim", { mutateEvidence: (e) => { e.claims = e.claims.filter((c) => c !== "BASE_COHORT_ALREADY_OBSERVED"); } }, /must declare BASE_COHORT_ALREADY_OBSERVED/],
  ["missing snapshot history", { mutateEvidence: (e) => { e.histories = []; } }, /cover exactly the prepared snapshots/],
  ["extra snapshot history", { mutateEvidence: (e) => { e.histories.push({ ...e.histories[0], snapshot_id: "other" }); } }, /cover exactly the prepared snapshots/],
  ["duplicate snapshot history", { mutateEvidence: (e) => { e.histories.push({ ...e.histories[0] }); } }, /duplicate season history/],
  ["tampered history", { mutateEntry: (entry) => { entry.history_json = `${entry.history_json} `; } }, /hash mismatch/],
  ["different roster basis entry", { mutateEntry: (entry) => { entry.roster_basis = { ...entry.roster_basis, source_versions: [] }; } }, /roster basis differs/],
  ["different roster basis in history", { mutateHistory: (h) => { h.roster_basis = { ...h.roster_basis, patch_id: "other" }; } }, /BASIS_MISMATCH/],
  ["history cutoff", { mutateHistory: (h) => { h.cutoff = "2026-11-05T00:00:00+00:00"; } }, /BASIS_MISMATCH/],
  ["entry cutoff", { mutateEntry: (entry) => { entry.cutoff = "2026-11-04T03:03:22.056760Z"; } }, /cutoff must be exactly/],
  ["history year", { mutateHistory: (h) => { h.season = 2025; } }, /SEASON_MISMATCH/],
  ["entry year", { mutateEntry: (entry) => { entry.season = 2025; } }, /year must equal/],
  ["future player stats", { mutateHistory: (h) => { h.players[0].roles.MID.season.last_observed_at = "2026-11-05T00:00:00+00:00"; } }, /FUTURE_SOURCE/],
  ["source retrieved after cutoff", { mutateHistory: (h) => { h.source.retrieved_at = "2026-11-05T00:00:00+00:00"; } }, /FUTURE_SOURCE/],
  ["history from another version", { mutateHistory: (h) => { h.source.source_version = "other"; h.source_versions = [`${OE_SOURCE_ID}@other#${h.source.content_hash}`]; } }, /source differs/],
  ["player outside the snapshot roster", { mutateHistory: (h) => { h.players.push({ ...h.players[0], player_id: "future-signing", status: "NOT_FOUND", games: 0, roles: {} }); h.player_count = 2; } }, /players differ/],
  ["snapshot roster player missing", { mutateHistory: (h) => { h.players[0].player_id = "someone-else"; } }, /players differ/],
];

for (const [name, spec, pattern] of rejections) {
  test(`rejects season evidence: ${name}`, () => {
    const dataset = fixture();
    const value = typeof spec === "function" ? spec(dataset) : evidence(dataset, spec);
    assert.throws(() => season(dataset, value), pattern);
  });
}

test("rejects a snapshot whose evidence does not cite the season source version", () => {
  const dataset = fixture();
  const value = evidence(dataset);
  dataset.snapshots[0].report.opponent_prep.evidence_index.source_versions[0].source_version = "other";
  assert.throws(() => season(dataset, value), /different prepared dataset/);
  assert.throws(() => evaluateWithSeasonEvidence(dataset, value.dataset_sha256, value, api, { allowFixture: true }), /does not cite the season source version/);
});

test("rejects a fixture dataset without the unit-test flag and a base API without the season parser", () => {
  const dataset = fixture();
  const value = evidence(dataset);
  assert.throws(() => evaluateWithSeasonEvidence(dataset, value.dataset_sha256, value, api), /Fixture datasets/);
  const { parsePlayerSeasonHistory, ...withoutParser } = api;
  assert.equal(typeof parsePlayerSeasonHistory, "function");
  assert.throws(() => season(dataset, value, withoutParser), /Season API missing/);
});

test("season library never reads published or live season history", async () => {
  const source = await readFile(new URL("./current-draft-season-evaluation-lib.mjs", import.meta.url), "utf8");
  for (const forbidden of ["public/history", "PLAYER_SEASON_PATH", "loadPlayerSeasonHistory", "fetch(", "readFile"]) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});
