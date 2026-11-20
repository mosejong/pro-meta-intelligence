import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { FROZEN_PROVENANCE, evaluateCurrentDraftRules } from "./current-draft-evaluation-lib.mjs";
import {
  EVIDENCE_ARTIFACT_TYPE, EVIDENCE_PREPARER_VERSION, OE_SOURCE_ID, evaluateWithSeasonEvidence, validateSeasonEvidence,
} from "./current-draft-season-evaluation-lib.mjs";
import {
  FLAGS, PRIMARY_CLASSES, diagnoseState, loadDiagnosticsApi, reconstructSoloContext, runPoolDiagnostics, shadowOrder, summarizeDiagnostics,
} from "./current-draft-pool-diagnostics-lib.mjs";

// Synthetic structure only: the published feed is a schema template, never diagnostic input.
let vite, api, template, ids;
const ALIAS_IDS = new Set(["LeeSin", "Kaisa"]);
before(async () => {
  ({ vite, api } = await loadDiagnosticsApi());
  ids = api.SHARE_CHAMPIONS.map(([, id]) => id).filter((id) => !ALIAS_IDS.has(id));
  template = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
});
after(async () => { await vite?.close(); });

const VERSION = "oe-2374-version";
const CUTOFF = FROZEN_PROVENANCE.candidate_retrieved_at;
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const sha256 = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const tendency = (champion_id, role, game_rate) => ({ champion_id, role, game_rate, game_count: 4, phase_1_count: 2, phase_2_count: 0, evidence_event_ids: [`e-${champion_id}`] });
const profile = (player_id, role, champions = []) => ({ player_id, player_name: player_id, role, roster_status: "CURRENT", game_count: 4,
  champions: champions.map(([champion_id, game_rate]) => ({ champion_id, game_rate, game_count: 2, evidence_event_ids: [] })), evidence_match_ids: [] });
const entry = (champion_id, rank, role) => ({
  rank, champion_id, role, eligible_for_review: true, quality_flags: [], region_presence: [], evidence_event_ids: [],
  metrics: { current_pick_count: 0, prior_pick_count: 0, current_pick_presence: 0, prior_pick_presence: 0, pick_presence_delta: 0,
    current_distinct_team_count: 0, prior_distinct_team_count: 0, current_demand: 0, prior_demand: 0, demand_velocity: 0,
    team_concentration: null, regional_divergence: null, most_divergent_region_delta: null, most_divergent_region: null },
});
const priorities = (from) => ids.slice(from, from + 6).map((id, i) => tendency(id, ROLES[i % 5], 0.9 - i / 10));

function fixture({ firstPickSide = "BLUE", order = ids.slice(0, 20), blue = priorities(30), red = priorities(40), entries = [],
  blueProfiles = [profile("p-blue-mid", "MID")], redProfiles = [], matchId = "held-out-1" } = {}) {
  const report = structuredClone(template);
  report.fixture_only = true;
  report.opponent_prep.fixture_only = true;
  report.cutoff = CUTOFF;
  report.opponent_prep.cutoff = CUTOFF;
  report.opponent_prep.patch_id = report.patch_id;
  report.entries = entries;
  report.opponent_prep.teams = report.opponent_prep.teams.slice(0, 2);
  report.opponent_prep.team_count = 2;
  report.evidence_index.source_versions = [{ ...report.evidence_index.source_versions[0] }];
  report.opponent_prep.evidence_index.source_versions = [{ ...report.opponent_prep.evidence_index.source_versions[0] }];
  for (const source of [...report.evidence_index.source_versions, ...report.opponent_prep.evidence_index.source_versions]) {
    Object.assign(source, { source_id: OE_SOURCE_ID, source_version: VERSION, content_hash: FROZEN_PROVENANCE.candidate_source_hash });
  }
  const [blueTeam, redTeam] = report.opponent_prep.teams;
  blueTeam.priority_picks = blue;
  redTeam.priority_picks = red;
  for (const team of [blueTeam, redTeam]) team.recent_games = [];
  blueTeam.player_profiles = blueProfiles;
  redTeam.player_profiles = redProfiles;
  let selections = [];
  for (const id of order) selections = api.applyDraftSelection(selections, id, [], firstPickSide);
  assert.equal(selections.length, 20, "fixture order must be a legal 20-action draft");
  return {
    schema_version: "1", artifact_type: "draft-historical-dataset", fixture_only: true, scope: "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
    snapshots: [{ id: "snap", cutoff: CUTOFF, source_hash: FROZEN_PROVENANCE.candidate_source_hash, report }],
    matches: [{ snapshot_id: "snap", match_id: matchId, game_number: 1, first_pick_side: firstPickSide, league: "TEST", patch_id: report.patch_id,
      observed_at: "2026-11-06T10:00:00+00:00", outcome_retrieved_at: FROZEN_PROVENANCE.outcome_retrieved_at,
      outcome_source_hash: FROZEN_PROVENANCE.outcome_source_hash, blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections }],
    audit: { verified_capture_count: 2, eligible_matches: 1, exclusions: {}, last_capture_at: FROZEN_PROVENANCE.outcome_retrieved_at },
  };
}

