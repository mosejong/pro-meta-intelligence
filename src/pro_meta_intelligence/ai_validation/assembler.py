from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any

from pro_meta_intelligence.ai_validation.evaluator import evaluate_ai_against_human
from pro_meta_intelligence.temporal import parse_datetime


class AIHoldoutAssemblyError(ValueError):
    """Raised when blinded holdout artifacts cannot be joined safely."""


SUPPORTED_TASK_TYPES = {"EVIDENCE_LOCKED_BRIEF", "PLAYER_TENDENCY_QA"}
PLAYER_TENDENCY_SCENARIOS = {
    "T1_CHAMPION_POOL",
    "T1_GENG_ROLE_COMPARISON",
    "LOW_SAMPLE_RISK",
    "HIGH_SAMPLE_RISK",
    "PSYCHOLOGY_REFUSAL",
    "OPPONENT_PRIVATE_REFUSAL",
}
PLAYER_TENDENCY_CLAIM_IDS = {
    "CLAIM:TENDENCY_TOP_CHAMPION",
    "CLAIM:TENDENCY_OBSERVED_POOL",
    "CLAIM:TENDENCY_SAMPLE_LIMITED",
    "CLAIM:TENDENCY_ROLE_COMPARISON",
    "CLAIM:TENDENCY_REFUSE_PSYCHOLOGY",
    "CLAIM:TENDENCY_REFUSE_OPPONENT_PRIVATE",
    "CLAIM:TENDENCY_NO_MASTERY_CONCLUSION",
}
PLAYER_TENDENCY_BOUNDARY_IDS = {
    "BOUNDARY:PUBLIC_ONLY",
    "BOUNDARY:SNAPSHOT_BOUNDED",
    "BOUNDARY:NO_PLAYER_MASTERY",
    "BOUNDARY:NO_PSYCHOLOGY",
    "BOUNDARY:NO_OPPONENT_PRIVATE",
    "BOUNDARY:MISSING_DATA_NOT_NEGATIVE",
}
PLAYER_TENDENCY_CRITICAL_IDS = {
    "CRITICAL:UNSUPPORTED_CLAIM",
    "CRITICAL:MISSING_BOUNDARY",
    "CRITICAL:WRONG_EVIDENCE",
    "CRITICAL:PSYCHOLOGICAL_INFERENCE",
    "CRITICAL:OPPONENT_PRIVATE_INFERENCE",
}
PLAYER_TENDENCY_POLICY_IDS = {
    "POLICY:PUBLIC_CHOICE_ONLY",
    "POLICY:NO_PSYCHOLOGY_INFERENCE",
    "POLICY:NO_OPPONENT_PRIVATE",
    "POLICY:MISSING_DATA_NOT_NEGATIVE",
}
PRIVATE_TASK_KEYS = {
    "api_key",
    "analyst_identity",
    "private_practice",
    "private_session",
    "practice_session",
    "scrim_data",
    "hidden_account",
}
PLAYER_TENDENCY_ROLES = {"TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"}


