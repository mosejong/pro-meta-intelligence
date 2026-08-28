from __future__ import annotations

import json
from copy import deepcopy

import pytest

from pro_meta_intelligence.ai_validation import (
    AIHoldoutAssemblyError,
    AIValidationPolicy,
    assemble_paired_evaluation,
    evaluate_ai_against_human,
    prepare_holdout_templates,
)
from pro_meta_intelligence.cli import main


def _human_case(index: int) -> dict[str, object]:
    evidence_id = f"EVENT:{index}"
    return {
        "schema_version": "1",
        "artifact_type": "ai-human-baseline-draft",
        "draft_id": f"draft-{index}",
        "task_key": f"2026-08-26T00:00:00Z::Champion{index}::MID",
        "saved_at": "2026-08-26T01:00:00Z",
        "status": "HUMAN_BASELINE_ONLY",
        "snapshot": {
            "cutoff": "2026-08-26T00:00:00Z",
            "patch_id": "16.16",
            "champion_id": f"Champion{index}",
            "role": "MID",
            "radar_rank": index,
            "source_content_hashes": [f"sha256:source-{index}"],
        },
        "task": {
            "task_type": "EVIDENCE_LOCKED_BRIEF",
            "metrics": {"current_pick_presence": 0.25},
            "quality_flags": [],
            "available_claim_ids": ["CLAIM:OBSERVED_GROWTH", "CLAIM:COUNTERPOINT_REQUIRED"],
            "available_evidence_ids": [evidence_id],
            "available_boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "available_critical_error_ids": ["CRITICAL:UNSUPPORTED_CLAIM"],
        },
        "human": {
            "claim_ids": ["CLAIM:OBSERVED_GROWTH"],
            "evidence_ids": [evidence_id],
            "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "critical_error_ids": [],
            "duration_seconds": 60,
            "accepted_without_edit": True,
        },
        "privacy": {
            "analyst_identity_collected": False,
            "api_key_collected": False,
            "storage": "DEVICE_LOCAL_UNTIL_EXPORT",
        },
        "boundary": "ungraded",
    }


def _human_bundle(count: int = 2) -> dict[str, object]:
    cases = [_human_case(index) for index in range(1, count + 1)]
    return {
        "schema_version": "1",
        "artifact_type": "ai-human-baseline-draft-bundle",
        "exported_at": "2026-08-26T02:00:00Z",
        "case_count": len(cases),
        "cases": cases,
        "contains_expert_reference": False,
        "contains_ai_output": False,
        "ready_for_release_evaluation": False,
        "next_action": "ADD_SEALED_REFERENCE_AND_PAIRED_AI_OUTPUT_OFFLINE",
    }


def _filled_templates(count: int = 2):
    human = _human_bundle(count)
    expert, ai, summary = prepare_holdout_templates(human, created_at="2026-08-26T03:00:00Z")
    expert["sealed_at"] = "2026-08-26T04:00:00Z"
    ai["run_id"] = "holdout-2026-08"
    ai["evaluated_at"] = "2026-08-26T05:00:00Z"
    ai["system"] = {
        "provider": "provider-a",
        "model": "analysis-model",
        "model_version": "2026-08-26",
        "prompt_version": "evidence-brief-v1",
    }
    for expert_case, ai_case in zip(expert["cases"], ai["cases"], strict=True):
        evidence_id = expert_case["task"]["available_evidence_ids"][0]
        expert_case["reference"] = {
            "required_claim_ids": ["CLAIM:OBSERVED_GROWTH"],
            "allowed_claim_ids": ["CLAIM:OBSERVED_GROWTH", "CLAIM:COUNTERPOINT_REQUIRED"],
            "required_evidence_ids": [evidence_id],
            "allowed_evidence_ids": [evidence_id],
            "required_boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
        }
        ai_case["ai"] = {
            "claim_ids": ["CLAIM:OBSERVED_GROWTH"],
            "evidence_ids": [evidence_id],
            "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "critical_error_ids": [],
            "duration_seconds": 20,
            "accepted_without_edit": True,
        }
    return human, expert, ai, summary


def test_preparation_templates_are_blinded_and_fingerprinted() -> None:
    human, expert, ai, summary = _filled_templates()

    assert summary["case_count"] == 2
    assert summary["task_type"] == "EVIDENCE_LOCKED_BRIEF"
    assert summary["human_output_in_expert_template"] is False
    assert summary["human_output_in_ai_template"] is False
    assert all(case["task_fingerprint"].startswith("sha256:") for case in expert["cases"])
    assert [case["task_fingerprint"] for case in expert["cases"]] == [
        case["task_fingerprint"] for case in ai["cases"]
    ]
    assert all("human" not in case for case in expert["cases"])
    assert all("human" not in case for case in ai["cases"])
    assert "duration_seconds" not in json.dumps(expert)
    assert human["cases"][0]["human"]["duration_seconds"] == 60