const FIRST = "2026-10-01T10:00:00+00:00", LAST = "2026-10-02T10:00:00+00:00";
const scope = (games, champion) => games
  ? { games, first_observed_at: FIRST, last_observed_at: LAST, champions: [{ champion_id: champion, games }] }
  : { games: 0, first_observed_at: null, last_observed_at: null, champions: [] };
const row = (id) => ({ id, games: 2, first_observed_at: FIRST, last_observed_at: LAST });

/** Parser-valid season evidence (same shape as the frozen season test) for the blue MID player only. */
function evidence(dataset, seasonChampion) {
  const report = dataset.snapshots[0].report;
  const blue = report.opponent_prep.teams[0];
  const history = {
    artifact_type: "player-season-history", schema_version: 1, season: 2026, cutoff: report.cutoff, reference_patch: report.patch_id,
    recent_game_limit: 20, roster_basis: api.rosterBasis(report),
    source: { source_id: OE_SOURCE_ID, source_version: VERSION, content_hash: FROZEN_PROVENANCE.candidate_source_hash, retrieved_at: CUTOFF },
    source_versions: [`${OE_SOURCE_ID}@${VERSION}#${FROZEN_PROVENANCE.candidate_source_hash}`],
    import_summary: { discovered_game_count: 2, accepted_game_count: 2, rejected_game_count: 0, season_accepted_game_count: 2,
      season_first_observed_at: FIRST, season_last_observed_at: LAST, excluded: {}, note: "" },
    scope: {}, player_count: 1,
    players: [{ team_id: blue.team_id, team_name: String(blue.team_name ?? ""), player_id: "p-blue-mid", player_name: "p-blue-mid",
      status: "FOUND", games: 2, roles: { MID: { season: scope(2, seasonChampion), recent: scope(2, seasonChampion), patch: scope(0),
        by_patch: [row("older-patch")], by_league: [row("TEST")] } } }],
  };
  const text = JSON.stringify(history);
  return {
    schema_version: "1", artifact_type: EVIDENCE_ARTIFACT_TYPE, preparer_version: EVIDENCE_PREPARER_VERSION,
    dataset_sha256: sha256(JSON.stringify(dataset)), season: 2026,
    source: { source_id: OE_SOURCE_ID, source_version: VERSION, content_hash: FROZEN_PROVENANCE.candidate_source_hash, retrieved_at: CUTOFF },
    claims: ["BASE_COHORT_ALREADY_OBSERVED", "BASELINE_MISSING_SEASON_HISTORY", "EXPLORATORY_INTEGRATION_DIAGNOSTIC", "NOT_A_CONFIRMATORY_TRIAL"],
    histories: [{ snapshot_id: "snap", patch_id: report.patch_id, season: 2026, cutoff: report.cutoff, roster_basis: api.rosterBasis(report),
      roster_reference_count: 1, history_sha256: sha256(text), history_json: text }],
  };
}

const run = (dataset, seasonEvidence = null) => runPoolDiagnostics(dataset, api,
  { datasetSha256: seasonEvidence ? sha256(JSON.stringify(dataset)) : null, seasonEvidence, allowFixture: true });
const base = (dataset) => evaluateCurrentDraftRules(dataset, api, { allowFixture: true });
const season = (dataset, value) => evaluateWithSeasonEvidence(dataset, sha256(JSON.stringify(dataset)), value, api, { allowFixture: true });

