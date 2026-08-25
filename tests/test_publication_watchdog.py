import json
from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.publishing import assess_publication_watchdog

NOW = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
CUTOFF = "2026-08-25T11:00:00+00:00"


def _radar(**updates):
    value = {
        "schema_version": "1",
        "fixture_only": False,
        "patch_id": "16.16",
        "cutoff": CUTOFF,
        "publication_readiness": {"ready_for_radar": True},
        "entries": [{"champion_id": "Vi"}],
    }
    value.update(updates)
    return value


def _creator(**updates):
    value = {
        "schema_version": "1",
        "mode": "CREATOR",
        "publication_ready": False,
        "human_review_required": True,
        "source_snapshot": {
            "patch_id": "16.16",
            "cutoff": CUTOFF,
            "fixture_only": False,
        },
        "topic_candidates": [{"candidate_id": "Vi:JUNGLE"}],
    }
    value.update(updates)
    return value


def _history(**updates):
    value = {
        "schema_version": "1",
        "artifact_type": "oe-history-status",
        "as_of": CUTOFF,
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


def _schedule(**updates):
    value = {
        "schema_version": "1",
        "artifact_type": "pro-schedule-snapshot",
        "source_id": "lol-esports-schedule",
        "retrieved_at": "2026-08-25T10:00:00+00:00",
        "content_hash": f"sha256:{'a' * 64}",
        "source_url": "https://lolesports.com/en-US/leagues/lck",
        "events": [],
    }
    value.update(updates)
    return value


def test_publication_watchdog_accepts_paired_fresh_feeds_during_history_collection() -> None:
    report = assess_publication_watchdog(
        _radar(), _creator(), _history(), _schedule(), checked_at=NOW
    )

    assert report["healthy"] is True
    assert report["status"] == "HEALTHY"
    assert report["phase"] == "COLLECTING_HISTORY"
    assert report["failed_checks"] == []
    assert report["next_action"] == "KEEP_MONITORING"


def test_publication_watchdog_fails_closed_for_an_unpaired_creator() -> None:
    creator = _creator()
    creator["source_snapshot"] = {**creator["source_snapshot"], "patch_id": "16.15"}

    report = assess_publication_watchdog(_radar(), creator, _history(), _schedule(), checked_at=NOW)

    assert report["failed_checks"] == ["RADAR_CREATOR_PAIRED"]
    assert report["next_action"] == "RESTORE_PAIRED_CREATOR_FEED"


def test_publication_watchdog_distinguishes_radar_and_schedule_staleness() -> None:
    radar = _radar(cutoff="2026-08-20T00:00:00+00:00")
    creator = _creator()
    creator["source_snapshot"] = {
        **creator["source_snapshot"],
        "cutoff": "2026-08-20T00:00:00+00:00",
    }
    history = _history(as_of="2026-08-20T00:00:00+00:00")

    report = assess_publication_watchdog(
        radar,
        creator,
        history,
        _schedule(retrieved_at="2026-08-20T00:00:00+00:00"),
        checked_at=NOW,
    )

    assert report["failed_checks"] == [
        "RADAR_PUBLICATION_FRESHNESS",
        "SCHEDULE_PUBLICATION_FRESHNESS",
    ]
    assert report["next_action"] == "RUN_OE_SYNC_NOW"


def test_publication_watchdog_rejects_missing_or_unsafe_public_artifacts() -> None:
    missing = assess_publication_watchdog(None, None, None, None, checked_at=NOW)
    assert missing["healthy"] is False
    assert "PUBLIC_FEED_READY" in missing["failed_checks"]
    assert "CREATOR_FEED_READY" in missing["failed_checks"]
    assert "SCHEDULE_FEED_READY" in missing["failed_checks"]

    unsafe = assess_publication_watchdog(
        _radar(debug_path="/safe-looking"),
        _creator(notes="Sign in with OpenAI"),
        _history(),
        _schedule(),
        checked_at=NOW,
    )
    boundary = next(check for check in unsafe["checks"] if check["id"] == "PUBLIC_BOUNDARY_SAFE")
    assert boundary["passed"] is False
    assert boundary["observed"]["blocked_field_paths"] == ["creator.notes"]
    assert unsafe["next_action"] == "HALT_PUBLICATION"


def test_publication_watchdog_rejects_invalid_time_configuration() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        assess_publication_watchdog(
            _radar(), _creator(), _history(), _schedule(), checked_at=datetime(2026, 8, 25)
        )
    with pytest.raises(ValueError, match="positive"):
        assess_publication_watchdog(
            _radar(),
            _creator(),
            _history(),
            _schedule(),
            checked_at=NOW,
            maximum_radar_age_hours=0,
        )


def test_publication_watchdog_cli_writes_machine_readable_report(tmp_path) -> None:
    feed_dir = tmp_path / "feed"
    feed_dir.mkdir()
    for name, payload in (
        ("current.json", _radar()),
        ("current-creator.json", _creator()),
        ("history-status.json", _history()),
        ("schedule.json", _schedule()),
    ):
        (feed_dir / name).write_text(json.dumps(payload), encoding="utf-8")
    output = tmp_path / "watchdog.json"

    assert (
        main(
            [
                "check-publication-watchdog",
                "--feed-dir",
                str(feed_dir),
                "--now",
                NOW.isoformat(),
                "--output",
                str(output),
            ]
        )
        == 0
    )
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["artifact_type"] == "public-publication-watchdog"
    assert report["healthy"] is True

    (feed_dir / "current-creator.json").unlink()
    assert (
        main(
            [
                "check-publication-watchdog",
                "--feed-dir",
                str(feed_dir),
                "--now",
                NOW.isoformat(),
            ]
        )
        == 2
    )
