import type { DecisionJournalEntry } from "./decision-journal";

type SourceVersion = {
  source_id: string;
  source_version: string;
  content_hash: string;
};

export type DecisionOutcomeAdoption = {
  champion_id: string;
  role: string;
  confirmed_at: string | null;
  future_pick_count: number | null;
  future_distinct_team_count: number | null;
  outcome_match_ids: string[];
  outcome_event_ids: string[];
};

export type SelectedDecisionOutcome = DecisionOutcomeAdoption & {
  radar_rank: number | null;
  outcome: "HIT" | "FALSE_ALERT";
  candidate_evidence_event_ids: string[];
  pre_cutoff: {
    pick_presence: number | null;
    pick_presence_delta: number | null;
    demand_velocity: number | null;
  };
};

export type DecisionOutcomeEvaluation = {
  evaluation_id: string;
  cutoff: string;
  outcome_end: string;
  patch_id: string;
  selected_candidates: SelectedDecisionOutcome[];
  missed_adoptions: DecisionOutcomeAdoption[];
  source_versions: SourceVersion[];
};

export type DecisionOutcomesFeed = {
  schema_version: "1";
  artifact_type: "team-decision-outcomes";
  as_of: string;
  status: string;
  benchmark_ready: boolean;
  summary: {
    evaluated_cutoff_count: number;
    selected_candidate_count: number;
    hit_count: number;
    false_alert_count: number;
    missed_adoption_count: number;
  };
  evaluations: DecisionOutcomeEvaluation[];
};

export type DecisionOutcomeResolution =
  | { status: "NOT_RECORDED"; match: null }
  | { status: "UNAVAILABLE"; match: null }
  | { status: "WAITING_FOR_HISTORY"; match: null }
  | { status: "WAITING_FOR_CUTOFF"; match: null }
  | { status: "NOT_EVALUATED"; match: "EXACT_CUTOFF" | "SOURCE_STATE"; evaluation: DecisionOutcomeEvaluation }
  | { status: "HIT" | "FALSE_ALERT"; match: "EXACT_CUTOFF" | "SOURCE_STATE"; evaluation: DecisionOutcomeEvaluation; candidate: SelectedDecisionOutcome }
  | { status: "MISSED_ADOPTION"; match: "EXACT_CUTOFF" | "SOURCE_STATE"; evaluation: DecisionOutcomeEvaluation; adoption: DecisionOutcomeAdoption };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isSourceVersion(value: unknown): value is SourceVersion {
  return isRecord(value) &&
    typeof value.source_id === "string" &&
    typeof value.source_version === "string" &&
    typeof value.content_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(value.content_hash);
}

function isAdoption(value: unknown): value is DecisionOutcomeAdoption {
  return isRecord(value) &&
    typeof value.champion_id === "string" &&
    typeof value.role === "string" &&
    (value.confirmed_at === null || typeof value.confirmed_at === "string") &&
    isNullableNumber(value.future_pick_count) &&
    isNullableNumber(value.future_distinct_team_count) &&
    isStringArray(value.outcome_match_ids) &&
    isStringArray(value.outcome_event_ids);
}

function isSelected(value: unknown): value is SelectedDecisionOutcome {
  return isAdoption(value) &&
    (value.outcome === "HIT" || value.outcome === "FALSE_ALERT") &&
    isNullableNumber(value.radar_rank) &&
    isStringArray(value.candidate_evidence_event_ids) &&
    isRecord(value.pre_cutoff) &&
    isNullableNumber(value.pre_cutoff.pick_presence) &&
    isNullableNumber(value.pre_cutoff.pick_presence_delta) &&
    isNullableNumber(value.pre_cutoff.demand_velocity);
}

