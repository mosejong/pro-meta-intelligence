from dataclasses import replace
from datetime import timedelta

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.opponent import DraftScoutBacktestConfig, backtest_draft_scout
from pro_meta_intelligence.radar.models import LeagueRegionMap
from pro_meta_intelligence.sources import SourceRegistry
from tests.test_opponent import FIXTURE, RETRIEVED_AT


def replayed(*, delay_hours: float = 24.0):
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        FIXTURE,
        retrieved_at=RETRIEVED_AT,
        source_timezone="+09:00",
        source_uri="https://drive.google.com/example",
    )
    # The fixture's league game, then the same draft replayed three days later at Worlds.
    shift = timedelta(days=3)
    later = tuple(
        replace(
            match,
            match_id=f"{match.match_id}-wlds",
            league="WLDs",
            observed_at=match.observed_at + shift,
            available_at=match.available_at + shift,
        )
        for match in imported.matches
    )
    later_events = tuple(
        replace(
            event,
            event_id=f"{event.event_id}-wlds",
            match_id=f"{event.match_id}-wlds",
            observed_at=event.observed_at + shift,
            available_at=event.available_at + shift,
        )
        for event in imported.draft_events
    )
    return backtest_draft_scout(
        imported.matches + later,
        imported.draft_events + later_events,
        LeagueRegionMap.load_default(),
        DraftScoutBacktestConfig(
            league="WLDs",
            target_teams={"RED": "Red Team"},
            own_team_name="Blue Team",
            publication_delay=timedelta(hours=delay_hours),
        ),
    ).to_dict()


def test_backtest_scores_event_drafts_with_only_previously_published_games() -> None:
    report = replayed()

    assert report["artifact_type"] == "draft-scout-backtest"
    assert report["game_count"] == 1
    red = report["teams"]["RED"]
    assert red["player_pool_picks"] == {"hit": 5, "of": 5, "rate": 1.0}
    assert red["season_ban_habit"] == {"hit": 3, "of": 3, "rate": 1.0}
    # The earlier game was a league game, so there is no international meta to lean on yet.
    assert red["expected_phase_one_bans"]["hit"] == 0
    assert red["deny_hits_real_pick"]["of"] == 1
    assert report["overall"]["player_pool_picks"]["rate"] == 1.0


def test_backtest_skips_series_whose_prior_games_were_not_yet_published() -> None:
    report = replayed(delay_hours=24 * 5)

    assert report["game_count"] == 0
    assert report["skipped_series"][0]["team"] == "RED"
    assert report["overall"]["player_pool_picks"]["rate"] is None
