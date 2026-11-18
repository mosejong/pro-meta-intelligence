"""Watchdog acceptance of a legitimately empty Creator feed (no eligible Radar candidates)."""

import copy
from datetime import UTC, datetime

from test_publication_watchdog import (
    _ai_validation,
    _collection_status,
    _history,
    _outcomes,
    _schedule,
)

from pro_meta_intelligence.creator import CreatorBriefBuilder
from pro_meta_intelligence.publishing import assess_publication_watchdog

NOW = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
CUTOFF = "2026-08-25T11:00:00+00:00"
HASH = f"sha256:{'e' * 64}"


def _entry(champion: str, *, eligible: object = False) -> dict:
    return {
        "champion_id": champion,
        "role": "JUNGLE",
        "rank": 1,
        "eligible_for_review": eligible,
        "metrics": {"pick_presence_delta": 0.01},
    }


def _radar(**updates) -> dict:
    value = {
        "schema_version": "1",
        "fixture_only": False,
        "patch_id": "16.20",
        "cutoff": CUTOFF,
        "analysis_window": {
            "availability_cutoff": CUTOFF,
            "end_inclusive": CUTOFF,
            "historical": False,
            "mode": "ROLLING",
        },
        "publication_readiness": {"ready_for_radar": True},
        "entries": [_entry("Vi"), _entry("Sejuani")],
        "evidence_index": {
            "source_versions": [
                {
                    "content_hash": HASH,
                    "source_id": "oracles-elixir-match-data",
                    "source_version": HASH,
                }
            ]
        },
    }
    value.update(updates)
    return value


def _empty_creator(radar: dict) -> dict:
    return copy.deepcopy(CreatorBriefBuilder().build(radar).to_dict())


def _watchdog(radar: dict, creator: dict, *, schedule: dict | None = None, now=NOW) -> dict:
    return assess_publication_watchdog(
        radar,
        creator,
        _history(),
        _outcomes(),
        schedule or _schedule(),
        _ai_validation(),
        _collection_status(),
        checked_at=now,
    )


def _creator_check(report: dict) -> dict:
    return next(check for check in report["checks"] if check["id"] == "CREATOR_FEED_READY")


def test_builder_no_candidate_output_is_a_confirmed_empty_creator() -> None:
    radar = _radar()
    creator = _empty_creator(radar)
    assert creator["topic_candidates"] == []
    assert creator["warnings"] == ["NO_ELIGIBLE_CANDIDATES"]

    report = _watchdog(radar, creator)

    check = _creator_check(report)
    assert check["passed"] is True
    assert check["observed"]["creator_state"] == "EMPTY_CONFIRMED"
    assert check["observed"]["topic_count"] == 0
    assert report["healthy"] is True
    assert report["failed_checks"] == []
    # Human approval boundary is untouched.
    assert creator["publication_ready"] is False
    assert creator["human_review_required"] is True


def test_confirmed_empty_creator_does_not_hide_stale_schedule() -> None:
    # Mirrors watchdog run 44262583725 / issue #120: only the schedule failure must remain.
    radar = _radar()
    report = _watchdog(
        radar,
        _empty_creator(radar),
        schedule=_schedule(retrieved_at="2026-08-20T16:00:00+00:00"),
    )

    assert _creator_check(report)["passed"] is True
    assert report["healthy"] is False
    assert report["failed_checks"] == ["SCHEDULE_PUBLICATION_FRESHNESS"]


def test_confirmed_empty_creator_does_not_hide_stale_radar() -> None:
    old = "2026-08-20T11:00:00+00:00"
    radar = _radar(cutoff=old)
    report = _watchdog(radar, _empty_creator(radar))

    assert report["healthy"] is False
    assert "RADAR_PUBLICATION_FRESHNESS" in report["failed_checks"]


def test_empty_radar_entries_keep_radar_check_failing() -> None:
    radar = _radar(entries=[])
    report = _watchdog(radar, _empty_creator(radar))

    assert _creator_check(report)["passed"] is True
    assert report["healthy"] is False
    assert "PUBLIC_FEED_READY" in report["failed_checks"]


def test_empty_topics_without_warning_fail() -> None:
    radar = _radar()
    creator = _empty_creator(radar)
    creator["warnings"] = []

    check = _creator_check(_watchdog(radar, creator))
    assert check["passed"] is False
    assert check["observed"]["creator_state"] == "NOT_READY"


def test_bare_topics_and_warning_string_are_not_enough() -> None:
    radar = _radar()
    creator = {
        "schema_version": "1",
        "mode": "CREATOR",
        "publication_ready": False,
        "human_review_required": True,
        "source_snapshot": {"patch_id": "16.20", "cutoff": CUTOFF, "fixture_only": False},
        "topic_candidates": [],
        "warnings": ["NO_ELIGIBLE_CANDIDATES"],
    }

    assert _creator_check(_watchdog(radar, creator))["passed"] is False


