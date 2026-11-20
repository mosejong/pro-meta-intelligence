// OPTIONAL full-evidence research path (separately versioned) for the frozen current-draft evaluation.
//
// The frozen baseline (current-draft-evaluation-lib.mjs, protocol commit 30525faf) passes
// seasonHistory = null and is NOT changed. This wrapper replays the same prepared cohort through
// the same unchanged production solo functions, through the base evaluator itself. The only
// difference is that each state also receives the season history built by
// ops/prepare_current_draft_season_evidence.py for that state's snapshot (2374 capture only, as of
// its cutoff, roster basis of the historical snapshot report).
//
// The base cohort was already observed and the baseline lacked season evidence, so any comparison
// with the baseline is an EXPLORATORY INTEGRATION DIAGNOSTIC. It is never a new confirmatory trial,
// a fresh holdout or proof of utility. There is no fallback: missing or mismatched evidence throws,
// and no published or live season file is ever read or fetched.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  CANDIDATE_COUNT, CLAIMS as BASE_CLAIMS, EVALUATOR_VERSION as BASE_EVALUATOR_VERSION, FROZEN_PROVENANCE,
  evaluateCurrentDraftRules, loadProductionApi, summarizeEvaluation,
} from "./current-draft-evaluation-lib.mjs";

export const SEASON_EVALUATOR_VERSION = "current-solo-rule-concordance-season-v1";
export const EVIDENCE_ARTIFACT_TYPE = "current-draft-season-evidence";
export const EVIDENCE_PREPARER_VERSION = "current-draft-season-evidence-v1";
export const SEASON_YEAR = 2026;
export const FROZEN_BASE_PROTOCOL_COMMIT = "30525faf";
export const OE_SOURCE_ID = "oracles-elixir-match-data";
export { CANDIDATE_COUNT, summarizeEvaluation };

export const SEASON_CLAIMS = Object.freeze([
  ...BASE_CLAIMS.filter((claim) => claim !== "SEASON_HISTORY_NOT_SUPPLIED"),
  "SEASON_HISTORY_FROM_2374_CAPTURE_ONLY", "SEASON_HISTORY_AS_OF_2374_CUTOFF", "ROSTER_BASIS_FROM_HISTORICAL_SNAPSHOT",
  "NO_PUBLISHED_OR_LIVE_HISTORY_FALLBACK", "BASE_COHORT_ALREADY_OBSERVED", "BASELINE_MISSING_SEASON_HISTORY",
  "EXPLORATORY_INTEGRATION_DIAGNOSTIC", "NOT_A_CONFIRMATORY_TRIAL", "NOT_A_FRESH_HOLDOUT", "NOT_PROOF_OF_UTILITY",
]);

/** Base production API plus the production season parser and roster basis (unchanged modules). */
export async function loadSeasonApi() {
  const { vite, api } = await loadProductionApi();
  try {
    const season = await vite.ssrLoadModule("/app/player-season-history.ts");
    const roster = await vite.ssrLoadModule("/app/roster-scenario.ts");
    return { vite, api: { ...api, parsePlayerSeasonHistory: season.parsePlayerSeasonHistory, rosterBasis: roster.rosterBasis } };
  } catch (error) { await vite.close(); throw error; }
}

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function req(condition, message) { if (!condition) throw new Error(message); }
const sha256 = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const pairKey = (teamId, playerId) => JSON.stringify([teamId, playerId]);

function rosterPairs(report) {
  // Same reference set as player_season.roster_references_from_feed: every profile with a player_id.
  const pairs = new Set();
  for (const team of report.opponent_prep?.teams ?? []) {
    for (const profile of team.player_profiles ?? []) if (profile?.player_id) pairs.add(pairKey(team.team_id, profile.player_id));
  }
  return pairs;
}

/**
 * Strictly cross-validates the season evidence against the prepared dataset; returns report -> SeasonHistory.
 * Any mismatch (dataset hash, source hash/time, cutoff, year, roster basis, roster set, history hash) throws.
 */
