import json

import pytest

from pro_meta_intelligence.publishing import build_history_status, publish_history_status


def _benchmark(*, ready: bool = False):
    return {
        "benchmark_kind": "OE_WALK_FORWARD_BLIND_SPOT",
        "source_id": "oracles-elixir-match-data",
        "status": "COMPLETE" if ready else "HISTORY_NOT_READY",
        "benchmark_ready": ready,
        "history_readiness": {
            "ready": ready,
            "blocking_reasons": [] if ready else ["RETRIEVAL_COUNT_BELOW_MINIMUM"],
            "warnings": ["KNOWN_IMPORT_EXCLUSIONS_PRESENT"],
            "criteria": {
                "minimum_retrievals": 14,
                "minimum_unique_states": 3,
                "minimum_collection_span_days": 14,
                "minimum_matured_cutoffs": 2,
            },
            "collection": {
                "retrieval_count": 14 if ready else 2,
                "unique_normalized_state_count": 3 if ready else 2,
                "collection_span_hours": 336.0 if ready else 24.0,
                "matured_cutoff_count": 2 if ready else 0,
                "last_retrieved_at": "2026-08-24T03:00:00+00:00",
            },
        },
        "aggregate": {"micro_recall_at_k": 0.5},
    }


def test_history_status_exposes_only_compact_operational_gates() -> None:
    status = build_history_status(_benchmark())

    assert status["artifact_type"] == "oe-history-status"
    assert status["history_ready"] is False
    assert status["benchmark_ready"] is False
    assert status["next_action"] == "KEEP_DAILY_COLLECTION"
    assert status["aggregate"] is None
    assert [(gate["id"], gate["current"], gate["required"]) for gate in status["gates"]] == [
        ("RETRIEVALS", 2, 14),
        ("UNIQUE_STATES", 2, 3),
        ("COLLECTION_SPAN", 1.0, 14),
        ("MATURED_CUTOFFS", 0, 2),
    ]
    assert "path" not in json.dumps(status).lower()


def test_history_status_includes_aggregate_only_after_benchmark_is_ready(tmp_path) -> None:
    status = build_history_status(_benchmark(ready=True))
    path = publish_history_status(tmp_path, status)

    assert status["next_action"] == "REVIEW_BENCHMARK_RESULTS"
    assert status["aggregate"] == {"micro_recall_at_k": 0.5}
    assert path == tmp_path / "history-status.json"
    assert json.loads(path.read_text(encoding="utf-8")) == status
    assert not list(tmp_path.glob(".history-status.json.*"))


def test_history_status_rejects_an_unrelated_report() -> None:
    with pytest.raises(ValueError, match="walk-forward"):
        build_history_status({"benchmark_kind": "OTHER"})
