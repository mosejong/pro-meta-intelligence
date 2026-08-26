import type { RadarEntry, RadarReport } from "./radar-types";

export const AI_HUMAN_BASELINE_STORAGE_KEY = "pmi:ai-human-baseline-drafts:v1";
export const MAX_AI_HUMAN_BASELINE_DRAFTS = 60;

export const baselineClaimOptions = [
  { id: "CLAIM:OBSERVED_GROWTH", label: "최근 공개 경기에서 사용이 늘었다" },
  { id: "CLAIM:MULTI_TEAM_ADOPTION", label: "여러 팀이 채택한 신호다" },
  { id: "CLAIM:REGIONAL_DIVERGENCE", label: "지역별 사용 차이가 크다" },
  { id: "CLAIM:CONCENTRATED_SIGNAL", label: "특정 팀에 집중된 신호다" },
  { id: "CLAIM:INSUFFICIENT_SAMPLE", label: "아직 결론을 내리기엔 표본이 부족하다" },
  { id: "CLAIM:COUNTERPOINT_REQUIRED", label: "반대 근거를 함께 제시해야 한다" },
] as const;

export const baselineBoundaryOptions = [
  { id: "BOUNDARY:PUBLIC_ONLY", label: "공개 경기에서 관측된 사실만 말한다" },
  { id: "BOUNDARY:NO_SCRIM_INFERENCE", label: "스크림·내부 계획을 추정하지 않는다" },
  { id: "BOUNDARY:NO_PLAYER_MASTERY", label: "선수 숙련도를 단정하지 않는다" },
  { id: "BOUNDARY:NO_CAUSAL_CLAIM", label: "패치 변화가 원인이라고 단정하지 않는다" },
] as const;

export const baselineCriticalErrorOptions = [
  { id: "CRITICAL:UNSUPPORTED_CLAIM", label: "제출 전 검토에서 근거 없는 주장을 발견했다" },
  { id: "CRITICAL:MISSING_BOUNDARY", label: "필수 한계 문구를 빠뜨렸다" },
  { id: "CRITICAL:WRONG_EVIDENCE", label: "다른 후보의 근거를 잘못 연결했다" },
] as const;

export type AIHumanBaselineDraft = {
  schema_version: "1";
  artifact_type: "ai-human-baseline-draft";
  draft_id: string;
  task_key: string;
  saved_at: string;
  status: "HUMAN_BASELINE_ONLY";
  snapshot: {
    cutoff: string;
    patch_id: string;
    champion_id: string;
    role: string;
    radar_rank: number;
    source_content_hashes: string[];
  };
  task: {
    task_type: "EVIDENCE_LOCKED_BRIEF";
    metrics: RadarEntry["metrics"];
    quality_flags: string[];
    available_claim_ids: string[];
    available_evidence_ids: string[];
    available_boundary_ids: string[];
    available_critical_error_ids: string[];
  };
  human: {
    claim_ids: string[];
    evidence_ids: string[];
    boundary_ids: string[];
    critical_error_ids: string[];
    duration_seconds: number;
    accepted_without_edit: boolean;
  };
  privacy: {
    analyst_identity_collected: false;
    api_key_collected: false;
    storage: "DEVICE_LOCAL_UNTIL_EXPORT";
  };
  boundary: string;
};

export function humanBaselineTaskKey(report: RadarReport, entry: RadarEntry) {
  return `${report.cutoff}::${entry.champion_id}::${entry.role}`;
}

