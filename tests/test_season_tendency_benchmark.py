from dataclasses import replace
from datetime import timedelta

from ops.benchmark_season_tendencies import evaluate, metrics, select_external_teams
from tests.test_opponent import imported_fixture


def test_equal_budget_metrics_keep_misses_in_denominator():
    result = metrics([1, 3, 6, 0])
    assert result["picks"] == 4
    assert (result["top1"], result["top3"], result["top6"]) == (0.25, 0.5, 0.75)
    assert metrics([])["mrr"] is None


def test_external_cohort_uses_only_first_half_and_excludes_original_teams():
    match = imported_fixture().matches[0]
    first_half = replace(
        match,
        blue_team_name="New Team",
        red_team_name="T1",
        league="LCK",
        observed_at=match.observed_at.replace(month=6),
    )
    later = replace(match, blue_team_name="Late Team", red_team_name="Another Late", league="LCK")
    assert select_external_teams((first_half, later), minimum_games=1) == frozenset({"New Team"})
    assert select_external_teams((first_half,), minimum_games=2) == frozenset()


def test_same_day_and_future_records_cannot_change_earlier_predictions():
    imported = imported_fixture()
    old = replace(imported.matches[0], blue_team_name="T1", red_team_name="Karmine Corp")
    later = replace(
        old,
        match_id="later",
        observed_at=old.observed_at + timedelta(days=3),
        available_at=old.available_at + timedelta(days=3),
    )
    later_events = tuple(
        replace(
            e,
            match_id="later",
            event_id=e.event_id + ":later",
            observed_at=e.observed_at + timedelta(days=3),
            available_at=e.available_at + timedelta(days=3),
        )
        for e in imported.draft_events
    )
    report = evaluate((old, later), imported.draft_events + later_events)
    assert report["audit"]
    changed = tuple(replace(e, champion_id="UNSEEN_OUTCOME") for e in later_events)
    second = evaluate((old, later), imported.draft_events + changed)
    assert all(row["ranks"]["season"] == 0 for row in second["audit"])
    assert all(row["ranks"]["season"] > 0 for row in report["audit"])
    future = replace(
        later,
        match_id="future",
        observed_at=later.observed_at + timedelta(days=3),
        available_at=later.available_at + timedelta(days=3),
    )
    third = evaluate((old, later, future), imported.draft_events + later_events)
    assert third["audit"] == report["audit"]
