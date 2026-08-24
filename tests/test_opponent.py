from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction
from pro_meta_intelligence.opponent import OpponentPrepBuilder, OpponentPrepConfig
from pro_meta_intelligence.sources import SourceRegistry

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
RETRIEVED_AT = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)


def imported_fixture():
    return OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        FIXTURE,
        retrieved_at=RETRIEVED_AT,
        source_timezone="+09:00",
        source_uri="https://drive.google.com/example",
    )


def build(imported=None):
    imported = imported or imported_fixture()
    return (
        OpponentPrepBuilder()
        .build(
            imported.matches,
            imported.draft_events,
            OpponentPrepConfig(
                cutoff=RETRIEVED_AT,
                patch_id="16.15",
                profile_team_names=("Blue Team",),
            ),
        )
        .to_dict()
    )


def test_opponent_prep_preserves_picks_bans_sides_and_evidence() -> None:
    report = build()

    assert report["schema_version"] == "1"
    assert report["artifact_type"] == "opponent-prep-pack"
    assert report["team_count"] == 2
    blue = next(team for team in report["teams"] if team["team_id"] == "oe:team:blue")
    red = next(team for team in report["teams"] if team["team_id"] == "oe:team:red")
    assert blue["team_name"] == "Blue Team"
    assert blue["game_count"] == 1
    assert blue["side_stats"]["BLUE"] == {
        "game_count": 1,
        "win_count": 0,
        "win_rate": 0.0,
    }
    assert blue["first_pick_rate"] == 1.0
    assert {item["champion_id"] for item in blue["priority_picks"]} == {
        "Ahri",
        "Corki",
        "Gnar",
        "Leona",
        "Xin Zhao",
    }
    assert {item["champion_id"] for item in blue["frequent_bans"]} == {
        "Azir",
        "Rakan",
        "Varus",
        "Vi",
        "Yone",
    }
    assert {item["champion_id"] for item in blue["received_bans"]} == {
        "Aurora",
        "Nautilus",
        "Orianna",
        "Rumble",
        "Sejuani",
    }
    assert blue["first_rotations"][0]["champions"] == ["Xin Zhao", "Gnar", "Corki"]
    assert [player["player_name"] for player in blue["player_profiles"]] == [
        "Atlas",
        "Comet",
        "Nova",
        "Pulse",
        "Warden",
    ]
    assert {player["roster_status"] for player in blue["player_profiles"]} == {"CURRENT"}
    assert blue["player_profiles"][0]["champions"][0]["champion_id"] == "Gnar"
    assert blue["recent_games"][0]["opponent_team_name"] == "Red Team"
    assert blue["recent_games"][0]["result"] == "LOSS"
    assert blue["recent_games"][0]["picks"][0]["player_name"] == "Comet"
    assert blue["patch_comparison"]["status"] == "NO_BASELINE"
    assert blue["series_tracking"]["provider_series_id_available"] is False
    assert blue["quality_flags"] == ["LOW_MATCH_SAMPLE"]
    assert blue["evidence"]["match_ids"] == ["oe:LCK:GAME001"]
    assert len(blue["evidence"]["draft_event_ids"]) == 20
    assert "player_profiles" not in red


def test_opponent_prep_compares_player_picks_with_the_previous_available_patch() -> None:
    imported = imported_fixture()
    current_match = imported.matches[0]
    previous_match = replace(
        current_match,
        match_id="oe:LCK:GAME000",
        series_id="oe:LCK:GAME000:series-unavailable",
        patch_id="16.14",
        observed_at=current_match.observed_at - timedelta(days=14),
    )
    previous_events = tuple(
        replace(
            event,
            event_id=event.event_id.replace("GAME001", "GAME000"),
            match_id=previous_match.match_id,
            champion_id="Orianna" if event.champion_id == "Ahri" else event.champion_id,
            observed_at=previous_match.observed_at,
        )
        for event in imported.draft_events
    )

    report = (
        OpponentPrepBuilder()
        .build(
            (previous_match, *imported.matches),
            (*previous_events, *imported.draft_events),
            OpponentPrepConfig(
                cutoff=RETRIEVED_AT,
                patch_id="16.15",
                profile_team_names=("Blue Team",),
            ),
        )
        .to_dict()
    )
    blue = next(team for team in report["teams"] if team["team_id"] == "oe:team:blue")

    assert report["previous_patch_id"] == "16.14"
    assert blue["patch_comparison"]["status"] == "OBSERVED"
    assert blue["patch_comparison"]["previous_game_count"] == 1
    assert blue["patch_comparison"]["emerging"][0]["champion_id"] == "Ahri"
    assert blue["patch_comparison"]["emerging"][0]["delta"] == 1.0
    assert blue["patch_comparison"]["cooling"][0]["champion_id"] == "Orianna"
    assert blue["patch_comparison"]["cooling"][0]["delta"] == -1.0


def test_opponent_prep_discloses_incomplete_ban_evidence() -> None:
    imported = imported_fixture()
    events = tuple(
        event
        for event in imported.draft_events
        if not (event.action is DraftAction.BAN and event.sequence == 10)
    )

    report = (
        OpponentPrepBuilder()
        .build(
            imported.matches,
            events,
            OpponentPrepConfig(cutoff=RETRIEVED_AT, patch_id="16.15"),
        )
        .to_dict()
    )

    assert all("INCOMPLETE_BAN_EVIDENCE" in team["quality_flags"] for team in report["teams"])


def test_opponent_prep_cannot_backdate_current_snapshot() -> None:
    imported = imported_fixture()

    with pytest.raises(ValueError, match="no matches available"):
        OpponentPrepBuilder().build(
            imported.matches,
            imported.draft_events,
            OpponentPrepConfig(
                cutoff=datetime(2026, 8, 21, 23, 59, tzinfo=UTC),
                patch_id="16.15",
            ),
        )
