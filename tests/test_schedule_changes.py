from copy import deepcopy

from pro_meta_intelligence.publishing import build_schedule_change_log


def snapshot(
    *,
    retrieved_at: str,
    content_hash: str,
    opponent_name: str = "TBD",
    opponent_code: str = "TBD",
    start_at: str = "2026-08-29T08:00:00+00:00",
    best_of: int = 5,
    team_name: str = "T1",
    team_code: str = "T1",
) -> dict[str, object]:
    return {
        "schema_version": "1",
        "artifact_type": "pro-schedule-snapshot",
        "source_id": "lol-esports-schedule",
        "retrieved_at": retrieved_at,
        "content_hash": f"sha256:{content_hash * 64}",
        "events": [
            {
                "event_id": f"lolesports:{content_hash * 20}",
                "start_at": start_at,
                "league": "LCK",
                "block": "Playoffs",
                "best_of": best_of,
                "participants": [
                    {"name": opponent_name, "code": opponent_code},
                    {"name": team_name, "code": team_code},
                ],
            }
        ],
    }


def test_schedule_change_log_initializes_without_inventing_a_change() -> None:
    current = snapshot(retrieved_at="2026-08-25T00:00:00+00:00", content_hash="a")

    result = build_schedule_change_log(None, current)

    assert result["artifact_type"] == "pro-schedule-change-log"
    assert result["watched_team"] == "T1"
    assert result["latest_run"] == {
        "status": "INITIALIZED",
        "change_count": 0,
        "changes": [],
    }
    assert result["history"] == []


def test_schedule_change_log_detects_tbd_confirmation_in_the_same_slot() -> None:
    previous = snapshot(retrieved_at="2026-08-25T00:00:00+00:00", content_hash="a")
    current = snapshot(
        retrieved_at="2026-08-25T06:00:00+00:00",
        content_hash="b",
        opponent_name="Gen.G Esports",
        opponent_code="GEN",
    )

    result = build_schedule_change_log(previous, current)
    changes = result["latest_run"]["changes"]

    assert result["latest_run"]["status"] == "CHANGED"
    assert len(changes) == 1
    assert changes[0]["type"] == "PARTICIPANT_CONFIRMED"
    assert changes[0]["severity"] == "ACTION_REQUIRED"
    assert changes[0]["correlation_method"] == "SAME_SLOT"
    assert changes[0]["previous_event"]["participants"][0]["name"] == "TBD"
    assert changes[0]["current_event"]["participants"][0]["name"] == "Gen.G Esports"


def test_schedule_change_log_detects_time_and_format_changes_for_a_confirmed_opponent() -> None:
    previous = snapshot(
        retrieved_at="2026-08-25T00:00:00+00:00",
        content_hash="a",
        opponent_name="한화생명e스포츠",
        opponent_code="HLE",
    )
    current = snapshot(
        retrieved_at="2026-08-25T06:00:00+00:00",
        content_hash="b",
        opponent_name="한화생명e스포츠",
        opponent_code="HLE",
        start_at="2026-08-29T10:00:00+00:00",
        best_of=3,
    )

    result = build_schedule_change_log(previous, current)
    changes = result["latest_run"]["changes"]

    assert {item["type"] for item in changes} == {"START_TIME_CHANGED", "FORMAT_CHANGED"}
    assert {item["correlation_method"] for item in changes} == {"SAME_CONFIRMED_OPPONENT"}


def test_schedule_change_log_retains_unique_history_on_an_unchanged_refresh() -> None:
    previous = snapshot(retrieved_at="2026-08-25T00:00:00+00:00", content_hash="a")
    confirmed = snapshot(
        retrieved_at="2026-08-25T06:00:00+00:00",
        content_hash="b",
        opponent_name="Gen.G Esports",
        opponent_code="GEN",
    )
    first_log = build_schedule_change_log(previous, confirmed)
    refreshed = deepcopy(confirmed)
    refreshed["retrieved_at"] = "2026-08-25T12:00:00+00:00"
    refreshed["content_hash"] = f"sha256:{'c' * 64}"

    result = build_schedule_change_log(confirmed, refreshed, first_log)

    assert result["latest_run"]["status"] == "UNCHANGED"
    assert result["latest_run"]["changes"] == []
    assert result["history"] == first_log["history"]


def test_schedule_change_log_uses_an_exact_watched_team_identity() -> None:
    previous = snapshot(retrieved_at="2026-08-25T00:00:00+00:00", content_hash="a")
    academy = snapshot(
        retrieved_at="2026-08-25T06:00:00+00:00",
        content_hash="b",
        opponent_name="Gen.G Academy",
        opponent_code="GENA",
        team_name="T1 Esports Academy",
        team_code="T1A",
    )

    result = build_schedule_change_log(previous, academy)
    changes = result["latest_run"]["changes"]

    assert {item["type"] for item in changes} == {"EVENT_REMOVED"}
    assert all(item["current_event"] is None for item in changes)
