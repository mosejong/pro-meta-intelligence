// Research evaluator for the CURRENT solo practice-opponent rules (suggestSoloDraftTurn /
// explainSoloDraftTurn) on already-prepared first-set drafts. Agreement with the observed
// professional action is concordance only: not win prediction, utility or quality.
//
// Input contract: the exact output of src/pro_meta_intelligence/backtest/draft_dataset.py
// (schema_version "1", artifact_type "draft-historical-dataset"). Nothing is repaired; any
// schema/time/provenance defect throws.
import { fileURLToPath } from "node:url";

export const EVALUATOR_VERSION = "current-solo-rule-concordance-v1";
export const CANDIDATE_COUNT = 3; // selected + 2 alternatives, fixed; never tuned.

// Frozen physical captures (outputs/oracles-elixir/raw/oracles-elixir-match-data/*.meta.json).
// 76b7… (retrieved 2026-11-18) is 2022 data and is never an acceptable outcome source.
export const FROZEN_PROVENANCE = Object.freeze({
  candidate_source_hash: "sha256:2374ae616a69d6d643b645d4c646b0fe9ba1fc08b16dce152feb567995234590",
  candidate_retrieved_at: "2026-11-04T03:03:22.056760+00:00",
  outcome_source_hash: "sha256:fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de",
  outcome_retrieved_at: "2026-11-11T02:19:29.155420+00:00",
  forbidden_source_hashes: ["sha256:76b7cb8afc1c65c7e220053b1c5296c593e00c3a6dfaee4ef47373aa64b42a0a"],
});

export const CLAIMS = Object.freeze([
  "CONCORDANCE_NOT_WIN_PREDICTION", "CONCORDANCE_NOT_UTILITY", "LEGALITY_NOT_QUALITY",
  "FIRST_SET_ONLY_NO_FEARLESS_LOCKS", "PAST_ONLY_ROSTER", "NO_FUTURE_ROLE_OR_LINEUP_INPUTS",
  "SEASON_HISTORY_NOT_SUPPLIED", "CAPTURE_2374_INPUTS_FCD2_OUTCOMES", "NOT_FULL_SEASON_2026",
  "SOURCE_PREVIOUSLY_USED_FOR_OTHER_RESEARCH", "STATES_WITHIN_MATCH_CORRELATED", "NO_FITTING_OR_WEIGHT_SEARCH",
]);

/** Loads the unchanged production modules. The CLI only ever evaluates through this. */
export async function loadProductionApi() {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const solo = await vite.ssrLoadModule("/app/solo-draft.ts");
    const agent = await vite.ssrLoadModule("/app/draft-agent.ts");
    const radar = await vite.ssrLoadModule("/app/radar-types.ts");
    const assets = await vite.ssrLoadModule("/app/champion-assets.ts");
    const share = await vite.ssrLoadModule("/app/share-champion-ids.ts");
    return {
      vite,
      api: {
        suggestSoloDraftTurn: solo.suggestSoloDraftTurn, explainSoloDraftTurn: solo.explainSoloDraftTurn,
        applyDraftSelection: agent.applyDraftSelection, draftSequence: agent.draftSequence,
        isRadarReport: radar.isRadarReport, championAssetId: assets.championAssetId, SHARE_CHAMPIONS: share.SHARE_CHAMPIONS,
      },
    };
  } catch (error) { await vite.close(); throw error; }
}

const SIDES = ["BLUE", "RED"];
const HASH = /^sha256:[0-9a-f]{64}$/;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function req(condition, message) { if (!condition) throw new Error(message); }
function time(value, label) {
  req(typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), `Timezone-aware timestamp required: ${label}`);
  return Date.parse(value);
}
const fresh = () => ({ states: 0, abstentions: 0, top1_agreements: 0, top3_inclusions: 0, short_candidate_lists: 0, emitted_candidates: 0, illegal_candidates: 0 });
function rates(m) {
  const r = (v) => m.states ? Number((v / m.states).toFixed(6)) : null;
  return { ...m, top1_agreement_rate: r(m.top1_agreements), top3_inclusion_rate: r(m.top3_inclusions), abstention_rate: r(m.abstentions) };
}

