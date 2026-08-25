import type { OpponentTeam, RadarReport } from "./radar-types";
import type { TeamDecisionCard } from "./team-brief";

export const DECISION_JOURNAL_STORAGE_KEY = "pmi:team-decision-journal:v1";
export const MAX_DECISION_JOURNAL_ENTRIES = 250;

export const decisionJournalStates = [
  "INBOX",
  "REVIEWED",
  "SCRIM_REQUESTED",
  "ADOPTED",
  "REJECTED",
  "WATCH",
] as const;

export type DecisionJournalState = typeof decisionJournalStates[number];

export type DecisionJournalEntry = {
  decision_id: string;
  patch_id: string;
  cutoff: string;
  candidate: {
    champion_id: string;
    role: string;
    radar_rank: number;
    system_decision: TeamDecisionCard["decision"];
  };
  own_team: { team_id: string; team_name: string } | null;
  human_state: DecisionJournalState;
  analyst_note: string;
  evidence_event_ids: string[];
  source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  created_at: string;
  updated_at: string;
};

export type DecisionJournalBundle = {
  schema_version: "1";
  artifact_type: "team-decision-journal";
  storage_scope: "DEVICE_LOCAL";
  exported_at: string;
  boundary: string;
  entries: DecisionJournalEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSourceVersions(value: unknown): value is DecisionJournalEntry["source_versions"] {
  return Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    typeof item.source_id === "string" &&
    typeof item.source_version === "string" &&
    typeof item.content_hash === "string"
  ));
}

export function isDecisionJournalEntry(value: unknown): value is DecisionJournalEntry {
  if (!isRecord(value) || !isRecord(value.candidate)) return false;
  const ownTeamValid = value.own_team === null || (
    isRecord(value.own_team) &&
    typeof value.own_team.team_id === "string" &&
    typeof value.own_team.team_name === "string"
  );
  return (
    typeof value.decision_id === "string" &&
    typeof value.patch_id === "string" &&
    typeof value.cutoff === "string" &&
    typeof value.candidate.champion_id === "string" &&
    typeof value.candidate.role === "string" &&
    typeof value.candidate.radar_rank === "number" &&
    ["PRIORITY_REVIEW", "WATCH", "HOLD"].includes(String(value.candidate.system_decision)) &&
    ownTeamValid &&
    decisionJournalStates.includes(value.human_state as DecisionJournalState) &&
    typeof value.analyst_note === "string" &&
    value.analyst_note.length <= 280 &&
    isStringArray(value.evidence_event_ids) &&
    isSourceVersions(value.source_versions) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

export function decisionJournalId(
  report: Pick<RadarReport, "patch_id" | "cutoff">,
  card: TeamDecisionCard,
  ownTeam?: Pick<OpponentTeam, "team_id">,
) {
  return [
    report.patch_id,
    report.cutoff,
    ownTeam?.team_id ?? "NO_TEAM",
    card.entry.champion_id,
    card.entry.role,
  ].join("::");
}

export function createDecisionJournalEntry(
  report: RadarReport,
  card: TeamDecisionCard,
  ownTeam: OpponentTeam | undefined,
  humanState: DecisionJournalState,
  analystNote: string,
  updatedAt = new Date().toISOString(),
  previous?: DecisionJournalEntry,
): DecisionJournalEntry {
  const note = analystNote.trim().slice(0, 280);
  const id = decisionJournalId(report, card, ownTeam);
  return {
    decision_id: id,
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    candidate: {
      champion_id: card.entry.champion_id,
      role: card.entry.role,
      radar_rank: card.entry.rank,
      system_decision: card.decision,
    },
    own_team: ownTeam ? { team_id: ownTeam.team_id, team_name: ownTeam.team_name } : null,
    human_state: humanState,
    analyst_note: note,
    evidence_event_ids: [...new Set(card.entry.evidence_event_ids)].sort(),
    source_versions: report.evidence_index.source_versions.map((source) => ({ ...source })),
    created_at: previous?.decision_id === id ? previous.created_at : updatedAt,
    updated_at: updatedAt,
  };
}

export function upsertDecisionJournalEntry(
  entries: DecisionJournalEntry[],
  entry: DecisionJournalEntry,
) {
  return [entry, ...entries.filter((item) => item.decision_id !== entry.decision_id)]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, MAX_DECISION_JOURNAL_ENTRIES);
}

export function decisionJournalBundle(
  entries: DecisionJournalEntry[],
  exportedAt = new Date().toISOString(),
): DecisionJournalBundle {
  return {
    schema_version: "1",
    artifact_type: "team-decision-journal",
    storage_scope: "DEVICE_LOCAL",
    exported_at: exportedAt,
    boundary: "Device-local human decisions joined to public evidence. No server sync, login, private scrim result, player readiness, or team intent is inferred.",
    entries: entries.filter(isDecisionJournalEntry),
  };
}

export function parseDecisionJournal(raw: string | null): DecisionJournalEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schema_version !== "1" || parsed.artifact_type !== "team-decision-journal") return [];
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isDecisionJournalEntry)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, MAX_DECISION_JOURNAL_ENTRIES);
  } catch {
    return [];
  }
}

export function serializeDecisionJournal(entries: DecisionJournalEntry[], exportedAt?: string) {
  return JSON.stringify(decisionJournalBundle(entries, exportedAt), null, 2);
}