export function humanBaselineAvailableEvidenceIds(entry: RadarEntry) {
  return unique(entry.evidence_event_ids).slice(0, 12);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function createAIHumanBaselineDraft({
  report,
  entry,
  draftId,
  savedAt,
  claimIds,
  evidenceIds,
  boundaryIds,
  criticalErrorIds,
  durationSeconds,
  acceptedWithoutEdit,
}: {
  report: RadarReport;
  entry: RadarEntry;
  draftId: string;
  savedAt: string;
  claimIds: string[];
  evidenceIds: string[];
  boundaryIds: string[];
  criticalErrorIds: string[];
  durationSeconds: number;
  acceptedWithoutEdit: boolean;
}): AIHumanBaselineDraft {
  const allowedClaims = new Set<string>(baselineClaimOptions.map((option) => option.id));
  const availableEvidence = humanBaselineAvailableEvidenceIds(entry);
  const allowedEvidence = new Set(availableEvidence);
  const allowedBoundaries = new Set<string>(baselineBoundaryOptions.map((option) => option.id));
  const allowedCriticalErrors = new Set<string>(baselineCriticalErrorOptions.map((option) => option.id));
  const selectedClaims = unique(claimIds).filter((id) => allowedClaims.has(id));
  const selectedEvidence = unique(evidenceIds).filter((id) => allowedEvidence.has(id));
  const selectedBoundaries = unique(boundaryIds).filter((id) => allowedBoundaries.has(id));
  const selectedCriticalErrors = unique(criticalErrorIds).filter((id) => allowedCriticalErrors.has(id));
  if (!draftId.trim()) throw new Error("draftId is required");
  if (!selectedClaims.length) throw new Error("at least one claim is required");
  if (!selectedEvidence.length) throw new Error("at least one evidence ID is required");
  if (!selectedBoundaries.length) throw new Error("at least one boundary is required");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("duration must be positive");

  return {
    schema_version: "1",
    artifact_type: "ai-human-baseline-draft",
    draft_id: draftId,
    task_key: humanBaselineTaskKey(report, entry),
    saved_at: savedAt,
    status: "HUMAN_BASELINE_ONLY",
    snapshot: {
      cutoff: report.cutoff,
      patch_id: report.patch_id,
      champion_id: entry.champion_id,
      role: entry.role,
      radar_rank: entry.rank,
      source_content_hashes: report.evidence_index.source_versions.map((source) => source.content_hash),
    },
    task: {
      task_type: "EVIDENCE_LOCKED_BRIEF",
      metrics: { ...entry.metrics },
      quality_flags: [...entry.quality_flags],
      available_claim_ids: baselineClaimOptions.map((option) => option.id),
      available_evidence_ids: availableEvidence,
      available_boundary_ids: baselineBoundaryOptions.map((option) => option.id),
      available_critical_error_ids: baselineCriticalErrorOptions.map((option) => option.id),
    },
    human: {
      claim_ids: selectedClaims,
      evidence_ids: selectedEvidence,
      boundary_ids: selectedBoundaries,
      critical_error_ids: selectedCriticalErrors,
      duration_seconds: Math.max(1, Math.round(durationSeconds)),
      accepted_without_edit: acceptedWithoutEdit,
    },
    privacy: {
      analyst_identity_collected: false,
      api_key_collected: false,
      storage: "DEVICE_LOCAL_UNTIL_EXPORT",
    },
    boundary: "This is an ungraded human baseline draft. It does not count toward AI validation until a sealed expert reference and paired AI output are added offline.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedStringArray(value: unknown, maximum = 256): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 500);
}

function isDraft(value: unknown): value is AIHumanBaselineDraft {
  if (!isRecord(value) || !isRecord(value.snapshot) || !isRecord(value.task) || !isRecord(value.human) || !isRecord(value.privacy)) return false;
  const snapshot = value.snapshot;
  const task = value.task;
  const human = value.human;
  const privacy = value.privacy;
  return value.schema_version === "1"
    && value.artifact_type === "ai-human-baseline-draft"
    && value.status === "HUMAN_BASELINE_ONLY"
    && typeof value.draft_id === "string" && value.draft_id.length > 0 && value.draft_id.length <= 200
    && typeof value.task_key === "string" && value.task_key.length > 0 && value.task_key.length <= 500
    && typeof value.saved_at === "string"
    && typeof snapshot.cutoff === "string"
    && typeof snapshot.patch_id === "string"
    && typeof snapshot.champion_id === "string"
    && typeof snapshot.role === "string"
    && typeof snapshot.radar_rank === "number" && Number.isFinite(snapshot.radar_rank)
    && isBoundedStringArray(snapshot.source_content_hashes)
    && task.task_type === "EVIDENCE_LOCKED_BRIEF"
    && isRecord(task.metrics)
    && isBoundedStringArray(task.quality_flags)
    && isBoundedStringArray(task.available_claim_ids, 20)
    && isBoundedStringArray(task.available_evidence_ids)
    && isBoundedStringArray(task.available_boundary_ids, 20)
    && isBoundedStringArray(task.available_critical_error_ids, 20)
    && isBoundedStringArray(human.claim_ids, 20)
    && isBoundedStringArray(human.evidence_ids)
    && isBoundedStringArray(human.boundary_ids, 20)
    && isBoundedStringArray(human.critical_error_ids, 20)
    && typeof human.duration_seconds === "number" && Number.isFinite(human.duration_seconds) && human.duration_seconds > 0
    && typeof human.accepted_without_edit === "boolean"
    && privacy.analyst_identity_collected === false
    && privacy.api_key_collected === false
    && privacy.storage === "DEVICE_LOCAL_UNTIL_EXPORT";
}

export function parseAIHumanBaselineDrafts(raw: string | null): AIHumanBaselineDraft[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraft).slice(-MAX_AI_HUMAN_BASELINE_DRAFTS);
  } catch {
    return [];
  }
}

export function upsertAIHumanBaselineDraft(drafts: AIHumanBaselineDraft[], draft: AIHumanBaselineDraft) {
  return [...drafts.filter((item) => item.task_key !== draft.task_key), draft]
    .slice(-MAX_AI_HUMAN_BASELINE_DRAFTS);
}

export function serializeAIHumanBaselineDrafts(drafts: AIHumanBaselineDraft[]) {
  return JSON.stringify(drafts.slice(-MAX_AI_HUMAN_BASELINE_DRAFTS));
}

export function exportAIHumanBaselineBundle(drafts: AIHumanBaselineDraft[], exportedAt: string) {
  return JSON.stringify({
    schema_version: "1",
    artifact_type: "ai-human-baseline-draft-bundle",
    exported_at: exportedAt,
    case_count: drafts.length,
    cases: drafts,
    contains_expert_reference: false,
    contains_ai_output: false,
    ready_for_release_evaluation: false,
    next_action: "ADD_SEALED_REFERENCE_AND_PAIRED_AI_OUTPUT_OFFLINE",
  }, null, 2);
}
