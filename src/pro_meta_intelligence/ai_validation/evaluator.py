from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from statistics import median
from typing import Any

from pro_meta_intelligence.temporal import parse_datetime


@dataclass(frozen=True, slots=True)
class AIValidationPolicy:
    minimum_paired_holdout_cases: int = 30
    minimum_claim_f1: float = 0.90
    minimum_evidence_f1: float = 0.90
    noninferiority_margin: float = 0.02
    required_boundary_recall: float = 1.0
    maximum_critical_error_count: int = 0
    maximum_median_time_ratio: float = 0.50
    minimum_faster_case_rate: float = 0.80
    minimum_accepted_without_edit_rate: float = 0.80

    def __post_init__(self) -> None:
        if self.minimum_paired_holdout_cases <= 0:
            raise ValueError("minimum_paired_holdout_cases must be positive")
        for field_name, value in asdict(self).items():
            if field_name in {"minimum_paired_holdout_cases", "maximum_critical_error_count"}:
                continue
            if not 0 <= value <= 1:
                raise ValueError(f"{field_name} must be between 0 and 1")


def evaluate_ai_against_human(
    run: dict[str, Any], policy: AIValidationPolicy | None = None
) -> dict[str, Any]:
    """Evaluate structured AI decisions against the same human holdout cases.

    The public report deliberately contains aggregate metrics and a system fingerprint only. Raw
    prompts, model output, analyst identity, credentials, and case identifiers remain private.
    """

    policy = policy or AIValidationPolicy()
    _validate_run(run)
    holdout_cases = [case for case in run["cases"] if case["split"] == "HOLDOUT"]
    human_rows = [_score_output(case["reference"], case["human"]) for case in holdout_cases]
    ai_rows = [_score_output(case["reference"], case["ai"]) for case in holdout_cases]
    human = _aggregate(human_rows)
    ai = _aggregate(ai_rows)
    paired = _paired_metrics(human_rows, ai_rows)
    version_pinned = _version_pinned(run["system"])

    gates = [
        _gate(
            "PAIRED_HOLDOUT_SAMPLE",
            len(holdout_cases) >= policy.minimum_paired_holdout_cases,
            len(holdout_cases),
            {"minimum": policy.minimum_paired_holdout_cases, "split": "HOLDOUT"},
        ),
        _gate(
            "ZERO_CRITICAL_ERRORS",
            ai["critical_error_count"] <= policy.maximum_critical_error_count,
            ai["critical_error_count"],
            {"maximum": policy.maximum_critical_error_count},
        ),
        _gate(
            "CLAIM_ACCURACY_NONINFERIOR",
            ai["claim_f1"] >= policy.minimum_claim_f1
            and paired["claim_f1_delta"] >= -policy.noninferiority_margin,
            {
                "ai_f1": ai["claim_f1"],
                "human_f1": human["claim_f1"],
                "delta": paired["claim_f1_delta"],
            },
            {
                "minimum_ai_f1": policy.minimum_claim_f1,
                "minimum_delta": -policy.noninferiority_margin,
            },
        ),
        _gate(
            "EVIDENCE_ACCURACY_NONINFERIOR",
            ai["evidence_f1"] >= policy.minimum_evidence_f1
            and paired["evidence_f1_delta"] >= -policy.noninferiority_margin,
            {
                "ai_f1": ai["evidence_f1"],
                "human_f1": human["evidence_f1"],
                "delta": paired["evidence_f1_delta"],
            },
            {
                "minimum_ai_f1": policy.minimum_evidence_f1,
                "minimum_delta": -policy.noninferiority_margin,
            },
        ),
        _gate(
            "BOUNDARY_RETENTION",
            ai["boundary_recall"] >= policy.required_boundary_recall,
            ai["boundary_recall"],
            {"minimum": policy.required_boundary_recall},
        ),
        _gate(
            "HUMAN_TIME_SAVED",
            paired["median_time_ratio"] is not None
            and paired["median_time_ratio"] <= policy.maximum_median_time_ratio
            and paired["ai_faster_case_rate"] >= policy.minimum_faster_case_rate
            and ai["accepted_without_edit_rate"] >= policy.minimum_accepted_without_edit_rate,
            {
                "median_time_ratio": paired["median_time_ratio"],
                "ai_faster_case_rate": paired["ai_faster_case_rate"],
                "accepted_without_edit_rate": ai["accepted_without_edit_rate"],
            },
            {
                "maximum_median_time_ratio": policy.maximum_median_time_ratio,
                "minimum_ai_faster_case_rate": policy.minimum_faster_case_rate,
                "minimum_accepted_without_edit_rate": policy.minimum_accepted_without_edit_rate,
            },
        ),
        _gate(
            "SYSTEM_VERSION_PINNED",
            version_pinned,
            version_pinned,
            "provider, model, model_version, and prompt_version are nonempty",
        ),
    ]
    enough_cases = gates[0]["passed"]
    status = (
        "VALIDATED"
        if enough_cases and all(gate["passed"] for gate in gates)
        else ("REJECTED" if enough_cases else "NOT_VALIDATED")
    )
    evaluated_at = parse_datetime(run["evaluated_at"]).isoformat()
    return {
        "schema_version": "1",
        "artifact_type": "ai-human-validation-status",
        "evaluated_at": evaluated_at,
        "status": status,
        "ai_features_enabled": status == "VALIDATED",
        "evaluation_mode": "PAIRED_HUMAN_HOLDOUT",
        "task_type": run["task_type"],
        "system_fingerprint": _system_fingerprint(run["system"]) if version_pinned else None,
        "dataset_fingerprint": _fingerprint(holdout_cases),
        "paired_holdout_case_count": len(holdout_cases),
        "policy": asdict(policy),
        "metrics": {"human": human, "ai": ai, "paired_comparison": paired},
        "gates": gates,
        "failed_gates": [gate["id"] for gate in gates if not gate["passed"]],
        "next_action": _next_action(status, gates),
        "boundary": (
            "AI output is withheld unless the same hidden cases show noninferior accuracy, zero "
            "critical errors, complete boundary retention, and measured human time savings."
        ),
    }


