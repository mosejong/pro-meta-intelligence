import json

import pytest

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.publishing import build_decision_outcomes, publish_decision_outcomes

HASH = f"sha256:{'a' * 64}"
AS_OF = "2026-08-24T03:00:00+00:00"


def _benchmark(*, ready: bool = False):
    return {
        "benchmark_kind": "OE_WALK_FORWARD_BLIND_SPOT",
        "source_id": "oracles-elixir-match-data",
        "status": "COMPLETE" if ready else "HISTORY_NOT_READY",
        "benchmark_ready": ready,
        "candidate_policy": {
            "ranking": "blind_spot_score_desc",
            "top_k": 2,
            "maximum_pre_cutoff_pick_presence": 0.1,
            "presence_filter_applies_before_top_k": True,
        },
        "outcome_policy": {
            "event": "future meaningful pro adoption",
            "same_patch_only": True,
            "minimum_future_picks": 2,
            "minimum_future_distinct_teams": 2,
            "confirmation_time": "second qualifying distinct-team pick",
        },
        "history_readiness": {
            "collection": {
                "last_retrieved_at": AS_OF,
            }
        },
        "cutoffs": [_cutoff()] if ready else [],
    }


def _cutoff():
    return {
        "cutoff": "2026-08-10T03:00:00+00:00",
        "outcome_end": "2026-08-17T03:00:00+00:00",
        "patch_id": "16.15",
        "selected_candidates": [
            {
                "rank": 1,
                "champion_id": "RekSai",
                "role": "JUNGLE",
                "outcome": "HIT",
                "evidence_event_ids": ["oe:pre:1"],
                "current_pick_presence": 0.02,
                "pick_presence_delta": 0.02,
                "demand_velocity": 0.1,
            },
            {
                "rank": 2,
                "champion_id": "Vi",
                "role": "JUNGLE",
                "outcome": "FALSE_ALERT",
                "evidence_event_ids": ["oe:pre:2"],
                "current_pick_presence": 0.01,
                "pick_presence_delta": 0.01,
                "demand_velocity": 0.05,
            },
        ],
        "actual_adoptions": [
            {
                "champion_id": "RekSai",
                "role": "JUNGLE",
                "confirmed_at": "2026-08-13T12:00:00+00:00",
                "future_pick_count": 3,
                "future_distinct_team_count": 2,
                "outcome_match_ids": ["match:1", "match:2"],
                "outcome_event_ids": ["oe:future:1", "oe:future:2"],
            },
            {
                "champion_id": "Poppy",
                "role": "SUPPORT",
                "confirmed_at": "2026-08-14T12:00:00+00:00",
                "future_pick_count": 2,
                "future_distinct_team_count": 2,
                "outcome_match_ids": ["match:3", "match:4"],
                "outcome_event_ids": ["oe:future:3", "oe:future:4"],
            },
        ],
        "failure_cases": [
            {
                "type": "MISSED_ADOPTION",
                "champion_id": "Poppy",
                "role": "SUPPORT",
            },
            {"type": "FALSE_ALERT", "champion_id": "Vi", "role": "JUNGLE"},
        ],
        "metrics": {
            "recall_at_k": 0.5,
            "precision_at_k": 0.5,
            "false_alert_rate": 0.5,
            "hit_count": 1,
            "miss_count": 1,
            "target_count": 2,
            "selected_count": 2,
            "median_lead_time_hours": 81.0,
        },
        "radar_source_versions": [
            {
                "source_id": "oracles-elixir-match-data",
                "source_version": HASH,
                "content_hash": HASH,
            }
        ],
    }


def test_decision_outcomes_stays_empty_until_history_is_ready() -> None:
    outcomes = build_decision_outcomes(_benchmark())

    assert outcomes["artifact_type"] == "team-decision-outcomes"
    assert outcomes["status"] == "HISTORY_NOT_READY"
    assert outcomes["benchmark_ready"] is False
    assert outcomes["as_of"] == AS_OF
    assert outcomes["evaluations"] == []
    assert outcomes["summary"] == {
        "evaluated_cutoff_count": 0,
        "selected_candidate_count": 0,
        "hit_count": 0,
        "false_alert_count": 0,
        "missed_adoption_count": 0,
    }
    serialized = json.dumps(outcomes).lower()
    assert "raw archive" in serialized
    assert "c:\\" not in serialized
    assert ".csv" not in serialized


def test_decision_outcomes_publish_only_matured_public_safe_evidence(tmp_path) -> None:
    outcomes = build_decision_outcomes(_benchmark(ready=True))
    path = publish_decision_outcomes(tmp_path, outcomes)

    assert outcomes["status"] == "COMPLETE"
    assert outcomes["summary"] == {
        "evaluated_cutoff_count": 1,
        "selected_candidate_count": 2,
        "hit_count": 1,
        "false_alert_count": 1,
        "missed_adoption_count": 1,
    }
    evaluation = outcomes["evaluations"][0]
    hit, false_alert = evaluation["selected_candidates"]
    assert hit["outcome"] == "HIT"
    assert hit["future_pick_count"] == 3
    assert hit["outcome_match_ids"] == ["match:1", "match:2"]
    assert false_alert["outcome"] == "FALSE_ALERT"
    assert false_alert["confirmed_at"] is None
    assert false_alert["outcome_match_ids"] == []
    assert evaluation["missed_adoptions"][0]["champion_id"] == "Poppy"
    assert path == tmp_path / "decision-outcomes.json"
    assert json.loads(path.read_text(encoding="utf-8")) == outcomes
    assert not list(tmp_path.glob(".decision-outcomes.json.*"))


def test_decision_outcomes_cli_publishes_from_a_benchmark(tmp_path) -> None:
    benchmark = tmp_path / "benchmark.json"
    benchmark.write_text(json.dumps(_benchmark()), encoding="utf-8")
    feed_dir = tmp_path / "feed"
    output = tmp_path / "summary.json"

    assert (
        main(
            [
                "build-decision-outcomes",
                "--benchmark",
                str(benchmark),
                "--feed-dir",
                str(feed_dir),
                "--output",
                str(output),
            ]
        )
        == 0
    )
    assert (feed_dir / "decision-outcomes.json").is_file()
    assert json.loads(output.read_text(encoding="utf-8"))["status"] == "PUBLISHED"


def test_decision_outcomes_rejects_unrelated_or_malformed_benchmarks() -> None:
    with pytest.raises(ValueError, match="walk-forward"):
        build_decision_outcomes({"benchmark_kind": "OTHER"})
    malformed = _benchmark(ready=True)
    malformed["cutoffs"][0]["selected_candidates"][0]["outcome"] = "UNKNOWN"
    with pytest.raises(ValueError, match="unsupported outcome"):
        build_decision_outcomes(malformed)

    missing_adoption = _benchmark(ready=True)
    missing_adoption["cutoffs"][0]["actual_adoptions"] = []
    with pytest.raises(ValueError, match="missing its actual adoption"):
        build_decision_outcomes(missing_adoption)