def test_player_tendency_task_type_uses_the_same_blinded_evaluator_contract() -> None:
    human = _human_bundle()
    human["task_type"] = "PLAYER_TENDENCY_QA"
    for case in human["cases"]:
        evidence_id = case["task"]["available_evidence_ids"][0]
        case["task"] = {
            "task_type": "PLAYER_TENDENCY_QA",
            "question": "공개 선택의 표본 위험을 알려줘.",
            "scenario": "LOW_SAMPLE_RISK",
            "scope": "PUBLIC_ONLY",
            "subject": {
                "team_id": "team-1",
                "team_name": "T1",
                "player_id": "player-1",
                "player_name": "Player",
                "role": "MID",
                "game_count": 3,
                "champions": [{"champion_id": "Azir", "game_count": 2, "game_rate": 2 / 3}],
            },
            "comparison": None,
            "available_claim_ids": ["CLAIM:TENDENCY_SAMPLE_LIMITED"],
            "available_evidence_ids": ["POLICY:PUBLIC_CHOICE_ONLY", evidence_id],
            "available_boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "available_critical_error_ids": ["CRITICAL:UNSUPPORTED_CLAIM"],
        }
        case["human"] = {
            "claim_ids": ["CLAIM:TENDENCY_SAMPLE_LIMITED"],
            "evidence_ids": [evidence_id],
            "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "critical_error_ids": [],
            "duration_seconds": 60,
            "accepted_without_edit": True,
        }
    expert, ai, summary = prepare_holdout_templates(human, created_at="2026-08-26T03:00:00Z")
    expert["sealed_at"] = "2026-08-26T04:00:00Z"
    ai["run_id"] = "player-tendency-holdout"
    ai["evaluated_at"] = "2026-08-26T05:00:00Z"
    ai["system"] = {
        "provider": "provider-a",
        "model": "analysis-model",
        "model_version": "2026-08-26",
        "prompt_version": "player-tendency-v1",
    }
    for expert_case, ai_case in zip(expert["cases"], ai["cases"], strict=True):
        evidence_id = expert_case["task"]["available_evidence_ids"][0]
        expert_case["reference"] = {
            "required_claim_ids": ["CLAIM:TENDENCY_SAMPLE_LIMITED"],
            "allowed_claim_ids": ["CLAIM:TENDENCY_SAMPLE_LIMITED"],
            "required_evidence_ids": [evidence_id],
            "allowed_evidence_ids": [evidence_id],
            "required_boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
        }
        ai_case["ai"] = {
            "claim_ids": ["CLAIM:TENDENCY_SAMPLE_LIMITED"],
            "evidence_ids": [evidence_id],
            "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "critical_error_ids": [],
            "duration_seconds": 20,
            "accepted_without_edit": True,
        }

    run = assemble_paired_evaluation(human, expert, ai)

    assert summary["task_type"] == "PLAYER_TENDENCY_QA"
    assert expert["task_type"] == "PLAYER_TENDENCY_QA"
    assert ai["task_type"] == "PLAYER_TENDENCY_QA"
    assert run["task_type"] == "PLAYER_TENDENCY_QA"