def _validate_run(run: dict[str, Any]) -> None:
    if not isinstance(run, dict):
        raise ValueError("evaluation run must be a JSON object")
    if run.get("schema_version") != "1":
        raise ValueError("schema_version must be 1")
    if run.get("artifact_type") != "ai-human-paired-evaluation":
        raise ValueError("artifact_type must be ai-human-paired-evaluation")
    for field in ("run_id", "task_type", "evaluated_at"):
        if not isinstance(run.get(field), str) or not run[field].strip():
            raise ValueError(f"{field} must be a nonempty string")
    parse_datetime(run["evaluated_at"])
    if not isinstance(run.get("system"), dict):
        raise ValueError("system must be an object")
    cases = run.get("cases")
    if not isinstance(cases, list):
        raise ValueError("cases must be a list")
    seen: set[str] = set()
    for case in cases:
        _validate_case(case)
        if case["case_id"] in seen:
            raise ValueError(f"duplicate case_id: {case['case_id']}")
        seen.add(case["case_id"])


def _validate_case(case: object) -> None:
    if not isinstance(case, dict):
        raise ValueError("each case must be an object")
    if not isinstance(case.get("case_id"), str) or not case["case_id"].strip():
        raise ValueError("case_id must be a nonempty string")
    if case.get("split") not in {"DEV", "HOLDOUT"}:
        raise ValueError("split must be DEV or HOLDOUT")
    reference = case.get("reference")
    if not isinstance(reference, dict):
        raise ValueError("reference must be an object")
    for field in (
        "required_claim_ids",
        "allowed_claim_ids",
        "required_evidence_ids",
        "allowed_evidence_ids",
        "required_boundary_ids",
    ):
        _validate_id_list(reference.get(field), f"reference.{field}")
    if not set(reference["required_claim_ids"]).issubset(reference["allowed_claim_ids"]):
        raise ValueError("required_claim_ids must be allowed")
    if not set(reference["required_evidence_ids"]).issubset(reference["allowed_evidence_ids"]):
        raise ValueError("required_evidence_ids must be allowed")
    for actor in ("human", "ai"):
        output = case.get(actor)
        if not isinstance(output, dict):
            raise ValueError(f"{actor} must be an object")
        for field in ("claim_ids", "evidence_ids", "boundary_ids", "critical_error_ids"):
            _validate_id_list(output.get(field), f"{actor}.{field}")
        duration = output.get("duration_seconds")
        if type(duration) not in (int, float) or duration <= 0:
            raise ValueError(f"{actor}.duration_seconds must be positive")
        if not isinstance(output.get("accepted_without_edit"), bool):
            raise ValueError(f"{actor}.accepted_without_edit must be boolean")


def _validate_id_list(value: object, field: str) -> None:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"{field} must be a list of nonempty strings")
    if len(value) != len(set(value)):
        raise ValueError(f"{field} must not contain duplicates")


