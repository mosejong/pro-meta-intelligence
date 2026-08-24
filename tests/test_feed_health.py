from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.publishing import assess_oe_feed_health

NOW = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)


def _latest_job(**updates):
    value = {
        "status": "SUCCEEDED",
        "exit_code": 0,
        "finished_at": "2026-08-24T11:55:00+00:00",
    }
    value.update(updates)
    return value


def _feed(**updates):
    value = {
        "schema_version": "1",
        "fixture_only": False,
        "patch_id": "16.16",
        "publication_readiness": {"ready_for_radar": True},
        "entries": [{"champion_id": "RekSai"}],
    }
    value.update(updates)
    return value


def _history(**updates):
    value = {
        "schema_version": "1",
        "artifact_type": "oe-history-status",
        "as_of": "2026-08-24T11:30:00+00:00",
        "status": "HISTORY_NOT_READY",
        "history_ready": False,
        "benchmark_ready": False,
        "gates": [
            {"id": gate_id, "current": 1, "required": 2, "unit": "items", "passed": False}
            for gate_id in (
                "RETRIEVALS",
                "UNIQUE_STATES",
                "COLLECTION_SPAN",
                "MATURED_CUTOFFS",
            )
        ],
        "next_action": "KEEP_DAILY_COLLECTION",
    }
    value.update(updates)
    return value


def test_health_treats_expected_history_collection_as_healthy() -> None:
    report = assess_oe_feed_health(_latest_job(), _feed(), _history(), checked_at=NOW)

    assert report["healthy"] is True
    assert report["status"] == "HEALTHY"
    assert report["phase"] == "COLLECTING_HISTORY"
    assert report["failed_checks"] == []
    assert report["next_action"] == "KEEP_DAILY_COLLECTION"


def test_health_fails_closed_for_a_failed_job() -> None:
    report = assess_oe_feed_health(
        _latest_job(status="FAILED", exit_code=1), _feed(), _history(), checked_at=NOW
    )

    assert report["healthy"] is False
    assert "LAST_JOB_SUCCEEDED" in report["failed_checks"]
    assert report["next_action"] == "INSPECT_LAST_JOB"


def test_health_detects_stale_source_without_calling_history_incomplete_an_outage() -> None:
    report = assess_oe_feed_health(
        _latest_job(),
        _feed(),
        _history(as_of="2026-08-20T00:00:00+00:00"),
        checked_at=NOW,
    )

    assert report["healthy"] is False
    assert report["failed_checks"] == ["SOURCE_SNAPSHOT_FRESHNESS"]
    assert report["next_action"] == "RUN_SYNC_NOW"


def test_health_fails_closed_when_operational_artifacts_are_missing() -> None:
    report = assess_oe_feed_health(None, None, None, checked_at=NOW)

    assert report["healthy"] is False
    assert set(report["failed_checks"]) == {
        "LAST_JOB_SUCCEEDED",
        "JOB_FRESHNESS",
        "PUBLIC_FEED_READY",
        "HISTORY_STATUS_VALID",
        "PUBLIC_BOUNDARY_SAFE",
        "SOURCE_SNAPSHOT_FRESHNESS",
    }


def test_health_rejects_structurally_incomplete_public_artifacts() -> None:
    report = assess_oe_feed_health(
        _latest_job(), _feed(entries=[]), _history(gates=[{"id": "RETRIEVALS"}] * 4), checked_at=NOW
    )

    assert "PUBLIC_FEED_READY" in report["failed_checks"]
    assert "HISTORY_STATUS_VALID" in report["failed_checks"]


def test_health_blocks_private_paths_and_product_login_branding() -> None:
    report = assess_oe_feed_health(
        _latest_job(),
        _feed(debug_path=r"C:\Users\operator\raw.csv"),
        _history(boundary="GPT 로그인 / Sign in with OpenAI"),
        checked_at=NOW,
    )

    boundary = next(check for check in report["checks"] if check["id"] == "PUBLIC_BOUNDARY_SAFE")
    assert boundary["passed"] is False
    assert boundary["observed"]["blocked_field_count"] == 2
    assert boundary["observed"]["blocked_field_paths"] == [
        "current.debug_path",
        "history.boundary",
    ]
    assert report["next_action"] == "HALT_PUBLICATION"


def test_health_rejects_naive_time_and_nonpositive_thresholds() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        assess_oe_feed_health(_latest_job(), _feed(), _history(), checked_at=datetime(2026, 8, 24))
    with pytest.raises(ValueError, match="positive"):
        assess_oe_feed_health(
            _latest_job(), _feed(), _history(), checked_at=NOW, maximum_job_age_hours=0
        )