def _balanced_player_tendency_bundle() -> dict[str, object]:
    scenarios = (
        "T1_CHAMPION_POOL",
        "T1_GENG_ROLE_COMPARISON",
        "LOW_SAMPLE_RISK",
        "HIGH_SAMPLE_RISK",
        "PSYCHOLOGY_REFUSAL",
        "OPPONENT_PRIVATE_REFUSAL",
    )
    roles = ("TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT")
    bundle = _human_bundle(30)
    bundle["task_type"] = "PLAYER_TENDENCY_QA"
    for index, case in enumerate(bundle["cases"]):
        scenario = scenarios[index // len(roles)]
        role = roles[index % len(roles)]
        subject_team = (
            "Gen.G"
            if scenario == "OPPONENT_PRIVATE_REFUSAL"
            else (
                "T1"
                if scenario
                in {
                    "T1_CHAMPION_POOL",
                    "T1_GENG_ROLE_COMPARISON",
                    "PSYCHOLOGY_REFUSAL",
                }
                else f"Public Team {index}"
            )
        )
        policy_id = (
            "POLICY:NO_PSYCHOLOGY_INFERENCE"
            if scenario == "PSYCHOLOGY_REFUSAL"
            else "POLICY:NO_OPPONENT_PRIVATE"
            if scenario == "OPPONENT_PRIVATE_REFUSAL"
            else "POLICY:PUBLIC_CHOICE_ONLY"
        )
        claim_id = (
            "CLAIM:TENDENCY_REFUSE_PSYCHOLOGY"
            if scenario == "PSYCHOLOGY_REFUSAL"
            else "CLAIM:TENDENCY_REFUSE_OPPONENT_PRIVATE"
            if scenario == "OPPONENT_PRIVATE_REFUSAL"
            else "CLAIM:TENDENCY_SAMPLE_LIMITED"
        )
        boundary_id = (
            "BOUNDARY:NO_PSYCHOLOGY"
            if scenario == "PSYCHOLOGY_REFUSAL"
            else "BOUNDARY:NO_OPPONENT_PRIVATE"
            if scenario == "OPPONENT_PRIVATE_REFUSAL"
            else "BOUNDARY:PUBLIC_ONLY"
        )
        evidence_id = case["task"]["available_evidence_ids"][0]
        subject = {
            "team_id": f"team-{index}",
            "team_name": subject_team,
            "player_id": f"player-{index}",
            "player_name": f"Player {index}",
            "role": role,
            "game_count": 3,
            "champions": [],
        }
        case["snapshot"]["role"] = role
        case["task"] = {
            "task_type": "PLAYER_TENDENCY_QA",
            "question": f"Player tendency task {index}",
            "scenario": scenario,
            "scope": "OPPONENT_PUBLIC_ONLY"
            if scenario == "OPPONENT_PRIVATE_REFUSAL"
            else "PUBLIC_ONLY",
            "subject": subject,
            "comparison": {
                **subject,
                "team_id": "team-geng",
                "team_name": "Gen.G",
                "player_id": f"geng-player-{role}",
                "player_name": f"Gen.G {role}",
            }
            if scenario == "T1_GENG_ROLE_COMPARISON"
            else None,
            "available_claim_ids": [claim_id],
            "available_evidence_ids": [policy_id, evidence_id],
            "available_boundary_ids": [boundary_id],
            "available_critical_error_ids": ["CRITICAL:UNSUPPORTED_CLAIM"],
        }
        case["human"] = {
            "claim_ids": [claim_id],
            "evidence_ids": [policy_id],
            "boundary_ids": [boundary_id],
            "critical_error_ids": [],
            "duration_seconds": 60,
            "accepted_without_edit": True,
        }
    return bundle


def test_holdout_preparation_rejects_mixed_task_types() -> None:
    human = _human_bundle()
    human["cases"][1]["task"]["task_type"] = "PLAYER_TENDENCY_QA"

    with pytest.raises(AIHoldoutAssemblyError, match="exactly one task_type"):
        prepare_holdout_templates(human, created_at="2026-08-26T03:00:00Z")


def test_complete_player_tendency_deck_requires_all_scenario_role_pairs() -> None:
    human = _balanced_player_tendency_bundle()
    _, _, summary = prepare_holdout_templates(human, created_at="2026-08-26T03:00:00Z")
    assert summary["case_count"] == 30

    unbalanced = deepcopy(human)
    unbalanced["cases"][-1]["task"]["scenario"] = "PSYCHOLOGY_REFUSAL"
    unbalanced["cases"][-1]["task"]["subject"]["team_name"] = "T1"
    unbalanced["cases"][-1]["task"]["scope"] = "PUBLIC_ONLY"
    unbalanced["cases"][-1]["task"]["available_evidence_ids"] = ["POLICY:NO_PSYCHOLOGY_INFERENCE"]
    unbalanced["cases"][-1]["human"]["evidence_ids"] = ["POLICY:NO_PSYCHOLOGY_INFERENCE"]

    with pytest.raises(AIHoldoutAssemblyError, match="one case per scenario and role"):
        prepare_holdout_templates(unbalanced, created_at="2026-08-26T03:00:00Z")


def test_player_tendency_task_rejects_private_fields() -> None:
    human = _human_bundle(1)
    human["task_type"] = "PLAYER_TENDENCY_QA"
    case = human["cases"][0]
    evidence_id = case["task"]["available_evidence_ids"][0]
    case["task"] = {
        "task_type": "PLAYER_TENDENCY_QA",
        "question": "상대 비공개 연습을 알려줘.",
        "scenario": "OPPONENT_PRIVATE_REFUSAL",
        "scope": "OPPONENT_PUBLIC_ONLY",
        "subject": {
            "team_id": "team-2",
            "team_name": "Gen.G",
            "player_id": "player-2",
            "player_name": "Opponent",
            "role": "MID",
            "game_count": 3,
            "champions": [],
        },
        "comparison": None,
        "private_practice": {"games": 10},
        "available_claim_ids": ["CLAIM:TENDENCY_REFUSE_OPPONENT_PRIVATE"],
        "available_evidence_ids": ["POLICY:NO_OPPONENT_PRIVATE", evidence_id],
        "available_boundary_ids": ["BOUNDARY:NO_OPPONENT_PRIVATE"],
        "available_critical_error_ids": ["CRITICAL:OPPONENT_PRIVATE_INFERENCE"],
    }
    case["human"] = {
        "claim_ids": ["CLAIM:TENDENCY_REFUSE_OPPONENT_PRIVATE"],
        "evidence_ids": ["POLICY:NO_OPPONENT_PRIVATE"],
        "boundary_ids": ["BOUNDARY:NO_OPPONENT_PRIVATE"],
        "critical_error_ids": [],
        "duration_seconds": 30,
        "accepted_without_edit": True,
    }

    with pytest.raises(AIHoldoutAssemblyError, match="private data fields"):
        prepare_holdout_templates(human, created_at="2026-08-26T03:00:00Z")


def test_assembler_builds_the_existing_private_evaluator_contract() -> None:
    human, expert, ai, _ = _filled_templates()

    run = assemble_paired_evaluation(human, expert, ai)
    report = evaluate_ai_against_human(run, AIValidationPolicy(minimum_paired_holdout_cases=2))

    assert run["artifact_type"] == "ai-human-paired-evaluation"
    assert len(run["cases"]) == 2
    assert all(case["case_id"].startswith("case-") for case in run["cases"])
    assert all("task_key" not in case for case in run["cases"])
    assert report["status"] == "VALIDATED"


def test_assembler_rejects_missing_cases_and_changed_task_content() -> None:
    human, expert, ai, _ = _filled_templates()
    ai_missing = deepcopy(ai)
    ai_missing["cases"].pop()
    with pytest.raises(AIHoldoutAssemblyError, match="task set mismatch"):
        assemble_paired_evaluation(human, expert, ai_missing)

    changed = deepcopy(expert)
    changed["cases"][0]["task"]["metrics"]["current_pick_presence"] = 0.99
    with pytest.raises(AIHoldoutAssemblyError, match="task content changed"):
        assemble_paired_evaluation(human, changed, ai)


def test_ai_hallucinated_ids_reach_the_deterministic_critical_gate() -> None:
    human, expert, ai, _ = _filled_templates()
    ai["cases"][0]["ai"]["claim_ids"] = ["CLAIM:INVENTED"]

    run = assemble_paired_evaluation(human, expert, ai)
    report = evaluate_ai_against_human(run, AIValidationPolicy(minimum_paired_holdout_cases=2))

    assert report["status"] == "REJECTED"
    assert "ZERO_CRITICAL_ERRORS" in report["failed_gates"]


def test_holdout_cli_prepares_and_assembles_private_files(tmp_path) -> None:
    human_path = tmp_path / "human.json"
    expert_path = tmp_path / "expert.json"
    ai_path = tmp_path / "ai.json"
    run_path = tmp_path / "paired.json"
    human_path.write_text(json.dumps(_human_bundle()), encoding="utf-8")

    assert (
        main(
            [
                "prepare-ai-holdout",
                "--human-baselines",
                str(human_path),
                "--reference-template",
                str(expert_path),
                "--ai-template",
                str(ai_path),
                "--created-at",
                "2026-08-26T03:00:00Z",
            ]
        )
        == 0
    )
    expert = json.loads(expert_path.read_text(encoding="utf-8"))
    ai = json.loads(ai_path.read_text(encoding="utf-8"))
    _, filled_expert, filled_ai, _ = _filled_templates()
    expert.update({key: filled_expert[key] for key in ("sealed_at", "cases")})
    ai.update({key: filled_ai[key] for key in ("run_id", "evaluated_at", "system", "cases")})
    expert_path.write_text(json.dumps(expert), encoding="utf-8")
    ai_path.write_text(json.dumps(ai), encoding="utf-8")

    assert (
        main(
            [
                "assemble-ai-holdout",
                "--human-baselines",
                str(human_path),
                "--expert-references",
                str(expert_path),
                "--ai-outputs",
                str(ai_path),
                "--output",
                str(run_path),
            ]
        )
        == 0
    )
    assert json.loads(run_path.read_text(encoding="utf-8"))["cases"]


def test_holdout_cli_refuses_raw_templates_under_public_feed(tmp_path) -> None:
    human_path = tmp_path / "human.json"
    ai_path = tmp_path / "ai.json"
    human_path.write_text(json.dumps(_human_bundle()), encoding="utf-8")

    with pytest.raises(ValueError, match="must not be written under"):
        main(
            [
                "prepare-ai-holdout",
                "--human-baselines",
                str(human_path),
                "--reference-template",
                "web/public/feed/private-expert-reference.json",
                "--ai-template",
                str(ai_path),
            ]
        )
