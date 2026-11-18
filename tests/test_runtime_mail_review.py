"""Independent operational-health/notification lifecycle regression."""

from pro_meta_intelligence.creator import CreatorBriefBuilder
from pro_meta_intelligence.operations.notifications import is_repeated_incident
from pro_meta_intelligence.publishing import assess_publication_watchdog
from tests.test_publication_watchdog import (
    NOW,
    _ai_validation,
    _collection_status,
    _history,
    _outcomes,
    _radar,
    _schedule,
)


def test_confirmed_empty_creator_does_not_hide_or_realert_unchanged_schedule_outage():
    radar = _radar(
        entries=[{"champion_id": "Vi", "metrics": {}, "eligible_for_review": False}],
        evidence_index={
            "source_versions": [{"source_id": "reviewed", "content_hash": "sha256:" + "a" * 64}]
        },
    )
    creator = CreatorBriefBuilder().build(radar).to_dict()

    def check(schedule):
        return assess_publication_watchdog(
            radar,
            creator,
            _history(),
            _outcomes(),
            schedule,
            _ai_validation(),
            _collection_status(),
            checked_at=NOW,
        )

    stale = check(_schedule(retrieved_at="2026-08-20T10:00:00+00:00"))
    assert stale["healthy"] is False
    assert stale["failed_checks"] == ["SCHEDULE_PUBLICATION_FRESHNESS"]
    old_incident = (
        "- Status: UNHEALTHY\n- Failed checks: CREATOR_FEED_READY, SCHEDULE_PUBLICATION_FRESHNESS\n"
    )
    assert not is_repeated_incident(stale, old_incident)
    updated_incident = "- Status: UNHEALTHY\n- Failed checks: SCHEDULE_PUBLICATION_FRESHNESS\n"
    assert is_repeated_incident(stale, updated_incident)
    recovered = check(_schedule())
    assert recovered["healthy"] is True
    assert not is_repeated_incident(recovered, updated_incident)