function stateInput(dataset, prefixIds, { firstPickSide = "BLUE", previousPicks = [], seasonHistory = null } = {}) {
  const report = dataset.snapshots[0].report;
  const [blueTeam, redTeam] = report.opponent_prep.teams;
  let selections = [];
  for (const id of prefixIds) selections = api.applyDraftSelection(selections, id, previousPicks, firstPickSide);
  assert.equal(selections.length, prefixIds.length, "test prefix must be legal");
  const turn = api.nextDraftTurn(selections, firstPickSide);
  return { report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide: turn.side === "BLUE" ? "RED" : "BLUE", seasonHistory };
}
const actualFor = (input, id) => ({ ...api.nextDraftTurn(input.selections, input.firstPickSide), turn: input.selections.length + 1, champion_id: id });
const diagnose = (input, id, explanation = api.explainSoloDraftTurn(input)) => diagnoseState({ input, explanation, actual: actualFor(input, id) }, api);
const choiceKey = (c) => [c.champion_id, c.source, c.role_supported];

/** Shadow top-3 must equal production (id, source, role_supported); returns production sources. */
function assertShadowEqualsProduction(input) {
  const production = api.explainSoloDraftTurn(input);
  const ctx = reconstructSoloContext(input, api);
  if (!production) { assert.equal(ctx, null); return []; }
  const listed = [production.selected, ...production.alternatives];
  assert.deepEqual(shadowOrder(ctx, null, { bound: 3 }).map(choiceKey), listed.map(choiceKey));
  assert.equal(api.suggestSoloDraftTurn(input).champion_id, production.selected.champion_id);
  return listed.map((c) => c.source);
}

test("reconstructed selection equals production top 3 on every prefix, covering every select branch", () => {
  const sources = new Set();
  const seasonDataset = fixture();
  const seasonHistory = validateSeasonEvidence(seasonDataset, sha256(JSON.stringify(seasonDataset)), evidence(seasonDataset, ids[32]), api,
    { allowFixture: true }).byReport.get(seasonDataset.snapshots[0].report);
  assert.ok(seasonHistory.players instanceof Map);
  const cases = [
    { dataset: fixture() },
    { dataset: fixture({ firstPickSide: "RED" }), firstPickSide: "RED" },
    { dataset: fixture({ red: [], entries: [] }) }, // ban records exhausted, no meta: FALLBACK
    { dataset: fixture({ red: [], entries: [entry(ids[70], 1, "MID"), entry(ids[71], 2, "ADC"), entry(ids[72], 3, "SUPPORT")] }) }, // RADAR
    { dataset: fixture({ entries: [entry(ids[33], 1, "BOTTOM"), entry(ids[73], 2, "TOP")],
      blueProfiles: [profile("p-blue-mid", "MID", [[ids[80], 0.5]])], redProfiles: [profile("p-red-top", "TOP", [[ids[81], 0.7]])] }) },
    { dataset: seasonDataset, seasonHistory }, // PLAYER_SEASON
    { dataset: fixture(), previousPicks: [ids[31], ids[41]] }, // Fearless locks change legality and the frame
  ];
  for (const { dataset, firstPickSide = "BLUE", previousPicks = [], seasonHistory: history = null } of cases) {
    const order = dataset.matches[0].selections.map((s) => s.champion_id).filter((id) => !previousPicks.includes(id));
    for (let t = 0; t < order.length; t++) {
      for (const source of assertShadowEqualsProduction(stateInput(dataset, order.slice(0, t), { firstPickSide, previousPicks, seasonHistory: history }))) {
        sources.add(source);
      }
    }
  }
  assert.deepEqual([...sources].sort(), ["FALLBACK", "PLAYER_SEASON", "RADAR", "TEAM_RECORD"]);
});