function isEvaluation(value: unknown): value is DecisionOutcomeEvaluation {
  return isRecord(value) &&
    typeof value.evaluation_id === "string" &&
    typeof value.cutoff === "string" &&
    typeof value.outcome_end === "string" &&
    typeof value.patch_id === "string" &&
    Array.isArray(value.selected_candidates) && value.selected_candidates.every(isSelected) &&
    Array.isArray(value.missed_adoptions) && value.missed_adoptions.every(isAdoption) &&
    Array.isArray(value.source_versions) && value.source_versions.every(isSourceVersion);
}

export function isDecisionOutcomesFeed(value: unknown): value is DecisionOutcomesFeed {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.evaluations)) return false;
  const counts = [
    value.summary.evaluated_cutoff_count,
    value.summary.selected_candidate_count,
    value.summary.hit_count,
    value.summary.false_alert_count,
    value.summary.missed_adoption_count,
  ];
  const evaluated = value.evaluations.filter(isEvaluation);
  const selected = evaluated.flatMap((evaluation) => evaluation.selected_candidates);
  const summaryMatches =
    value.summary.evaluated_cutoff_count === evaluated.length &&
    value.summary.selected_candidate_count === selected.length &&
    value.summary.hit_count === selected.filter((candidate) => candidate.outcome === "HIT").length &&
    value.summary.false_alert_count === selected.filter((candidate) => candidate.outcome === "FALSE_ALERT").length &&
    value.summary.missed_adoption_count === evaluated.reduce((count, evaluation) => count + evaluation.missed_adoptions.length, 0);
  return value.schema_version === "1" &&
    value.artifact_type === "team-decision-outcomes" &&
    typeof value.as_of === "string" && Boolean(value.as_of) &&
    typeof value.status === "string" &&
    typeof value.benchmark_ready === "boolean" &&
    counts.every((count) => Number.isInteger(count) && Number(count) >= 0) &&
    evaluated.length === value.evaluations.length &&
    summaryMatches &&
    (value.benchmark_ready
      ? value.status === "COMPLETE" && value.evaluations.length > 0
      : ["HISTORY_NOT_READY", "NO_EVALUABLE_CUTOFFS"].includes(value.status) && value.evaluations.length === 0);
}

function sameSourceState(entry: DecisionJournalEntry, evaluation: DecisionOutcomeEvaluation) {
  return entry.source_versions.some((journalSource) => evaluation.source_versions.some(
    (source) => source.source_id === journalSource.source_id && source.content_hash === journalSource.content_hash,
  ));
}

export function reconcileDecisionOutcome(
  entry: DecisionJournalEntry | undefined,
  feed: DecisionOutcomesFeed | null,
): DecisionOutcomeResolution {
  if (!entry) return { status: "NOT_RECORDED", match: null };
  if (!feed) return { status: "UNAVAILABLE", match: null };
  if (!feed.benchmark_ready) return { status: "WAITING_FOR_HISTORY", match: null };

  const exact = feed.evaluations.find(
    (evaluation) => evaluation.patch_id === entry.patch_id && evaluation.cutoff === entry.cutoff,
  );
  const sourceState = feed.evaluations
    .filter((evaluation) => (
      evaluation.patch_id === entry.patch_id &&
      Date.parse(evaluation.cutoff) <= Date.parse(entry.cutoff) &&
      sameSourceState(entry, evaluation)
    ))
    .sort((left, right) => Date.parse(right.cutoff) - Date.parse(left.cutoff))[0];
  const evaluation = exact ?? sourceState;
  if (!evaluation) return { status: "WAITING_FOR_CUTOFF", match: null };
  const match = exact ? "EXACT_CUTOFF" : "SOURCE_STATE";
  const candidate = evaluation.selected_candidates.find((item) => (
    item.champion_id === entry.candidate.champion_id && item.role === entry.candidate.role
  ));
  if (candidate) return { status: candidate.outcome, match, evaluation, candidate };
  const adoption = evaluation.missed_adoptions.find((item) => (
    item.champion_id === entry.candidate.champion_id && item.role === entry.candidate.role
  ));
  if (adoption) return { status: "MISSED_ADOPTION", match, evaluation, adoption };
  return { status: "NOT_EVALUATED", match, evaluation };
}
