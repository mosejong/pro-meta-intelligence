import { championAssetId } from "./champion-assets";
import { applyDraftSelection, DRAFT_MODEL_VERSION, isChampionLocked, previewOpponentPick, STANDARD_DRAFT_SEQUENCE, type DraftSelection } from "./draft-agent";
import { isRadarReport, type OpponentTeam, type RadarReport } from "./radar-types";
import { previewRoleExperiment, ROLE_EXPERIMENT_VERSION } from "./draft-role-experiment";

type Snapshot = { id: string; cutoff: string; source_hash: string; report: RadarReport };
type Match = {
  snapshot_id: string; match_id: string; game_number: number; league: string; patch_id: string;
  observed_at: string; outcome_retrieved_at: string; outcome_source_hash: string;
  blue_team_id: string; red_team_id: string; selections: DraftSelection[];
};
type Metrics = { cases: number; covered: number; top1_hits: number; top3_hits: number; reciprocal_rank_sum: number; illegal_candidates: number; emitted_candidates: number };
const key = (id: string) => championAssetId(id).toLowerCase();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const freshMetrics = (): Metrics => ({ cases: 0, covered: 0, top1_hits: 0, top3_hits: 0, reciprocal_rank_sum: 0, illegal_candidates: 0, emitted_candidates: 0 });

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Timezone-aware timestamp required");
  return Date.parse(value);
}
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function baseline(team: OpponentTeam, prefix: DraftSelection[]) {
  const candidates = [...team.priority_picks].sort((a, b) => b.game_rate - a.game_rate || compare(key(a.champion_id), key(b.champion_id)));
  return [...new Set(candidates.map((item) => key(item.champion_id)))].filter((id) => !isChampionLocked(prefix, id)).slice(0, 3);
}
function add(metrics: Metrics, candidates: string[], actual: string, prefix: DraftSelection[]) {
  metrics.cases++;
  if (candidates.length) metrics.covered++;
  const position = candidates.findIndex((id) => key(id) === key(actual));
  if (position === 0) metrics.top1_hits++;
  if (position >= 0) { metrics.top3_hits++; metrics.reciprocal_rank_sum += 1 / (position + 1); }
  metrics.illegal_candidates += candidates.filter((id) => isChampionLocked(prefix, id)).length;
  metrics.emitted_candidates += candidates.length;
}
function summarize(metrics: Metrics) {
  const rate = (value: number) => metrics.cases ? Number((value / metrics.cases).toFixed(6)) : null;
  return { ...metrics, coverage: rate(metrics.covered), top1_accuracy: rate(metrics.top1_hits),
    top3_recall: rate(metrics.top3_hits), mrr_at_3: rate(metrics.reciprocal_rank_sum),
    illegal_candidate_rate: metrics.emitted_candidates ? metrics.illegal_candidates / metrics.emitted_candidates : null };
}

