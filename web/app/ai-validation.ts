export type AIValidationGate = {
  id: string;
  passed: boolean;
  observed: unknown;
  required: unknown;
};

export type AIValidationStatus = {
  schema_version: "1";
  artifact_type: "ai-human-validation-status";
  evaluated_at: string;
  status: "NOT_VALIDATED" | "REJECTED" | "VALIDATED";
  ai_features_enabled: boolean;
  evaluation_mode: "PAIRED_HUMAN_HOLDOUT";
  paired_holdout_case_count: number;
  policy: {
    minimum_paired_holdout_cases: number;
    minimum_claim_f1: number;
    minimum_evidence_f1: number;
    required_boundary_recall: number;
    maximum_critical_error_count: number;
    maximum_median_time_ratio: number;
    minimum_faster_case_rate: number;
    minimum_accepted_without_edit_rate: number;
  };
  metrics: {
    ai: {
      claim_f1: number;
      evidence_f1: number;
      boundary_recall: number;
      critical_error_count: number;
      accepted_without_edit_rate: number;
      median_duration_seconds: number | null;
    };
    human: {
      claim_f1: number;
      evidence_f1: number;
      median_duration_seconds: number | null;
    };
    paired_comparison: {
      median_time_ratio: number | null;
      ai_faster_case_rate: number;
    };
  };
  gates: AIValidationGate[];
  failed_gates: string[];
  next_action: string;
  boundary: string;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

export function isAIValidationStatus(value: unknown): value is AIValidationStatus {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const policy = item.policy as Record<string, unknown> | undefined;
  const metrics = item.metrics as Record<string, unknown> | undefined;
  const ai = metrics?.ai as Record<string, unknown> | undefined;
  const human = metrics?.human as Record<string, unknown> | undefined;
  const paired = metrics?.paired_comparison as Record<string, unknown> | undefined;
  const gates = item.gates;
  return item.schema_version === "1"
    && item.artifact_type === "ai-human-validation-status"
    && ["NOT_VALIDATED", "REJECTED", "VALIDATED"].includes(String(item.status))
    && typeof item.ai_features_enabled === "boolean"
    && item.evaluation_mode === "PAIRED_HUMAN_HOLDOUT"
    && Number.isInteger(item.paired_holdout_case_count)
    && typeof policy === "object"
    && finiteNumber(policy.minimum_paired_holdout_cases)
    && typeof metrics === "object"
    && typeof ai === "object"
    && finiteNumber(ai.claim_f1)
    && finiteNumber(ai.evidence_f1)
    && finiteNumber(ai.boundary_recall)
    && finiteNumber(ai.critical_error_count)
    && typeof human === "object"
    && finiteNumber(human.claim_f1)
    && finiteNumber(human.evidence_f1)
    && typeof paired === "object"
    && Array.isArray(gates)
    && gates.length === 7
    && gates.every((gate) => Boolean(gate) && typeof gate === "object" && typeof (gate as AIValidationGate).id === "string" && typeof (gate as AIValidationGate).passed === "boolean")
    && Array.isArray(item.failed_gates)
    && typeof item.next_action === "string"
    && typeof item.boundary === "string";
}
