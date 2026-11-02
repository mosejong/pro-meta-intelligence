from datetime import timedelta

import pytest

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.opponent import DraftScoutBuilder, DraftScoutConfig
from pro_meta_intelligence.radar.models import LeagueRegionMap
from pro_meta_intelligence.sources import SourceRegistry
from tests.test_opponent import FIXTURE, RETRIEVED_AT


def build(**overrides):
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        FIXTURE,
        retrieved_at=RETRIEVED_AT,
        source_timezone="+09:00",
        source_uri="https://drive.google.com/example",
    )
    settings = {
        "cutoff": RETRIEVED_AT,
        "target_team_name": "Red Team",
        "own_team_name": "Blue Team",
        **overrides,
    }
    config = DraftScoutConfig(**settings)
    return (
        DraftScoutBuilder()
        .build(imported.matches, imported.draft_events, LeagueRegionMap.load_default(), config)
        .to_dict()
    )


def test_draft_scout_separates_phases_rotations_and_last_pick() -> None:
    report = build()

    assert report["artifact_type"] == "draft-scout-pack"
    target = report["target"]
    own = report["own"]
    assert target["game_count"] == own["game_count"] == 1
    assert target["home_league"] == "LCK"
    assert own["first_selection"]["game_count"] == 1
    assert target["first_selection"]["game_count"] == 0
    assert len(target["phase_one_bans"]) == 3
    assert len(target["phase_two_bans"]) == 2
    assert {item["champion_id"] for item in own["received_phase_one_bans"]} == {
        item["champion_id"] for item in target["phase_one_bans"]
    }
    assert [item["champion_id"] for item in own["first_rotation_picks"]] == ["Xin Zhao"]
    assert len(target["first_rotation_picks"]) == 2
    assert target["last_pick"]["game_count"] == 1
    assert target["last_pick"]["roles"][0]["game_count"] == 1
    assert own["last_pick"]["game_count"] == 0
    assert {pool["role"] for pool in target["player_pools"]} == {
        "TOP",
        "JUNGLE",
        "MID",
        "BOTTOM",
        "SUPPORT",
    }
    assert all(pool["unique_champions"] == 1 for pool in target["player_pools"])


def test_draft_scout_records_head_to_head_and_league_groups() -> None:
    report = build()

    [game] = report["head_to_head"]
    assert game["own_side"] == "BLUE"
    assert game["own_first_selection"] is True
    assert game["own_won"] is False
    assert len(game["own"]["bans"]) == len(game["target"]["bans"]) == 5
    assert [pick["sequence"] for pick in game["own"]["picks"]] == [1, 4, 5, 8, 9]
    assert [group["group"] for group in report["league_meta"]] == ["LCK", "INTERNATIONAL"]
    assert report["league_meta"][0]["game_count"] == 1
    assert report["league_meta"][0]["presence"][0]["presence_rate"] == 1.0
    assert report["league_meta"][1]["game_count"] == 0
    assert report["quality_flags"] == ["LOW_HEAD_TO_HEAD_SAMPLE", "CURRENT_EVENT_GAMES_MISSING"]


def test_draft_scout_levers_need_comfort_evidence() -> None:
    report = build(minimum_comfort_games=1)
    levers = report["levers"]

    assert len(levers["deny_comfort"]) == 5
    assert all(item["game_count"] == 1 for item in levers["deny_comfort"])
    assert levers["contested_priority"] == []
    assert levers["protect_own"] == []
    assert levers["counterpick_role"]["game_count"] == 1
    assert build()["levers"]["deny_comfort"] == []


def test_draft_scout_rejects_unknown_teams_and_future_games() -> None:
    with pytest.raises(ValueError, match="has no games"):
        build(target_team_name="Nobody")
    with pytest.raises(ValueError, match="has no games"):
        build(cutoff=RETRIEVED_AT - timedelta(days=365))
    with pytest.raises(ValueError, match="must differ"):
        build(target_team_name="blue team")
