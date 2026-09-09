export const COLLECTION_STATES = [
  "CURRENT",
  "SOURCE_DELAYED",
  "SOURCE_UNAVAILABLE",
  "PUBLICATION_REJECTED",
  "RUN_FAILED",
  "UNKNOWN",
] as const;

export type CollectionState = (typeof COLLECTION_STATES)[number];

export const COLLECTION_REASON_CODES = [
  "NONE",
  "PROVIDER_QUOTA_OR_HTML_RESPONSE",
  "PROVIDER_SCHEMA_REJECTED",
  "PROVIDER_REQUEST_FAILED",
  "POLICY_INTERVAL_ACTIVE_AFTER_SOURCE_ERROR",
  "READINESS_GATE_REJECTED",
  "COLLECTOR_JOB_FAILED",
  "UNKNOWN_RESULT",
] as const;

export type CollectionReasonCode = (typeof COLLECTION_REASON_CODES)[number];

export type CollectionStatus = {
  schema_version: "1";
  artifact_type: "oe-collection-status";
  updated_at: string;
  state: CollectionState;
  reason_code: CollectionReasonCode;
  last_attempt: {
    started_at: string;
    finished_at: string;
    job_status: string;
    exit_code: number | null;
    network_request_performed: boolean;
  };
  source: {
    source_id: string;
    acquisition_status: string;
    last_verified_at: string | null;
    next_attempt_at?: string | null;
  };
  publication: {
    result_status: string;
    head_accepted: boolean;
    history_status: string | null;
  };
  automation: {
    retry_mode: "AUTOMATIC_POLICY_GATED";
    operator_action_required: boolean;
  };
  boundary: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isCollectionStatus(value: unknown): value is CollectionStatus {
  if (!isRecord(value) || value.schema_version !== "1" || value.artifact_type !== "oe-collection-status") return false;
  if (!isTimestamp(value.updated_at) || !COLLECTION_STATES.includes(value.state as CollectionState)) return false;
  if (!COLLECTION_REASON_CODES.includes(value.reason_code as CollectionReasonCode) || typeof value.boundary !== "string") return false;
  const attempt = value.last_attempt;
  const source = value.source;
  const publication = value.publication;
  const automation = value.automation;
  return isRecord(attempt)
    && isTimestamp(attempt.started_at)
    && isTimestamp(attempt.finished_at)
    && typeof attempt.job_status === "string"
    && (attempt.exit_code === null || Number.isInteger(attempt.exit_code))
    && typeof attempt.network_request_performed === "boolean"
    && isRecord(source)
    && typeof source.source_id === "string"
    && typeof source.acquisition_status === "string"
    && (source.last_verified_at === null || isTimestamp(source.last_verified_at))
    && (source.next_attempt_at === undefined || source.next_attempt_at === null || isTimestamp(source.next_attempt_at))
    && isRecord(publication)
    && typeof publication.result_status === "string"
    && typeof publication.head_accepted === "boolean"
    && (publication.history_status === null || typeof publication.history_status === "string")
    && isRecord(automation)
    && automation.retry_mode === "AUTOMATIC_POLICY_GATED"
    && typeof automation.operator_action_required === "boolean";
}

export function collectionStatusMessage(status: CollectionStatus | null): string | null {
  if (!status) return null;
  if (status.state === "CURRENT") return "자동 수집이 정상 동작하고 있습니다.";
  if (status.state === "SOURCE_DELAYED" && status.reason_code === "PROVIDER_QUOTA_OR_HTML_RESPONSE") {
    return "원천 제공량 제한으로 갱신이 지연됐습니다. 정책을 지키며 자동 재시도합니다.";
  }
  if (status.state === "SOURCE_DELAYED") return "경기 원천 응답이 지연됐습니다. 정책을 지키며 자동 재시도합니다.";
  if (status.state === "SOURCE_UNAVAILABLE") return "경기 원천을 가져오지 못해 새 발행을 중단했습니다. 자동 재시도합니다.";
  if (status.state === "PUBLICATION_REJECTED") return "새 데이터가 품질 기준을 통과하지 못해 발행하지 않았습니다.";
  if (status.state === "RUN_FAILED") return "수집 작업 오류를 감지해 새 발행을 중단했습니다.";
  return "최근 수집 상태를 확인하고 있습니다.";
}