test("every admitted class has a synthetic case; facts come from the target team for bans and the acting team for picks", () => {
  const dataset = fixture({ entries: [entry(ids[70], 1, "MID")], redProfiles: [profile("p-red-top", "TOP", [[ids[71], 0.6]])] });
  const ban = stateInput(dataset, []); // turn 1: BLUE ban, target = RED priorities
  const deepBan = diagnose(ban, ids[45]);
  assert.equal(deepBan.primary_class, "BAN_TARGET_PRIORITY_BEYOND_TOP3");
  assert.ok(deepBan.features.records_rank > 3 && deepBan.features.target_priority_rank > 3);
  assert.equal(deepBan.features.non_target_priority_rank, null);
  assert.equal(deepBan.features.role_feasible, null);
  const metaBan = diagnose(ban, ids[70]);
  assert.equal(metaBan.primary_class, "BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE");
  assert.equal(metaBan.features.meta_rank, 1);
  assert.equal(metaBan.flags.in_frame_options, true, "flags are non-exclusive with the class");
  const profileBan = diagnose(ban, ids[71]);
  assert.equal(profileBan.primary_class, "BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE");
  assert.deepEqual(profileBan.features.target_role_candidate, { present: true, current: true, season_row: false, roles: ["TOP"] });
  const ownBan = diagnose(ban, ids[31]); // the acting team's own priority is not a ban source
  assert.equal(ownBan.primary_class, "BAN_NOT_IN_TARGET_SOURCES");
  assert.equal(ownBan.flags.non_target_sources_only, true);
  assert.equal(diagnose(ban, ids[95]).primary_class, "BAN_NOT_IN_TARGET_SOURCES");
  assert.equal(diagnose(ban, ids[95]).flags.in_non_target_team_sources, false);
  const banTop = api.explainSoloDraftTurn(ban).selected.champion_id;
  assert.equal(diagnose(ban, banTop).primary_class, "TOP3");

  const pickDataset = fixture();
  const pick = stateInput(pickDataset, [...ids.slice(0, 6), ids[30], ids[6], ids[7]]); // turn 10: BLUE pick, blue already holds TOP
  const infeasible = diagnose(pick, ids[35]); // TOP-only, the role blue already covers
  assert.equal(infeasible.primary_class, "PICK_IN_POOL_ROLE_INFEASIBLE");
  assert.equal(infeasible.features.role_feasible, false);
  assert.ok(infeasible.features.expanded_rank !== null);
  const beyond = diagnose(pick, ids[34]);
  assert.equal(beyond.primary_class, "PICK_IN_POOL_FEASIBLE_BEYOND_TOP3");
  assert.equal(beyond.features.role_feasible, true);
  assert.deepEqual([beyond.shadow.status, beyond.shadow.position, beyond.shadow.position_basis, beyond.shadow.position_source],
    ["VERIFIED_TOP3_EQUAL", 4, "RECONSTRUCTED_SELECT", "TEAM_RECORD"]);
  const top = diagnose(pick, ids[31]);
  assert.equal(top.primary_class, "TOP3");
  assert.deepEqual([top.shadow.position, top.shadow.position_basis], [1, "PRODUCTION_TOP3"]);
  const crossPick = diagnose(pick, ids[41]); // only the opponent's record
  assert.equal(crossPick.primary_class, "PICK_NOT_IN_POOL");
  assert.equal(crossPick.flags.non_target_sources_only, true);

  const abstain = { ...pick, manualSide: "BLUE" }; // the acting side is the user's: production abstains
  assert.equal(api.explainSoloDraftTurn(abstain), null);
  assert.equal(diagnose(abstain, ids[31], null).primary_class, "ABSTAIN");
  const locked = diagnose(pick, ids[0]);
  assert.deepEqual([locked.primary_class, locked.not_computable_reason], ["NOT_COMPUTABLE", "ACTUAL_LOCKED_IN_PREFIX"]);
  const nullness = diagnose(pick, ids[31], null);
  assert.deepEqual([nullness.primary_class, nullness.not_computable_reason], ["NOT_COMPUTABLE", "RECONSTRUCTION_NULLNESS_DIFFERS_FROM_PRODUCTION"]);

  const seen = new Set([deepBan, metaBan, ownBan, infeasible, beyond, top, crossPick, locked].map((r) => r.primary_class));
  seen.add("ABSTAIN");
  assert.deepEqual([...seen].sort(), [...PRIMARY_CLASSES].sort());
});