/** Scores the production preview itself, not a second approximation of its formula. */
export function evaluateDraftBenchmark(value: unknown, options: { roleExperiment?: boolean } = {}) {
  requireCondition(record(value) && value.schema_version === "1" && value.artifact_type === "draft-historical-dataset" &&
    value.scope === "FIRST_SET_IMMEDIATE_OPPONENT_PICK" && typeof value.fixture_only === "boolean" &&
    Array.isArray(value.snapshots) && Array.isArray(value.matches), "Unsupported draft evaluation dataset");
  const snapshots = new Map<string, Snapshot>();
  for (const raw of value.snapshots) {
    requireCondition(record(raw) && typeof raw.id === "string" && typeof raw.source_hash === "string" && /^sha256:[0-9a-f]{64}$/.test(raw.source_hash) && isRadarReport(raw.report) && raw.report.opponent_prep, "Invalid candidate snapshot");
    requireCondition(!snapshots.has(raw.id), "Duplicate snapshot ID");
    const cutoff = timestamp(raw.cutoff);
    requireCondition(cutoff === timestamp(raw.report.cutoff) && cutoff === timestamp(raw.report.opponent_prep.cutoff), "Snapshot cutoff mismatch");
    requireCondition(raw.report.fixture_only === value.fixture_only && raw.report.opponent_prep.fixture_only === value.fixture_only, "Fixture/real data mismatch");
    requireCondition(raw.report.opponent_prep.teams.every((team) => Number.isSafeInteger(team.game_count) && team.game_count >= 0 && team.priority_picks.every((pick) => Number.isFinite(pick.game_rate) && pick.game_rate >= 0 && pick.game_rate <= 1 && Number.isSafeInteger(pick.phase_1_count) && pick.phase_1_count >= 0)) && raw.report.entries.every((entry) => Number.isSafeInteger(entry.rank) && entry.rank > 0), "Invalid ranking inputs");
    const sources = [...raw.report.evidence_index.source_versions, ...raw.report.opponent_prep.evidence_index.source_versions];
    requireCondition(sources.length > 0 && sources.every((source) => source.content_hash === raw.source_hash), "Candidate source provenance mismatch");
    snapshots.set(raw.id, raw as unknown as Snapshot);
  }
  const model = freshMetrics();
  const control = freshMetrics();
  const experiment = freshMetrics();
  const experimentalGroups = new Map<string, { matches: number; model: Metrics; production: Metrics }>();
  const seen = new Set<string>();
  const leagues = new Map<string, { model: Metrics; baseline: Metrics; matches: number }>();
  const sourcePairs = new Set<string>();
  const cases: Array<{ match_id: string; target_turn: number; actual: string; model: string[]; baseline: string[]; snapshot_id: string }> = [];
  const orderedMatches = [...value.matches].sort((a, b) => compare(record(a) ? String(a.match_id) : "", record(b) ? String(b.match_id) : ""));
  for (const raw of orderedMatches) {
    requireCondition(record(raw) && ["snapshot_id", "match_id", "league", "patch_id", "blue_team_id", "red_team_id", "outcome_source_hash"].every((field) => typeof raw[field] === "string") && raw.game_number === 1 && Array.isArray(raw.selections) && raw.selections.length === 20, "Invalid first-set outcome");
    const match = raw as unknown as Match;
    requireCondition(!seen.has(match.match_id), "Duplicate outcome match");
    seen.add(match.match_id);
    const snapshot = snapshots.get(match.snapshot_id);
    requireCondition(snapshot, "Missing candidate snapshot");
    const observed = timestamp(match.observed_at);
    requireCondition(timestamp(snapshot.cutoff) < observed && observed <= timestamp(match.outcome_retrieved_at), "Future leakage: candidate must precede the target match");
    requireCondition(/^sha256:[0-9a-f]{64}$/.test(match.outcome_source_hash) && snapshot.source_hash !== match.outcome_source_hash, "Outcome must use a distinct later source");
    const report = snapshot.report;
    const teams = report.opponent_prep!.teams;
    if (options.roleExperiment) {
      requireCondition(teams.every((team) => (team.recent_games ?? []).every((game) =>
        game.match_id !== match.match_id && timestamp(game.observed_at) <= timestamp(snapshot.cutoff))), "Future role evidence");
    }
    requireCondition(report.patch_id === match.patch_id && report.opponent_prep!.patch_id === match.patch_id, "Patch mismatch");
    requireCondition(![...report.evidence_index.prior_match_ids, ...report.evidence_index.recent_match_ids, ...teams.flatMap((team) => team.evidence.match_ids)].includes(match.match_id), "Target match present in candidate evidence");
    const blue = teams.find((team) => team.team_id === match.blue_team_id);
    const red = teams.find((team) => team.team_id === match.red_team_id);
    requireCondition(blue && red && blue.team_id !== red.team_id, "Missing prior team evidence");
    let prefix: DraftSelection[] = [];
    for (const [index, selection] of match.selections.entries()) {
      const expected = STANDARD_DRAFT_SEQUENCE[index];
      requireCondition(record(selection) && typeof selection.champion_id === "string" && selection.turn === index + 1 &&
        selection.side === expected.side && selection.kind === expected.kind && selection.slot === expected.slot && selection.phase === expected.phase, "Invalid standard draft order");
      const next = applyDraftSelection(prefix, selection.champion_id);
      requireCondition(next.length === prefix.length + 1, "Duplicate or empty champion in outcome");
      prefix = next;
    }
    const group = leagues.get(match.league) ?? { model: freshMetrics(), baseline: freshMetrics(), matches: 0 };
    group.matches++;
    leagues.set(match.league, group);
    const experimentKey = `${match.league}:${match.patch_id}`;
    const experimentGroup = experimentalGroups.get(experimentKey) ?? { matches: 0, model: freshMetrics(), production: freshMetrics() };
    experimentGroup.matches++;
    experimentalGroups.set(experimentKey, experimentGroup);
    sourcePairs.add(`${snapshot.source_hash}:${match.outcome_source_hash}`);
    prefix = [];
    for (const [index, staged] of match.selections.entries()) {
      const target = match.selections[index + 1];
      if (target?.kind === "PICK" && target.side !== staged.side) {
        const preview = previewOpponentPick(report, blue, red, prefix, staged.champion_id);
        requireCondition(preview.status === "READY" && preview.target_turn === target.turn && preview.intervening_turns === 0, "Production preview did not match evaluation turn");
        const hypothetical = applyDraftSelection(prefix, staged.champion_id);
        const predictions = preview.candidates.map((candidate) => candidate.champion_id);
        const expectedTeam = target.side === "BLUE" ? blue : red;
        const simple = baseline(expectedTeam, hypothetical);
        add(model, predictions, target.champion_id, hypothetical);
        add(control, simple, target.champion_id, hypothetical);
        add(group.model, predictions, target.champion_id, hypothetical);
        add(group.baseline, simple, target.champion_id, hypothetical);
        if (options.roleExperiment) {
          const rolePreview = previewRoleExperiment(report, blue, red, prefix, staged.champion_id);
          const rolePredictions = rolePreview.candidates.map((candidate) => candidate.champion_id);
          add(experiment, rolePredictions, target.champion_id, hypothetical);
          add(experimentGroup.model, rolePredictions, target.champion_id, hypothetical);
          add(experimentGroup.production, predictions, target.champion_id, hypothetical);
        }
        cases.push({ match_id: match.match_id, target_turn: target.turn, actual: target.champion_id, model: predictions, baseline: simple, snapshot_id: snapshot.id });
      }
      prefix = applyDraftSelection(prefix, staged.champion_id);
    }
  }
  const modelSummary = summarize(model);
  const baselineSummary = summarize(control);
  return {
    schema_version: "1", artifact_type: "draft-historical-benchmark", model_version: DRAFT_MODEL_VERSION,
    status: value.fixture_only ? "FIXTURE_ONLY" : cases.length ? "PILOT_COMPLETE" : "NO_ELIGIBLE_CASES",
    fixture_only: value.fixture_only, scope: value.scope, match_count: seen.size, case_count: cases.length,
    source_pair_count: sourcePairs.size, model: modelSummary, baseline: baselineSummary,
    top3_recall_delta: cases.length ? Number(((modelSummary.top3_recall ?? 0) - (baselineSummary.top3_recall ?? 0)).toFixed(6)) : null,
    by_league: [...leagues.entries()].sort(([a], [b]) => compare(a, b)).map(([league, group]) => ({ league, matches: group.matches, model: summarize(group.model), baseline: summarize(group.baseline) })),
    boundary: "Pilot only. First sets and immediate opposite-side pick responses only; all eligible states, including abstentions, are in the denominator. Cases within a match are correlated. No multi-set Fearless, counterfactual, calibrated probability, or superiority claim.",
    case_results: cases,
    ...(options.roleExperiment ? { role_experiment: {
      version: ROLE_EXPERIMENT_VERSION, deployed: false, metrics: summarize(experiment),
      by_league_patch: [...experimentalGroups.entries()].sort(([a], [b]) => compare(a, b)).map(([league_patch, group]) => ({ league_patch, matches: group.matches, experiment: summarize(group.model), production: summarize(group.production) })),
      boundary: "Observed same-snapshot role feasibility only. Unknown roles remain unrestricted; flex roles remain alternatives. No counter or synergy knowledge. No automatic promotion.",
    } } : {}),
  };
}