def test_lost_candidates_fail_when_radar_has_an_eligible_entry() -> None:
    radar = _radar()
    creator = _empty_creator(radar)
    radar["entries"] = [_entry("Vi", eligible=True), _entry("Sejuani")]

    report = _watchdog(radar, creator)
    assert _creator_check(report)["passed"] is False
    assert "CREATOR_FEED_READY" in report["failed_checks"]


def test_malformed_eligibility_fails() -> None:
    for bad in (0, None, "false", "missing"):
        radar = _radar()
        creator = _empty_creator(radar)
        entry = _entry("Vi", eligible=bad)
        if bad == "missing":
            del entry["eligible_for_review"]
        radar["entries"] = [entry]
        assert _creator_check(_watchdog(radar, creator))["passed"] is False, bad

    radar = _radar()
    creator = _empty_creator(radar)
    radar["entries"] = [{"champion_id": "Vi", "eligible_for_review": False}]
    assert _creator_check(_watchdog(radar, creator))["passed"] is False


def test_source_mismatch_fails() -> None:
    radar = _radar()
    creator = _empty_creator(radar)

    other_hash = _radar()
    other_hash["evidence_index"]["source_versions"][0]["content_hash"] = f"sha256:{'f' * 64}"
    assert _creator_check(_watchdog(other_hash, creator))["passed"] is False

    for field, value in (("patch_id", "16.19"), ("cutoff", "2026-08-25T10:00:00+00:00")):
        mismatched = copy.deepcopy(creator)
        mismatched["source_snapshot"][field] = value
        report = _watchdog(radar, mismatched)
        assert _creator_check(report)["passed"] is False, field
        assert "RADAR_CREATOR_PAIRED" in report["failed_checks"], field

    changed_window = _radar()
    changed_window["analysis_window"] = {**changed_window["analysis_window"], "historical": True}
    assert _creator_check(_watchdog(changed_window, creator))["passed"] is False


def test_missing_or_unhashed_radar_source_fails() -> None:
    radar = _radar()
    creator = _empty_creator(radar)

    assert _creator_check(_watchdog(None, creator))["passed"] is False

    no_index = _radar()
    del no_index["evidence_index"]
    assert _creator_check(_watchdog(no_index, creator))["passed"] is False

    for versions in ([], [{"content_hash": "not-a-hash"}]):
        bad = _radar()
        bad["evidence_index"]["source_versions"] = versions
        stale_creator = copy.deepcopy(creator)
        stale_creator["source_snapshot"]["source_versions"] = versions
        assert _creator_check(_watchdog(bad, stale_creator))["passed"] is False


def test_fixture_radar_fails() -> None:
    radar = _radar(fixture_only=True)
    assert _creator_check(_watchdog(radar, _empty_creator(radar)))["passed"] is False


def test_incomplete_or_altered_creator_fails() -> None:
    radar = _radar()
    base = _empty_creator(radar)
    alterations = {
        "missing_constraints": lambda c: c.pop("narrative_constraints"),
        "missing_handoff": lambda c: c.pop("ai_handoff"),
        "template": lambda c: c.update(template_version="creator-brief-v0"),
        "publication_ready": lambda c: c.update(publication_ready=True),
        "human_review": lambda c: c.update(human_review_required=False),
        "extra_warning": lambda c: c["warnings"].append("UNEXPECTED"),
        "topics_not_list": lambda c: c.update(topic_candidates=None),
    }
    for name, alter in alterations.items():
        creator = copy.deepcopy(base)
        alter(creator)
        assert _creator_check(_watchdog(radar, creator))["passed"] is False, name


def test_inactive_patch_warning_must_also_match_builder() -> None:
    radar = _radar()
    radar["analysis_window"] = {**radar["analysis_window"], "mode": "LAST_ACTIVE_PATCH"}
    creator = _empty_creator(radar)
    assert creator["warnings"] == ["NO_ELIGIBLE_CANDIDATES", "INACTIVE_PATCH_HISTORICAL_WINDOW"]
    assert _creator_check(_watchdog(radar, creator))["passed"] is True

    creator["warnings"] = ["NO_ELIGIBLE_CANDIDATES"]
    assert _creator_check(_watchdog(radar, creator))["passed"] is False


def test_existing_nonempty_topics_branch_is_unchanged() -> None:
    creator = {
        "schema_version": "1",
        "mode": "CREATOR",
        "publication_ready": False,
        "human_review_required": True,
        "source_snapshot": {"patch_id": "16.20", "cutoff": CUTOFF, "fixture_only": False},
        "topic_candidates": [{"candidate_id": "Vi:JUNGLE"}],
    }
    report = _watchdog(_radar(), creator)

    check = _creator_check(report)
    assert check["passed"] is True
    assert check["observed"]["creator_state"] == "TOPICS_AVAILABLE"
    assert check["observed"]["topic_count"] == 1
    assert report["healthy"] is True

    report = _watchdog(_radar(), {**creator, "publication_ready": True})
    assert _creator_check(report)["passed"] is False
    assert report["next_action"] == "RESTORE_PAIRED_CREATOR_FEED"