test("absent, ranked beyond 3 and not computable stay distinct; a deep rank alone never means in pool", () => {
  const dataset = fixture();
  const pick = stateInput(dataset, [...ids.slice(0, 6), ids[30], ids[6], ids[7]]);
  const absent = diagnose(pick, ids[95]);
  assert.equal(absent.primary_class, "PICK_NOT_IN_POOL");
  assert.deepEqual([absent.features.target_priority_rank, absent.features.meta_rank, absent.features.expanded_rank], [null, null, null]);
  assert.equal(absent.features.target_role_candidate.present, false);
  // The full select order reaches every legal champion through FALLBACK, so a position exists, but it is not pool membership.
  assert.equal(absent.shadow.position_source, "FALLBACK");
  assert.ok(absent.shadow.position > 3);
  const ranked = diagnose(pick, ids[34]);
  assert.equal(ranked.primary_class, "PICK_IN_POOL_FEASIBLE_BEYOND_TOP3");
  assert.ok(ranked.features.expanded_rank > 0 && ranked.features.target_priority_rank > 0);
  const unknown = diagnose(pick, ids[31], null);
  assert.equal(unknown.primary_class, "NOT_COMPUTABLE");
  assert.equal(unknown.features, null);
  assert.equal(unknown.shadow.position, null);

  // A production list the reconstruction cannot reproduce makes the position unavailable, never guessed; classes don't use it.
  const real = api.explainSoloDraftTurn(pick);
  const swapped = { ...real, selected: real.alternatives[0], alternatives: [real.selected, real.alternatives[1]] };
  const mismatch = diagnose(pick, ids[34], swapped);
  assert.deepEqual([mismatch.shadow.status, mismatch.shadow.position, mismatch.shadow.position_basis], ["MISMATCH_UNAVAILABLE", null, null]);
  assert.equal(mismatch.primary_class, "PICK_IN_POOL_FEASIBLE_BEYOND_TOP3");
});

test("no future features: changing later actions leaves every earlier state's facts identical", () => {
  const original = run(fixture({ order: ids.slice(0, 20) })).modes.BASELINE.state_rows;
  const altered = run(fixture({ order: [...ids.slice(0, 10), ...ids.slice(100, 110)] })).modes.BASELINE.state_rows;
  assert.equal(original.length, 20);
  for (let t = 0; t < 10; t++) assert.deepEqual(altered[t], original[t], `turn ${t + 1}`);
  assert.notDeepEqual(altered[10].actual, original[10].actual);
});

test("legal prefixes and red-first drafts: bans read the target opponent, acting side follows the red-first order", () => {
  const rows = run(fixture({ firstPickSide: "RED" })).modes.BASELINE.state_rows;
  assert.equal(rows[0].side, "RED");
  assert.equal(rows[0].kind, "BAN");
  for (const r of rows) {
    assert.notEqual(r.primary_class, "NOT_COMPUTABLE");
    assert.equal(r.features.actual_legal_in_prefix, true);
    assert.equal(r.features.actual_locked_in_prefix, false);
    assert.notEqual(r.shadow.status, "MISMATCH_UNAVAILABLE");
  }
  const dataset = fixture({ firstPickSide: "RED" });
  const redBan = stateInput(dataset, [], { firstPickSide: "RED" });
  assert.equal(diagnose(redBan, ids[35]).primary_class, "BAN_TARGET_PRIORITY_BEYOND_TOP3", "red's ban targets BLUE's priorities");
  const own = diagnose(redBan, ids[45]);
  assert.equal(own.primary_class, "BAN_NOT_IN_TARGET_SOURCES");
  assert.ok(own.features.non_target_priority_rank > 0);
});

test("canonical aliases match in priorities, meta and selections", () => {
  const order = ids.slice(0, 20);
  order[6] = "LeeSin"; // turn 7, BLUE pick; priority row spelled "Lee Sin"
  order[9] = "Kai'Sa"; // turn 10, BLUE pick; meta row spelled "Kaisa"
  const rows = run(fixture({ order, blue: [tendency("Lee Sin", "JUNGLE", 0.95), ...priorities(30).slice(0, 4)], entries: [entry("Kaisa", 1, "ADC")] }))
    .modes.BASELINE.state_rows;
  assert.equal(rows[6].actual, "LeeSin");
  assert.equal(rows[6].features.target_priority_rank, 1);
  assert.equal(rows[9].actual, "Kaisa");
  assert.equal(rows[9].features.meta_rank, 1);
  assert.notEqual(rows[9].primary_class, "PICK_NOT_IN_POOL");
  for (const r of rows) assert.notEqual(r.shadow.status, "MISMATCH_UNAVAILABLE");
});