function validateSnapshot(raw, api, fixtureOnly) {
  req(isRecord(raw) && typeof raw.id === "string" && typeof raw.source_hash === "string" && HASH.test(raw.source_hash), "Invalid candidate snapshot");
  req(api.isRadarReport(raw.report) && isRecord(raw.report.opponent_prep), "Invalid candidate snapshot report");
  req(!FROZEN_PROVENANCE.forbidden_source_hashes.includes(raw.source_hash), "Forbidden source capture (76b7 is 2022 data)");
  req(raw.source_hash === FROZEN_PROVENANCE.candidate_source_hash, "Candidate source must be the frozen 2374 capture");
  const cutoff = time(raw.cutoff, "snapshot cutoff");
  req(cutoff === time(FROZEN_PROVENANCE.candidate_retrieved_at, "frozen") && cutoff === time(raw.report.cutoff, "report cutoff") &&
    cutoff === time(raw.report.opponent_prep.cutoff, "prep cutoff"), "Snapshot cutoff mismatch");
  req(raw.report.fixture_only === fixtureOnly && raw.report.opponent_prep.fixture_only === fixtureOnly, "Fixture/real data mismatch");
  const prep = raw.report.opponent_prep;
  req(raw.report.patch_id === prep.patch_id, "Snapshot patch mismatch");
  req(prep.teams.every((team) => Number.isSafeInteger(team.game_count) && team.game_count >= 0 && team.priority_picks.every((pick) =>
    Number.isFinite(pick.game_rate) && pick.game_rate >= 0 && pick.game_rate <= 1 && Number.isSafeInteger(pick.phase_1_count) && pick.phase_1_count >= 0)) &&
    raw.report.entries.every((entry) => Number.isSafeInteger(entry.rank) && entry.rank > 0), "Invalid ranking inputs");
  const sources = [...raw.report.evidence_index.source_versions, ...prep.evidence_index.source_versions];
  req(sources.length > 0 && sources.every((source) => source.content_hash === raw.source_hash), "Candidate source provenance mismatch");
  for (const team of prep.teams) for (const game of team.recent_games ?? []) {
    req(time(game.observed_at, "recent game") <= cutoff, "Future evidence in candidate snapshot");
  }
}

/**
 * Replays each prepared first-set draft turn by turn through the production solo rules.
 * State t receives ONLY selections[0..t-2]; selections[t-1] (actual action) is used for scoring only.
 * @param {unknown} dataset preparer output
 * @param {object} api production functions (see loadProductionApi)
 * @param {{ allowFixture?: boolean }} options allowFixture is for synthetic unit tests only
 */