export function validateSeasonEvidence(dataset, datasetSha256, evidence, api, options = {}) {
  req(typeof api?.parsePlayerSeasonHistory === "function" && typeof api?.rosterBasis === "function", "Season API missing: use loadSeasonApi");
  req(isRecord(evidence), "Season evidence required: no fallback to published or live history");
  req(evidence.schema_version === "1" && evidence.artifact_type === EVIDENCE_ARTIFACT_TYPE && evidence.preparer_version === EVIDENCE_PREPARER_VERSION,
    "Unsupported season evidence artifact");
  req(typeof datasetSha256 === "string" && /^sha256:[0-9a-f]{64}$/.test(datasetSha256) && evidence.dataset_sha256 === datasetSha256,
    "Season evidence was built from a different prepared dataset");
  req(evidence.season === SEASON_YEAR, "Season evidence year mismatch");
  const source = evidence.source;
  req(isRecord(source) && source.source_id === OE_SOURCE_ID && typeof source.source_version === "string" && source.source_version, "Invalid season source");
  req(!FROZEN_PROVENANCE.forbidden_source_hashes.includes(source.content_hash) && source.content_hash !== FROZEN_PROVENANCE.outcome_source_hash,
    "Forbidden season source (outcome capture or 2022 data)");
  req(source.content_hash === FROZEN_PROVENANCE.candidate_source_hash, "Season source must be the frozen 2374 capture");
  req(typeof source.retrieved_at === "string" && source.retrieved_at === FROZEN_PROVENANCE.candidate_retrieved_at, "Season source retrieval time must be the 2374 capture time");
  for (const claim of ["BASE_COHORT_ALREADY_OBSERVED", "BASELINE_MISSING_SEASON_HISTORY", "EXPLORATORY_INTEGRATION_DIAGNOSTIC", "NOT_A_CONFIRMATORY_TRIAL"]) {
    req(Array.isArray(evidence.claims) && evidence.claims.includes(claim), `Season evidence must declare ${claim}`);
  }
  req(isRecord(dataset) && Array.isArray(dataset.snapshots) && Array.isArray(evidence.histories), "Invalid dataset or season histories");
  req(!dataset.fixture_only || options.allowFixture === true, "Fixture datasets are accepted only by unit tests");

  const entries = new Map();
  for (const entry of evidence.histories) {
    req(isRecord(entry) && typeof entry.snapshot_id === "string" && !entries.has(entry.snapshot_id), "Missing or duplicate season history snapshot");
    entries.set(entry.snapshot_id, entry);
  }
  const snapshotIds = new Set(dataset.snapshots.map((snapshot) => snapshot?.id));
  req(snapshotIds.size === dataset.snapshots.length && snapshotIds.size === entries.size && [...snapshotIds].every((id) => entries.has(id)),
    "Season histories must cover exactly the prepared snapshots");

  const byReport = new Map();
  const summary = [];
  for (const snapshot of dataset.snapshots) {
    const report = snapshot.report;
    req(isRecord(report) && isRecord(report.opponent_prep), "Invalid candidate snapshot report");
    const entry = entries.get(snapshot.id);
    req(typeof entry.history_json === "string" && sha256(entry.history_json) === entry.history_sha256, "Season history hash mismatch");
    const basis = api.rosterBasis(report);
    req(isDeepStrictEqual(entry.roster_basis, basis), "Season history roster basis differs from the snapshot report");
    req(entry.cutoff === report.cutoff && entry.cutoff === snapshot.cutoff && entry.cutoff === FROZEN_PROVENANCE.candidate_retrieved_at,
      "Season history cutoff must be exactly the snapshot (2374 capture) cutoff");
    const year = new Date(Date.parse(report.cutoff)).getUTCFullYear();
    req(entry.season === SEASON_YEAR && year === SEASON_YEAR, "Season history year must equal the cutoff year");
    req(entry.patch_id === report.patch_id, "Season history patch mismatch");
    const sources = [...(report.evidence_index?.source_versions ?? []), ...(report.opponent_prep.evidence_index?.source_versions ?? [])];
    req(sources.length > 0 && sources.every((item) => item.source_id === OE_SOURCE_ID && item.content_hash === source.content_hash &&
      item.source_version === source.source_version), "Snapshot evidence does not cite the season source version");
    const parsed = api.parsePlayerSeasonHistory(entry.history_json, { basis, season: year });
    req(parsed?.ok === true, `Season history rejected by the production parser: ${parsed?.code ?? "UNKNOWN"}`);
    const history = parsed.value;
    req(history.cutoff === report.cutoff && history.reference_patch === report.patch_id && history.season === year, "Season history does not match its snapshot");
    req(history.source.source_id === source.source_id && history.source.source_version === source.source_version &&
      history.source.content_hash === source.content_hash && history.source.retrieved_at === source.retrieved_at, "Season history source differs from the evidence source");
    req(Date.parse(history.source.retrieved_at) <= Date.parse(report.cutoff), "Season history source is after the cutoff");
    const expected = rosterPairs(report);
    const actual = new Set([...history.players.values()].map((player) => pairKey(player.team_id, player.player_id)));
    req(expected.size > 0 && expected.size === actual.size && [...expected].every((key) => actual.has(key)),
      "Season history players differ from the snapshot roster references");
    req(!byReport.has(report), "Snapshots share one report object");
    byReport.set(report, history);
    summary.push({
      snapshot_id: snapshot.id, cutoff: history.cutoff, season: history.season, reference_patch: history.reference_patch,
      history_sha256: entry.history_sha256, player_count: history.players.size,
      found_player_count: [...history.players.values()].filter((player) => player.status === "FOUND").length,
    });
  }
  return { byReport, summary };
}