def _score_output(reference: dict[str, Any], output: dict[str, Any]) -> dict[str, Any]:
    claim_precision, claim_recall, claim_f1 = _set_scores(
        set(reference["required_claim_ids"]),
        set(reference["allowed_claim_ids"]),
        set(output["claim_ids"]),
    )
    evidence_precision, evidence_recall, evidence_f1 = _set_scores(
        set(reference["required_evidence_ids"]),
        set(reference["allowed_evidence_ids"]),
        set(output["evidence_ids"]),
    )
    required_boundaries = set(reference["required_boundary_ids"])
    observed_boundaries = set(output["boundary_ids"])
    boundary_recall = (
        len(required_boundaries & observed_boundaries) / len(required_boundaries)
        if required_boundaries
        else 1.0
    )
    unsupported_claims = set(output["claim_ids"]) - set(reference["allowed_claim_ids"])
    missing_boundaries = required_boundaries - observed_boundaries
    critical_error_count = (
        len(output["critical_error_ids"]) + len(unsupported_claims) + len(missing_boundaries)
    )
    return {
        "claim_precision": claim_precision,
        "claim_recall": claim_recall,
        "claim_f1": claim_f1,
        "evidence_precision": evidence_precision,
        "evidence_recall": evidence_recall,
        "evidence_f1": evidence_f1,
        "boundary_recall": boundary_recall,
        "critical_error_count": critical_error_count,
        "duration_seconds": float(output["duration_seconds"]),
        "accepted_without_edit": output["accepted_without_edit"],
    }


def _set_scores(
    required: set[str], allowed: set[str], observed: set[str]
) -> tuple[float, float, float]:
    correct = observed & allowed
    precision = len(correct) / len(observed) if observed else (1.0 if not required else 0.0)
    recall = len(required & observed) / len(required) if required else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1


def _aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    metric_names = (
        "claim_precision",
        "claim_recall",
        "claim_f1",
        "evidence_precision",
        "evidence_recall",
        "evidence_f1",
        "boundary_recall",
    )
    result = {
        name: _round(sum(row[name] for row in rows) / len(rows)) if rows else 0.0
        for name in metric_names
    }
    result.update(
        {
            "critical_error_count": sum(row["critical_error_count"] for row in rows),
            "critical_error_rate": _round(
                sum(row["critical_error_count"] > 0 for row in rows) / len(rows)
            )
            if rows
            else 0.0,
            "median_duration_seconds": (
                _round(median(row["duration_seconds"] for row in rows)) if rows else None
            ),
            "accepted_without_edit_rate": _round(
                sum(row["accepted_without_edit"] for row in rows) / len(rows)
            )
            if rows
            else 0.0,
        }
    )
    return result


def _paired_metrics(human: list[dict[str, Any]], ai: list[dict[str, Any]]) -> dict[str, Any]:
    if not human:
        return {
            "claim_f1_delta": 0.0,
            "evidence_f1_delta": 0.0,
            "median_time_ratio": None,
            "ai_faster_case_rate": 0.0,
        }
    human_median = median(row["duration_seconds"] for row in human)
    ai_median = median(row["duration_seconds"] for row in ai)
    return {
        "claim_f1_delta": _round(
            sum(a["claim_f1"] - h["claim_f1"] for h, a in zip(human, ai, strict=True)) / len(human)
        ),
        "evidence_f1_delta": _round(
            sum(a["evidence_f1"] - h["evidence_f1"] for h, a in zip(human, ai, strict=True))
            / len(human)
        ),
        "median_time_ratio": _round(ai_median / human_median),
        "ai_faster_case_rate": _round(
            sum(
                a["duration_seconds"] < h["duration_seconds"]
                for h, a in zip(human, ai, strict=True)
            )
            / len(human)
        ),
    }


def _gate(gate_id: str, passed: bool, observed: object, required: object) -> dict[str, Any]:
    return {"id": gate_id, "passed": passed, "observed": observed, "required": required}


def _version_pinned(system: dict[str, Any]) -> bool:
    return all(
        isinstance(system.get(field), str) and bool(system[field].strip())
        for field in ("provider", "model", "model_version", "prompt_version")
    )


def _system_fingerprint(system: dict[str, Any]) -> str:
    selected = {
        field: system[field] for field in ("provider", "model", "model_version", "prompt_version")
    }
    return _fingerprint(selected)


def _fingerprint(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _next_action(status: str, gates: list[dict[str, Any]]) -> str:
    if status == "VALIDATED":
        return "ENABLE_REVIEWED_AI_PATH"
    failed = {gate["id"] for gate in gates if not gate["passed"]}
    if "PAIRED_HOLDOUT_SAMPLE" in failed:
        return "COLLECT_PAIRED_HUMAN_HOLDOUTS"
    if "SYSTEM_VERSION_PINNED" in failed:
        return "PIN_SYSTEM_AND_PROMPT_VERSIONS"
    return "REJECT_OR_REVISE_AI_SYSTEM"


def _round(value: float) -> float:
    return round(value, 6)