export function evaluateCurrentDraftRules(dataset, api, options = {}) {
  req(isRecord(dataset) && dataset.schema_version === "1" && dataset.artifact_type === "draft-historical-dataset" &&
    dataset.scope === "FIRST_SET_IMMEDIATE_OPPONENT_PICK" && typeof dataset.fixture_only === "boolean" &&
    Array.isArray(dataset.snapshots) && Array.isArray(dataset.matches), "Unsupported draft evaluation dataset");
  req(!dataset.fixture_only || options.allowFixture === true, "Fixture datasets are accepted only by unit tests");
  req(isRecord(dataset.audit) && isRecord(dataset.audit.exclusions) && dataset.audit.eligible_matches === dataset.matches.length &&
    Number.isSafeInteger(dataset.audit.verified_capture_count), "Missing or inconsistent preparer audit");
  req(time(dataset.audit.last_capture_at, "audit last capture") === time(FROZEN_PROVENANCE.outcome_retrieved_at, "frozen"),
    "Preparer outcome capture must be the frozen fcd2 capture; run it on an archive without later captures");
  for (const field of ["suggestSoloDraftTurn", "explainSoloDraftTurn", "applyDraftSelection", "draftSequence", "isRadarReport", "championAssetId"]) {
    req(typeof api?.[field] === "function", `Production API missing: ${field}`);
  }
  const canonicalIds = new Map(api.SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
  const canonical = (value) => typeof value === "string" ? canonicalIds.get(api.championAssetId(value).toLowerCase()) : undefined;

  const snapshots = new Map();
  const fingerprints = new Map();
  for (const raw of dataset.snapshots) {
    validateSnapshot(raw, api, dataset.fixture_only);
    req(!snapshots.has(raw.id), "Duplicate snapshot ID");
    snapshots.set(raw.id, raw);
    fingerprints.set(raw.id, JSON.stringify(raw.report));
  }

  const overall = fresh();
  const byKind = { BAN: fresh(), PICK: fresh() };
  const byKindSide = Object.fromEntries(["BAN", "PICK"].flatMap((k) => SIDES.map((s) => [`${k}:${s}`, fresh()])));
  const byKindFirstPick = Object.fromEntries(["BAN", "PICK"].flatMap((k) => ["FIRST_PICK_TEAM", "SECOND_PICK_TEAM"].map((r) => [`${k}:${r}`, fresh()])));
  const byTeam = new Map();
  const bySource = {};
  const byEvidence = {};
  let roleUnsupported = 0, seasonEvidence = 0;
  const exclusions = {};
  const seen = new Set();
  const cases = [];
  const ordered = [...dataset.matches].sort((a, b) => compare(String(a?.observed_at), String(b?.observed_at)) || compare(String(a?.match_id), String(b?.match_id)));

  for (const raw of ordered) {
    req(isRecord(raw) && ["snapshot_id", "match_id", "league", "patch_id", "blue_team_id", "red_team_id", "outcome_source_hash"].every((f) => typeof raw[f] === "string" && raw[f]) &&
      raw.game_number === 1 && Array.isArray(raw.selections) && raw.selections.length === 20, "Invalid first-set outcome");
    req(SIDES.includes(raw.first_pick_side), "Missing or invalid first_pick_side");
    req(!seen.has(raw.match_id), "Duplicate outcome match");
    seen.add(raw.match_id);
    req(!FROZEN_PROVENANCE.forbidden_source_hashes.includes(raw.outcome_source_hash), "Forbidden outcome capture (76b7 is 2022 data)");
    req(raw.outcome_source_hash === FROZEN_PROVENANCE.outcome_source_hash, "Outcome source must be the frozen fcd2 capture");
    const snapshot = snapshots.get(raw.snapshot_id);
    req(snapshot, "Missing candidate snapshot");
    const observed = time(raw.observed_at, "observed_at");
    const outcomeAt = time(raw.outcome_retrieved_at, "outcome_retrieved_at");
    req(outcomeAt === time(FROZEN_PROVENANCE.outcome_retrieved_at, "frozen"), "Outcome retrieval time mismatch");
    req(time(snapshot.cutoff, "cutoff") < observed && observed <= outcomeAt, "Future leakage: candidate must precede the target match");
    const report = snapshot.report;
    const prep = report.opponent_prep;
    req(report.patch_id === raw.patch_id, "Patch mismatch");
    req(![...report.evidence_index.prior_match_ids, ...report.evidence_index.recent_match_ids, ...prep.teams.flatMap((t) => t.evidence.match_ids),
      ...prep.teams.flatMap((t) => (t.recent_games ?? []).map((g) => g.match_id))].includes(raw.match_id), "Target match present in candidate evidence");
    const blues = prep.teams.filter((t) => t.team_id === raw.blue_team_id);
    const reds = prep.teams.filter((t) => t.team_id === raw.red_team_id);
    req(blues.length === 1 && reds.length === 1 && raw.blue_team_id !== raw.red_team_id, "Missing or ambiguous prior team evidence");
    const sequence = api.draftSequence(raw.first_pick_side);
    let check = [];
    for (const [index, selection] of raw.selections.entries()) {
      const expected = sequence[index];
      req(isRecord(selection) && typeof selection.champion_id === "string" && selection.turn === index + 1 && selection.side === expected.side &&
        selection.kind === expected.kind && selection.slot === expected.slot && selection.phase === expected.phase, "Invalid standard draft order");
      const next = api.applyDraftSelection(check, selection.champion_id, [], raw.first_pick_side);
      req(next.length === check.length + 1, "Duplicate or empty champion in outcome");
      check = next;
    }
    // Unknown names cannot be replayed by the product; counted exclusion, never substituted.
    if (raw.selections.some((s) => !canonical(s.champion_id))) {
      exclusions.UNKNOWN_CHAMPION_ID = (exclusions.UNKNOWN_CHAMPION_ID ?? 0) + 1;
      continue;
    }
    const blueTeam = blues[0], redTeam = reds[0];
    for (let index = 0; index < 20; index++) {
      const actual = raw.selections[index];
      // Only the chronological prefix is passed; later selections are never visible to the rules.
      const prefix = structuredClone(raw.selections.slice(0, index));
      const actingSide = actual.side;
      const input = { report, blueTeam, redTeam, selections: prefix, previousPicks: [], firstPickSide: raw.first_pick_side,
        manualSide: actingSide === "BLUE" ? "RED" : "BLUE", seasonHistory: null };
      const explanation = api.explainSoloDraftTurn(input);
      const suggestion = api.suggestSoloDraftTurn(input);
      const actingTeamId = actingSide === "BLUE" ? raw.blue_team_id : raw.red_team_id;
      const team = byTeam.get(actingTeamId) ?? { BAN: fresh(), PICK: fresh() };
      byTeam.set(actingTeamId, team);
      const role = actingSide === raw.first_pick_side ? "FIRST_PICK_TEAM" : "SECOND_PICK_TEAM";
      const groups = [overall, byKind[actual.kind], byKindSide[`${actual.kind}:${actingSide}`], byKindFirstPick[`${actual.kind}:${role}`], team[actual.kind]];
      let candidates = [];
      if (explanation === null) {
        req(suggestion === null, "Production API contract: explain null but suggest non-null");
        for (const g of groups) { g.states++; g.abstentions++; }
      } else {
        req(suggestion && suggestion.champion_id === explanation.selected.champion_id, "Production API contract: selected differs from suggestSoloDraftTurn");
        req(explanation.turn === index + 1 && explanation.kind === actual.kind && explanation.side === actingSide, "Production API answered a different turn");
        candidates = [explanation.selected, ...explanation.alternatives].slice(0, CANDIDATE_COUNT).map((c) => c.champion_id);
        const illegal = candidates.filter((id) => !canonical(id) || api.applyDraftSelection(prefix, id, [], raw.first_pick_side) === prefix).length;
        const hit = (id) => canonical(id) === canonical(actual.champion_id);
        for (const g of groups) {
          g.states++;
          g.emitted_candidates += candidates.length;
          g.illegal_candidates += illegal;
          if (candidates.length < CANDIDATE_COUNT) g.short_candidate_lists++;
          if (hit(candidates[0])) g.top1_agreements++;
          if (candidates.some(hit)) g.top3_inclusions++;
        }
        bySource[explanation.selected.source] = (bySource[explanation.selected.source] ?? 0) + 1;
        byEvidence[explanation.selected.evidence] = (byEvidence[explanation.selected.evidence] ?? 0) + 1;
        if (actual.kind === "PICK" && explanation.selected.role_supported === false) roleUnsupported++;
        if (explanation.season_evidence) seasonEvidence++;
      }
      cases.push({ match_id: raw.match_id, turn: index + 1, kind: actual.kind, side: actingSide, actual: actual.champion_id, candidates });
    }
  }
  for (const [id, json] of fingerprints) req(JSON.stringify(snapshots.get(id).report) === json, "Production API mutated a snapshot");

  const evaluated = seen.size - Object.values(exclusions).reduce((a, b) => a + b, 0);
  req(overall.states === evaluated * 20, "Denominator mismatch");
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => compare(a, b)));
  const mapRates = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rates(v)]));
  return {
    schema_version: "1", artifact_type: "current-draft-rule-evaluation", evaluator_version: EVALUATOR_VERSION,
    status: dataset.fixture_only ? "FIXTURE_ONLY" : overall.states ? "EVALUATED" : "NO_ELIGIBLE_STATES",
    fixture_only: dataset.fixture_only, candidate_count: CANDIDATE_COUNT, season_history: null,
    provenance: FROZEN_PROVENANCE, claims: CLAIMS,
    denominator: { prepared_matches: seen.size, evaluator_excluded_matches: seen.size - evaluated, evaluated_matches: evaluated,
      states: overall.states, abstentions: overall.abstentions, preparer_exclusions: sortObj(dataset.audit.exclusions), evaluator_exclusions: sortObj(exclusions) },
    overall: rates(overall), by_kind: mapRates(byKind), by_kind_side: mapRates(byKindSide), by_kind_first_pick_role: mapRates(byKindFirstPick),
    selected_source_counts: sortObj(bySource), selected_evidence_counts: sortObj(byEvidence),
    pick_role_unsupported_count: roleUnsupported, season_evidence_state_count: seasonEvidence,
    boundary: "Concordance of the current solo practice-opponent rules with observed first-set professional actions, " +
      "inputs from the 2374 capture, outcomes from the fcd2 capture. Top-1 agreement is not win prediction, utility or quality. " +
      "All valid states, including abstentions, are in the denominator; states within a match are correlated. No full-season 2026 claim.",
    by_team: [...byTeam.entries()].sort(([a], [b]) => compare(a, b)).map(([team_id, g]) => ({ team_id, BAN: rates(g.BAN), PICK: rates(g.PICK) })),
    case_results: cases,
  };
}

/** Aggregate-only view safe for committing: no team IDs and no per-case rows. */
export function summarizeEvaluation(result) {
  const summary = { ...result };
  delete summary.by_team;
  delete summary.case_results;
  return summary;
}