test("baseline and season outputs are byte-identical before and after diagnostics; season rows are availability flags", () => {
  const dataset = fixture();
  const value = evidence(dataset, ids[32]);
  const baseBefore = JSON.stringify(base(dataset)), seasonBefore = JSON.stringify(season(dataset, value));
  const result = run(dataset, value);
  assert.equal(JSON.stringify(base(dataset)), baseBefore);
  assert.equal(JSON.stringify(season(dataset, value)), seasonBefore);
  for (const mode of ["BASELINE", "SEASON"]) {
    assert.deepEqual(result.modes[mode].byte_identity, { before_equals_recorded: true, before_equals_after: true, dataset_unchanged: true,
      output_sha_basis: "JSON.stringify(full evaluator result)" });
    assert.equal(result.modes[mode].state_count, 20);
    for (const r of result.modes[mode].state_rows) assert.match(r.shadow.status, /^VERIFIED_TOP3_/);
  }
  for (const r of result.modes.SEASON.state_rows) {
    // Season rows belong to the acting roster even on bans: availability, not cause.
    assert.equal(r.flags.acting_season_candidates_available, r.side === "BLUE");
    assert.equal(r.features.production_season_evidence, r.side === "BLUE");
  }
  for (const r of result.modes.BASELINE.state_rows) assert.equal(r.flags.acting_season_candidates_available, false);

  let calls = 0;
  const drifting = { ...api, explainSoloDraftTurn: (input) => {
    const e = api.explainSoloDraftTurn(input);
    return ++calls > 20 && e ? { ...e, season_evidence: !e.season_evidence } : e;
  } };
  assert.throws(() => runPoolDiagnostics(dataset, drifting, { allowFixture: true }), /Recording changed the production output/);
});

test("mismatched or ungated inputs are rejected, with no fallback", () => {
  const dataset = fixture();
  const other = fixture({ matchId: "held-out-2" });
  assert.throws(() => run(dataset, evidence(other, ids[32])), /different prepared dataset/);
  assert.throws(() => runPoolDiagnostics(dataset, api, { seasonEvidence: evidence(dataset, ids[32]), allowFixture: true }), /dataset byte hash/);
  assert.throws(() => runPoolDiagnostics(dataset, api, {}), /Fixture datasets are accepted only by unit tests/);
  const wrongSource = fixture();
  wrongSource.snapshots[0].source_hash = `sha256:${"0".repeat(64)}`;
  assert.throws(() => run(wrongSource), /frozen 2374 capture/);
  const wrongOutcome = fixture();
  wrongOutcome.audit.last_capture_at = "2026-11-18T00:00:00+00:00";
  assert.throws(() => run(wrongOutcome), /frozen fcd2 capture/);
  const { nextDraftTurn, ...partial } = api;
  assert.equal(typeof nextDraftTurn, "function");
  assert.throws(() => runPoolDiagnostics(dataset, partial, { allowFixture: true }), /Diagnostics API missing: nextDraftTurn/);
});

test("committed summary is aggregate-only by kind and phase, with no IDs", () => {
  const dataset = fixture({ redProfiles: [] });
  const result = run(dataset, evidence(dataset, ids[32]));
  const summary = summarizeDiagnostics(result);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes("state_rows") && !text.includes("match_id"));
  const report = dataset.snapshots[0].report;
  for (const value of ["held-out-1", "p-blue-mid", "snap", ...report.opponent_prep.teams.map((t) => t.team_id), ...ids.slice(0, 120)]) {
    assert.ok(!text.includes(`"${value}"`), `summary leaks ${value}`);
  }
  for (const mode of ["BASELINE", "SEASON"]) {
    const m = summary.modes[mode];
    const total = Object.values(m.class_counts_by_kind_phase).flatMap((counts) => Object.values(counts)).reduce((a, b) => a + b, 0);
    assert.equal(total, 20);
    assert.deepEqual(Object.keys(m.class_counts_by_kind_phase).sort(), ["BAN:P1", "BAN:P2", "PICK:P1", "PICK:P2"]);
    for (const counts of Object.values(m.flag_counts_by_kind)) assert.deepEqual(Object.keys(counts).sort(), [...FLAGS].sort());
  }
});
