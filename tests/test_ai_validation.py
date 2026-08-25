from __future__ import annotations

import json
from copy import deepcopy

import pytest

from pro_meta_intelligence.ai_validation import AIValidationPolicy, evaluate_ai_against_human
from pro_meta_intelligence.cli import main


def _case(index: int, *, ai_duration: float = 20, ai_claims: list[str] | None = None):
    return {
        "case_id": f"case-{index:03d}",
        "split": "HOLDOUT",
        "reference": {
            "required_claim_ids": ["CLAIM:OBSERVED"],
            "allowed_claim_ids": ["CLAIM:OBSERVED", "CLAIM:COUNTERPOINT"],
            "required_evidence_ids": ["EVENT:1", "EVENT:2"],
            "allowed_evidence_ids": ["EVENT:1", "EVENT:2", "EVENT:3"],
            "required_boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
        },
        "human": {
            "claim_ids": ["CLAIM:OBSERVED"],
            "evidence_ids": ["EVENT:1", "EVENT:2"],
            "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "critical_error_ids": [],
            "duration_seconds": 60,
            "accepted_without_edit": True,
        },
        "ai": {
            "claim_ids": ai_claims or ["CLAIM:OBSERVED"],
            "evidence_ids": ["EVENT:1", "EVENT:2"],
            "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
            "critical_error_ids": [],
            "duration_seconds": ai_duration,
            "accepted_without_edit": True,
        },
    }


def _run(case_count: int = 30):
    return {
        "schema_version": "1",
        "artifact_type": "ai-human-paired-evaluation",
        "run_id": "holdout-2026-08",
        "task_type": "EVIDENCE_LOCKED_BRIEF",
        "evaluated_at": "2026-08-25T12:00:00+00:00",
        "system": {
            "provider": "provider-a",
            "model": "strategy-model",
            "model_version": "2026-08-20",
            "prompt_version": "brief-v3",
        },
        "cases": [_case(index) for index in range(case_count)],
    }


def test_ai_validation_passes_only_a_complete_human_comparison() -> None:
    report = evaluate_ai_against_human(_run())

    assert report["status"] == "VALIDATED"
    assert report["ai_features_enabled"] is True
    assert report["paired_holdout_case_count"] == 30
    assert report["metrics"]["ai"]["evidence_f1"] == 1.0
    assert report["metrics"]["paired_comparison"]["median_time_ratio"] == pytest.approx(1 / 3)
    assert report["failed_gates"] == []
    assert report["system_fingerprint"].startswith("sha256:")
    assert "provider-a" not in str(report)


def test_ai_validation_withholds_an_underpowered_run() -> None:
    report = evaluate_ai_against_human(_run(case_count=4))

    assert report["status"] == "NOT_VALIDATED"
    assert report["ai_features_enabled"] is False
    assert report["failed_gates"] == ["PAIRED_HOLDOUT_SAMPLE"]
    assert report["next_action"] == "COLLECT_PAIRED_HUMAN_HOLDOUTS"


def test_ai_validation_rejects_unsupported_claims_even_when_fast() -> None:
    run = _run()
    run["cases"][0] = _case(0, ai_duration=5, ai_claims=["CLAIM:INVENTED"])

    report = evaluate_ai_against_human(run)

    assert report["status"] == "REJECTED"
    assert report["ai_features_enabled"] is False
    assert "ZERO_CRITICAL_ERRORS" in report["failed_gates"]
    assert "CLAIM_ACCURACY_NONINFERIOR" in report["failed_gates"]


def test_ai_validation_ignores_dev_cases_for_the_release_gate() -> None:
    run = _run(case_count=29)
    dev_case = deepcopy(_case(99))
    dev_case["split"] = "DEV"
    run["cases"].append(dev_case)

    report = evaluate_ai_against_human(run)

    assert report["paired_holdout_case_count"] == 29
    assert report["status"] == "NOT_VALIDATED"


def test_ai_validation_rejects_duplicate_case_ids() -> None:
    run = _run(case_count=2)
    run["cases"][1]["case_id"] = run["cases"][0]["case_id"]

    with pytest.raises(ValueError, match="duplicate case_id"):
        evaluate_ai_against_human(run, AIValidationPolicy(minimum_paired_holdout_cases=2))


def test_ai_validation_cli_fails_closed_and_writes_aggregate_report(tmp_path) -> None:
    source = tmp_path / "paired.json"
    output = tmp_path / "status.json"
    source.write_text(json.dumps(_run(case_count=3)), encoding="utf-8")

    assert main([
        "evaluate-ai-assistant",
        "--input",
        str(source),
        "--minimum-paired-cases",
        "4",
        "--output",
        str(output),
    ]) == 2

    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["status"] == "NOT_VALIDATED"
    assert report["paired_holdout_case_count"] == 3
    assert "case-000" not in output.read_text(encoding="utf-8")