def prepare_holdout_templates(
    human_bundle: dict[str, Any], *, created_at: str
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Create separate expert and AI templates without leaking the human response."""

    created = parse_datetime(created_at).isoformat()
    human_cases = _human_cases(human_bundle)
    task_type = _bundle_task_type(human_bundle, human_cases, "human baseline")
    expert_cases: list[dict[str, Any]] = []
    ai_cases: list[dict[str, Any]] = []
    for case in human_cases:
        task_key = case["task_key"]
        fingerprint = _task_fingerprint(case)
        blinded_task = {
            "task_key": task_key,
            "task_fingerprint": fingerprint,
            "snapshot": deepcopy(case["snapshot"]),
            "task": deepcopy(case["task"]),
        }
        expert_cases.append(
            {
                **deepcopy(blinded_task),
                "split": "HOLDOUT",
                "reference": {
                    "required_claim_ids": [],
                    "allowed_claim_ids": [],
                    "required_evidence_ids": [],
                    "allowed_evidence_ids": [],
                    "required_boundary_ids": [],
                },
            }
        )
        ai_cases.append(
            {
                **deepcopy(blinded_task),
                "ai": {
                    "claim_ids": [],
                    "evidence_ids": [],
                    "boundary_ids": [],
                    "critical_error_ids": [],
                    "duration_seconds": None,
                    "accepted_without_edit": False,
                },
            }
        )

    expert_template = {
        "schema_version": "1",
        "artifact_type": "ai-human-expert-reference-bundle",
        "created_at": created,
        "sealed_at": "",
        "task_type": task_type,
        "cases": expert_cases,
        "boundary": (
            "Fill this file without access to the human or AI output. Required IDs must be "
            "nonempty and must come from the frozen task options."
        ),
    }
    ai_template = {
        "schema_version": "1",
        "artifact_type": "ai-human-ai-output-bundle",
        "created_at": created,
        "run_id": "",
        "evaluated_at": "",
        "task_type": task_type,
        "system": {
            "provider": "",
            "model": "",
            "model_version": "",
            "prompt_version": "",
        },
        "cases": ai_cases,
        "boundary": (
            "Run the pinned AI path on only the task fields in this file. Do not add human "
            "outputs or expert references."
        ),
    }
    summary = {
        "schema_version": "1",
        "artifact_type": "ai-human-holdout-preparation-summary",
        "created_at": created,
        "case_count": len(human_cases),
        "task_type": task_type,
        "task_fingerprints": [item["task_fingerprint"] for item in expert_cases],
        "human_output_in_expert_template": False,
        "human_output_in_ai_template": False,
        "ready_for_release_evaluation": False,
        "next_action": "FILL_EXPERT_AND_AI_TEMPLATES_SEPARATELY",
    }
    return expert_template, ai_template, summary


def assemble_paired_evaluation(
    human_bundle: dict[str, Any],
    expert_bundle: dict[str, Any],
    ai_bundle: dict[str, Any],
) -> dict[str, Any]:
    """Strictly join human, expert, and AI artifacts into the private evaluator contract."""

    human_case_list = _human_cases(human_bundle)
    task_type = _bundle_task_type(human_bundle, human_case_list, "human baseline")
    human_cases = _index_cases(human_case_list, "human baseline")
    expert_cases = _index_cases(
        _bundle_cases(expert_bundle, "ai-human-expert-reference-bundle"),
        "expert reference",
    )
    ai_cases = _index_cases(
        _bundle_cases(ai_bundle, "ai-human-ai-output-bundle"),
        "AI output",
    )
    expected_keys = set(human_cases)
    _require_same_keys(expected_keys, set(expert_cases), "expert reference")
    _require_same_keys(expected_keys, set(ai_cases), "AI output")
    _require_nonempty_string(expert_bundle.get("sealed_at"), "expert.sealed_at")
    parse_datetime(expert_bundle["sealed_at"])
    run_id = _require_nonempty_string(ai_bundle.get("run_id"), "ai.run_id")
    evaluated_at = _require_nonempty_string(ai_bundle.get("evaluated_at"), "ai.evaluated_at")
    parse_datetime(evaluated_at)
    if expert_bundle.get("task_type") != task_type:
        raise AIHoldoutAssemblyError(f"expert task_type must be {task_type}")
    if ai_bundle.get("task_type") != task_type:
        raise AIHoldoutAssemblyError(f"AI task_type must be {task_type}")
    system = _system(ai_bundle.get("system"))

    paired_cases: list[dict[str, Any]] = []
    for index, task_key in enumerate(sorted(expected_keys)):
        human_case = human_cases[task_key]
        expert_case = expert_cases[task_key]
        ai_case = ai_cases[task_key]
        expected_fingerprint = _task_fingerprint(human_case)
        _require_task_match(expert_case, expected_fingerprint, "expert", task_key)
        _require_task_match(ai_case, expected_fingerprint, "AI", task_key)
        reference = _reference(expert_case, human_case["task"])
        human = _output(human_case.get("human"), "human", allow_null_duration=False)
        ai = _output(ai_case.get("ai"), "ai", allow_null_duration=False)
        split = expert_case.get("split")
        if split not in {"DEV", "HOLDOUT"}:
            raise AIHoldoutAssemblyError(f"expert split must be DEV or HOLDOUT: {task_key}")
        case_suffix = expected_fingerprint.removeprefix("sha256:")[:10]
        paired_cases.append(
            {
                "case_id": f"case-{index + 1:03d}-{case_suffix}",
                "split": split,
                "reference": reference,
                "human": human,
                "ai": ai,
            }
        )

    run = {
        "schema_version": "1",
        "artifact_type": "ai-human-paired-evaluation",
        "run_id": run_id,
        "task_type": task_type,
        "evaluated_at": parse_datetime(evaluated_at).isoformat(),
        "system": system,
        "cases": paired_cases,
    }
    evaluate_ai_against_human(run)
    return run


def _human_cases(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    cases = _bundle_cases(bundle, "ai-human-baseline-draft-bundle")
    if bundle.get("contains_expert_reference") is not False:
        raise AIHoldoutAssemblyError("human bundle must not contain an expert reference")
    if bundle.get("contains_ai_output") is not False:
        raise AIHoldoutAssemblyError("human bundle must not contain AI output")
    if bundle.get("ready_for_release_evaluation") is not False:
        raise AIHoldoutAssemblyError("human bundle must remain ungraded")
    if bundle.get("case_count") != len(cases):
        raise AIHoldoutAssemblyError("human bundle case_count does not match cases")
    validated: list[dict[str, Any]] = []
    for case in cases:
        if case.get("artifact_type") != "ai-human-baseline-draft":
            raise AIHoldoutAssemblyError("human case must be ai-human-baseline-draft")
        if case.get("status") != "HUMAN_BASELINE_ONLY":
            raise AIHoldoutAssemblyError("human case must remain HUMAN_BASELINE_ONLY")
        if not isinstance(case.get("snapshot"), dict) or not isinstance(case.get("task"), dict):
            raise AIHoldoutAssemblyError("human case requires snapshot and task objects")
        task = case["task"]
        task_type = _require_nonempty_string(task.get("task_type"), "human task_type")
        if task_type not in SUPPORTED_TASK_TYPES:
            raise AIHoldoutAssemblyError(f"unsupported human task_type: {task_type}")
        options = _task_options(task)
        human = _output(case.get("human"), "human", allow_null_duration=False)
        privacy = case.get("privacy")
        if not isinstance(privacy, dict) or privacy.get("analyst_identity_collected") is not False:
            raise AIHoldoutAssemblyError("human baseline must not contain analyst identity")
        if privacy.get("api_key_collected") is not False:
            raise AIHoldoutAssemblyError("human baseline must not contain an API key")
        for selected_field, option_field in (
            ("claim_ids", "available_claim_ids"),
            ("evidence_ids", "available_evidence_ids"),
            ("boundary_ids", "available_boundary_ids"),
            ("critical_error_ids", "available_critical_error_ids"),
        ):
            if not set(human[selected_field]).issubset(options[option_field]):
                raise AIHoldoutAssemblyError(
                    f"human.{selected_field} contains an ID outside the frozen task"
                )
        validated.append(case)
    if {case["task"]["task_type"] for case in validated} == {"PLAYER_TENDENCY_QA"}:
        for case in validated:
            task = case["task"]
            _validate_player_tendency_task(task, _task_options(task))
        _validate_player_tendency_bundle(validated)
    return validated


def _validate_player_tendency_task(task: dict[str, Any], options: dict[str, set[str]]) -> None:
    scenario = task.get("scenario")
    if scenario not in PLAYER_TENDENCY_SCENARIOS:
        raise AIHoldoutAssemblyError("player tendency scenario is not allowed")
    scope = task.get("scope")
    if scope not in {"PUBLIC_ONLY", "OPPONENT_PUBLIC_ONLY"}:
        raise AIHoldoutAssemblyError("player tendency scope is not allowed")
    if scenario == "OPPONENT_PRIVATE_REFUSAL" and scope != "OPPONENT_PUBLIC_ONLY":
        raise AIHoldoutAssemblyError("opponent private refusal must be public-only")
    _require_nonempty_string(task.get("question"), "player tendency question")
    _validate_frozen_player(task.get("subject"), "player tendency subject")
    comparison = task.get("comparison")
    if comparison is not None:
        _validate_frozen_player(comparison, "player tendency comparison")
    if scenario == "T1_GENG_ROLE_COMPARISON" and comparison is None:
        raise AIHoldoutAssemblyError("T1 versus Gen.G comparison requires both players")
    subject = task["subject"]
    if scenario in {"T1_CHAMPION_POOL", "T1_GENG_ROLE_COMPARISON", "PSYCHOLOGY_REFUSAL"}:
        if _normalized_team_name(subject["team_name"]) != "T1":
            raise AIHoldoutAssemblyError("T1 tendency scenarios require T1 as the subject")
    if scenario == "T1_GENG_ROLE_COMPARISON":
        if _normalized_team_name(comparison["team_name"]) != "GENG":
            raise AIHoldoutAssemblyError("T1 comparison requires Gen.G as the comparison team")
    if scenario == "OPPONENT_PRIVATE_REFUSAL":
        if _normalized_team_name(subject["team_name"]) != "GENG":
            raise AIHoldoutAssemblyError("opponent-private scenarios require Gen.G as the subject")
    if not options["available_claim_ids"].issubset(PLAYER_TENDENCY_CLAIM_IDS):
        raise AIHoldoutAssemblyError("player tendency task contains an unknown claim ID")
    if not options["available_boundary_ids"].issubset(PLAYER_TENDENCY_BOUNDARY_IDS):
        raise AIHoldoutAssemblyError("player tendency task contains an unknown boundary ID")
    if not options["available_critical_error_ids"].issubset(PLAYER_TENDENCY_CRITICAL_IDS):
        raise AIHoldoutAssemblyError("player tendency task contains an unknown critical error ID")
    policy_ids = {item for item in options["available_evidence_ids"] if item.startswith("POLICY:")}
    if not policy_ids.issubset(PLAYER_TENDENCY_POLICY_IDS):
        raise AIHoldoutAssemblyError("player tendency task contains an unknown policy ID")
    if scenario == "PSYCHOLOGY_REFUSAL" and "POLICY:NO_PSYCHOLOGY_INFERENCE" not in policy_ids:
        raise AIHoldoutAssemblyError("psychology refusal requires its policy ID")
    if scenario == "OPPONENT_PRIVATE_REFUSAL" and "POLICY:NO_OPPONENT_PRIVATE" not in policy_ids:
        raise AIHoldoutAssemblyError("opponent private refusal requires its policy ID")
    if _contains_private_task_key(task):
        raise AIHoldoutAssemblyError("player tendency task must not contain private data fields")


def _validate_player_tendency_bundle(cases: list[dict[str, Any]]) -> None:
    if len(cases) > 30:
        raise AIHoldoutAssemblyError("player tendency human bundle exceeds the 30-task deck")
    if len(cases) != 30:
        return
    observed = {(case["task"]["scenario"], case["task"]["subject"]["role"]) for case in cases}
    expected = {
        (scenario, role) for scenario in PLAYER_TENDENCY_SCENARIOS for role in PLAYER_TENDENCY_ROLES
    }
    if observed != expected or len(observed) != len(cases):
        raise AIHoldoutAssemblyError(
            "complete player tendency deck must contain one case per scenario and role"
        )


def _validate_frozen_player(value: object, label: str) -> None:
    if not isinstance(value, dict):
        raise AIHoldoutAssemblyError(f"{label} must be an object")
    for field in ("team_id", "team_name", "player_id", "player_name", "role"):
        _require_nonempty_string(value.get(field), f"{label}.{field}")
    if value["role"] not in PLAYER_TENDENCY_ROLES:
        raise AIHoldoutAssemblyError(f"{label}.role is not allowed")
    game_count = value.get("game_count")
    if type(game_count) is not int or game_count < 0:
        raise AIHoldoutAssemblyError(f"{label}.game_count must be a nonnegative integer")
    champions = value.get("champions")
    if not isinstance(champions, list) or len(champions) > 10:
        raise AIHoldoutAssemblyError(f"{label}.champions must be a bounded list")
    for champion in champions:
        if not isinstance(champion, dict):
            raise AIHoldoutAssemblyError(f"{label}.champions must contain objects")
        _require_nonempty_string(champion.get("champion_id"), f"{label}.champion_id")
        if type(champion.get("game_count")) is not int or champion["game_count"] < 0:
            raise AIHoldoutAssemblyError(f"{label}.champion game_count is invalid")
        game_rate = champion.get("game_rate")
        if type(game_rate) not in (int, float) or not 0 <= game_rate <= 1:
            raise AIHoldoutAssemblyError(f"{label}.champion game_rate is invalid")


def _contains_private_task_key(value: object) -> bool:
    if isinstance(value, dict):
        return any(
            str(key).casefold() in PRIVATE_TASK_KEYS or _contains_private_task_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_private_task_key(item) for item in value)
    return False


def _normalized_team_name(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def _bundle_task_type(bundle: dict[str, Any], cases: list[dict[str, Any]], label: str) -> str:
    task_types = {
        _require_nonempty_string(case["task"].get("task_type"), f"{label}.task_type")
        for case in cases
    }
    if len(task_types) != 1:
        raise AIHoldoutAssemblyError(f"{label} must contain exactly one task_type")
    task_type = next(iter(task_types))
    if task_type not in SUPPORTED_TASK_TYPES:
        raise AIHoldoutAssemblyError(f"unsupported {label} task_type: {task_type}")
    declared = bundle.get("task_type")
    if declared is not None and declared != task_type:
        raise AIHoldoutAssemblyError(f"{label} bundle task_type does not match its frozen cases")
    return task_type


def _bundle_cases(bundle: dict[str, Any], artifact_type: str) -> list[dict[str, Any]]:
    if not isinstance(bundle, dict):
        raise AIHoldoutAssemblyError(f"{artifact_type} must be a JSON object")
    if bundle.get("schema_version") != "1" or bundle.get("artifact_type") != artifact_type:
        raise AIHoldoutAssemblyError(f"expected {artifact_type} schema version 1")
    cases = bundle.get("cases")
    if not isinstance(cases, list) or not cases:
        raise AIHoldoutAssemblyError(f"{artifact_type} cases must be a nonempty list")
    if not all(isinstance(case, dict) for case in cases):
        raise AIHoldoutAssemblyError(f"{artifact_type} cases must be objects")
    if len(cases) > 500:
        raise AIHoldoutAssemblyError(f"{artifact_type} exceeds 500 cases")
    return cases


def _index_cases(cases: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for case in cases:
        key = _require_nonempty_string(case.get("task_key"), f"{label}.task_key")
        if key in indexed:
            raise AIHoldoutAssemblyError(f"duplicate {label} task_key: {key}")
        indexed[key] = case
    return indexed


def _require_same_keys(expected: set[str], observed: set[str], label: str) -> None:
    if observed == expected:
        return
    missing = sorted(expected - observed)
    extra = sorted(observed - expected)
    raise AIHoldoutAssemblyError(
        f"{label} task set mismatch; missing={missing[:3]} extra={extra[:3]}"
    )


def _require_task_match(
    case: dict[str, Any], expected_fingerprint: str, label: str, task_key: str
) -> None:
    if case.get("task_fingerprint") != expected_fingerprint:
        raise AIHoldoutAssemblyError(f"{label} task fingerprint mismatch: {task_key}")
    task_view = {"snapshot": case.get("snapshot"), "task": case.get("task")}
    if _fingerprint(task_view) != expected_fingerprint:
        raise AIHoldoutAssemblyError(f"{label} task content changed after preparation: {task_key}")


def _reference(case: dict[str, Any], task: dict[str, Any]) -> dict[str, list[str]]:
    value = case.get("reference")
    if not isinstance(value, dict):
        raise AIHoldoutAssemblyError("expert reference must be an object")
    fields = (
        "required_claim_ids",
        "allowed_claim_ids",
        "required_evidence_ids",
        "allowed_evidence_ids",
        "required_boundary_ids",
    )
    selected = {field: _id_list(value.get(field), f"reference.{field}") for field in fields}
    if not selected["required_claim_ids"]:
        raise AIHoldoutAssemblyError("reference.required_claim_ids must be nonempty")
    if not selected["required_evidence_ids"]:
        raise AIHoldoutAssemblyError("reference.required_evidence_ids must be nonempty")
    if not selected["required_boundary_ids"]:
        raise AIHoldoutAssemblyError("reference.required_boundary_ids must be nonempty")
    if not set(selected["required_claim_ids"]).issubset(selected["allowed_claim_ids"]):
        raise AIHoldoutAssemblyError("required claim IDs must be allowed")
    if not set(selected["required_evidence_ids"]).issubset(selected["allowed_evidence_ids"]):
        raise AIHoldoutAssemblyError("required evidence IDs must be allowed")
    options = _task_options(task)
    checks = (
        ("allowed_claim_ids", "available_claim_ids"),
        ("allowed_evidence_ids", "available_evidence_ids"),
        ("required_boundary_ids", "available_boundary_ids"),
    )
    for selected_field, option_field in checks:
        if not set(selected[selected_field]).issubset(options[option_field]):
            raise AIHoldoutAssemblyError(
                f"reference.{selected_field} contains an ID outside the frozen task"
            )
    return selected


def _task_options(task: dict[str, Any]) -> dict[str, set[str]]:
    if not isinstance(task, dict):
        raise AIHoldoutAssemblyError("task must be an object")
    fields = (
        "available_claim_ids",
        "available_evidence_ids",
        "available_boundary_ids",
        "available_critical_error_ids",
    )
    return {field: set(_id_list(task.get(field), f"task.{field}")) for field in fields}


def _output(value: object, label: str, *, allow_null_duration: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AIHoldoutAssemblyError(f"{label} output must be an object")
    result: dict[str, Any] = {
        field: _id_list(value.get(field), f"{label}.{field}")
        for field in ("claim_ids", "evidence_ids", "boundary_ids", "critical_error_ids")
    }
    duration = value.get("duration_seconds")
    if allow_null_duration and duration is None:
        result["duration_seconds"] = None
    elif type(duration) not in (int, float) or duration <= 0:
        raise AIHoldoutAssemblyError(f"{label}.duration_seconds must be positive")
    else:
        result["duration_seconds"] = duration
    if not isinstance(value.get("accepted_without_edit"), bool):
        raise AIHoldoutAssemblyError(f"{label}.accepted_without_edit must be boolean")
    result["accepted_without_edit"] = value["accepted_without_edit"]
    return result


def _system(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise AIHoldoutAssemblyError("ai.system must be an object")
    return {
        field: _require_nonempty_string(value.get(field), f"ai.system.{field}")
        for field in ("provider", "model", "model_version", "prompt_version")
    }


def _id_list(value: object, field: str) -> list[str]:
    if not isinstance(value, list) or len(value) > 500:
        raise AIHoldoutAssemblyError(f"{field} must be a bounded list")
    if not all(isinstance(item, str) and 0 < len(item) <= 500 for item in value):
        raise AIHoldoutAssemblyError(f"{field} must contain nonempty bounded strings")
    if len(value) != len(set(value)):
        raise AIHoldoutAssemblyError(f"{field} must not contain duplicates")
    return list(value)


def _require_nonempty_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 500:
        raise AIHoldoutAssemblyError(f"{field} must be a nonempty bounded string")
    return value


def _task_fingerprint(case: dict[str, Any]) -> str:
    return _fingerprint({"snapshot": case["snapshot"], "task": case["task"]})


def _fingerprint(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"
