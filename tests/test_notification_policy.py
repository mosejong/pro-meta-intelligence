from copy import deepcopy

import pytest

from pro_meta_intelligence.operations.notifications import (
    is_repeated_incident,
    is_source_delay_only,
)


def test_repeated_incident_ignores_age_and_retry_guidance_but_detects_changed_checks() -> None:
    previous = (
        "- Status: UNHEALTHY\n- Failed checks: RADAR_PUBLICATION_FRESHNESS\n"
        "- Next action: RUN_OE_SYNC_NOW\n- Radar age (hours): 143.356\n"
    )
    report = {
        "status": "UNHEALTHY",
        "healthy": False,
        "failed_checks": ["RADAR_PUBLICATION_FRESHNESS"],
        "next_action": "WAIT_FOR_SOURCE_RETRY_WINDOW",
    }
    assert is_repeated_incident(report, previous)
    assert not is_repeated_incident(report, "")
    assert not is_repeated_incident(report, previous.replace("UNHEALTHY", "ENDPOINT_FETCH_FAILED"))
    report["failed_checks"].append("SCHEDULE_PUBLICATION_FRESHNESS")
    assert not is_repeated_incident(report, previous)
    assert is_repeated_incident(
        report,
        "- Status: UNHEALTHY\n"
        "- Failed checks: SCHEDULE_PUBLICATION_FRESHNESS, RADAR_PUBLICATION_FRESHNESS\n",
    )


@pytest.mark.parametrize("failed", [None, [], "RADAR_PUBLICATION_FRESHNESS", [None]])
def test_missing_or_malformed_assessment_never_suppresses_notification(failed) -> None:
    report = {"status": "UNHEALTHY", "healthy": False, "failed_checks": failed}
    assert not is_repeated_incident(report, "- Status: UNHEALTHY\n- Failed checks: \n")


@pytest.mark.parametrize(
    "acquisition", ["REUSED_CACHE_AFTER_SOURCE_ERROR", "REUSED_CACHE_DURING_SOURCE_BACKOFF"]
)
def test_collector_defers_only_accepted_source_delay_to_public_watchdog(acquisition) -> None:
    sync = {
        "status": "SUCCEEDED",
        "exit_code": 0,
        "result": {"status": "PUBLISHED", "source_acquisition": {"status": acquisition}},
    }
    health = {
        "status": "UNHEALTHY",
        "healthy": False,
        "failed_checks": ["SOURCE_SNAPSHOT_FRESHNESS"],
    }
    collection = {"state": "SOURCE_DELAYED"}
    assert is_source_delay_only(sync, health, collection)
    for changed in (
        {**sync, "status": "FAILED"},
        {**sync, "exit_code": 2},
        {**sync, "result": None},
        {**sync, "result": {"status": "REJECTED_READINESS"}},
    ):
        assert not is_source_delay_only(changed, health, collection)
    for changed in (
        {},
        {**health, "failed_checks": ["LAST_JOB_SUCCEEDED"]},
        {**health, "failed_checks": ["SOURCE_SNAPSHOT_FRESHNESS", "PUBLIC_FEED_READY"]},
    ):
        assert not is_source_delay_only(sync, changed, collection)
    for state in ("PUBLICATION_REJECTED", "SOURCE_UNAVAILABLE", "RUN_FAILED"):
        assert not is_source_delay_only(sync, health, {"state": state})
    downloaded = deepcopy(sync)
    downloaded["result"]["source_acquisition"]["status"] = "DOWNLOADED"
    assert not is_source_delay_only(downloaded, health, collection)