/**
 * Same cohort, same base evaluator, same production solo functions and fixed candidate count;
 * each state additionally receives its snapshot's validated season history.
 */
export function evaluateWithSeasonEvidence(dataset, datasetSha256, evidence, api, options = {}) {
  const { byReport, summary } = validateSeasonEvidence(dataset, datasetSha256, evidence, api, options);
  const withHistory = (name) => (input) => {
    req(input.seasonHistory === null, "Base evaluator contract changed: expected seasonHistory = null");
    const history = byReport.get(input.report);
    req(history, "No season history for this state's snapshot (no fallback)");
    return api[name]({ ...input, seasonHistory: history });
  };
  const wrapped = { ...api, explainSoloDraftTurn: withHistory("explainSoloDraftTurn"), suggestSoloDraftTurn: withHistory("suggestSoloDraftTurn") };
  const result = evaluateCurrentDraftRules(dataset, wrapped, options);
  return {
    ...result,
    artifact_type: "current-draft-rule-season-evaluation",
    evaluator_version: SEASON_EVALUATOR_VERSION,
    base_evaluator_version: BASE_EVALUATOR_VERSION,
    candidate_count: CANDIDATE_COUNT,
    claims: SEASON_CLAIMS,
    season_history: {
      source: { ...evidence.source }, season: evidence.season, dataset_sha256: evidence.dataset_sha256,
      preparer_version: evidence.preparer_version, snapshots: summary,
    },
    base_cohort: {
      frozen_protocol_commit: FROZEN_BASE_PROTOCOL_COMMIT, baseline_season_history: null, already_observed: true,
      note: "The baseline (seasonHistory = null) was run on this same cohort and already observed before this path existed.",
    },
    comparison_status: "EXPLORATORY_INTEGRATION_DIAGNOSTIC",
    boundary: `${result.boundary} Season evidence was added after the baseline cohort was observed: any difference from the baseline ` +
      "is an exploratory integration diagnostic, not a confirmatory trial, fresh holdout or proof of utility.",
  };
}
