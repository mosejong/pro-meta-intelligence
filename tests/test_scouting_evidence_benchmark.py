"""Counterexamples for the fixed offline scouting experiment, not efficacy tests."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from ops import scouting_evidence_benchmark as exp
from pro_meta_intelligence.models import DraftAction
from tests.test_draft_outcome_baseline import _game

T0 = datetime(2026, 7, 29, 12, tzinfo=UTC)


def game(key, when, **kwargs):
    match, events = _game(key, when, **kwargs)
    return match, tuple(
        replace(
            event,
            role=exp.ROLES[i % 5],
            player_id=f"{event.team_id}-{exp.ROLES[i % 5]}",
            player_name="same-display-name",
        )
        for i, event in enumerate(events)
    )


def prepared(*pairs):
    return exp.prepare(
        tuple(pair[0] for pair in pairs), tuple(e for pair in pairs for e in pair[1])
    )


def report(*pairs):
    games, exclusions = prepared(*pairs)
    assert not exclusions
    return exp.evaluate(games)


def test_history_is_strictly_before_delay_boundary_and_future_is_excluded():
    target = game("eval", exp.START + timedelta(hours=12))
    equal = game("equal", target[0].observed_at - exp.DELAY)
    before = game("prior", T0)
    future = game("future", target[0].observed_at + timedelta(days=3))
    value = report(before, equal, target, future)
    rows = [r for r in value["primary_rows"] if r["match_id"] == "eval"]
    assert len(rows) == 10
    assert all(r["history_games"] == 1 for r in rows)
    assert all(r["latest_history_at"] == T0.isoformat() for r in rows)
    assert all(sum(r["player_counts"].values()) == 1 for r in rows)


def test_same_series_freezes_history_and_locks_only_in_sensitivity():
    prior = game("prior", T0)
    first = game("one", exp.START)
    second = game("two", exp.START + timedelta(hours=2))
    value = report(prior, first, second)
    rows = value["primary_rows"]
    assert len(rows) == 20
    assert len({r["series_id"] for r in rows}) == 1
    assert all(r["history_games"] == 1 and not r["locked"] for r in rows)
    later = [r for r in value["fearless_sensitivity"]["rows"] if r["match_id"] == "two"]
    assert all(len(r["locked"]) == 10 for r in later)
    assert all(not r["predictions"]["player"] for r in later)
    assert value["overall"]["metrics"]["player"]["common_hit"] == 20
    sensitivity = value["fearless_sensitivity"]["summary"]
    assert sensitivity["common_rows"] == 20
    assert sensitivity["common_prediction_rows"] == 10
    assert sensitivity["metrics"]["player"]["common_empty_predictions"] == 10
    assert sensitivity["metrics"]["player"]["prediction_available_of"] == 10


def test_future_actual_lineup_does_not_select_predicted_player():
    prior = game("prior", T0)
    target = game("eval", exp.START)
    target = (
        target[0],
        tuple(replace(e, player_id="new-top") if i == 0 else e for i, e in enumerate(target[1])),
    )
    value = report(prior, target)
    row = next(r for r in value["primary_rows"] if r["team_id"] == "A" and r["role"] == "TOP")
    assert row["predicted_player_id"] == "A-TOP"
    assert row["actual_player_id"] == "new-top"
    assert row["roster_changed"]
    assert value["overall"]["roster_changed_rows"] == 1
    # Both teams use the same display name; player IDs keep their picks distinct.
    assert row["player_counts"] == {"Ahri": 1}


def test_unsupported_history_is_not_zero_or_common_support():
    value = report(game("cold", exp.START))
    assert value["overall"]["rows"] == 10
    assert value["overall"]["common_rows"] == 0
    assert value["overall"]["metrics"]["blend"]["common_rate"] is None
    assert value["overall"]["paired_series_interval_95"]["lower"] is None
    assert value["roster_unchanged"]["rows"] == 0
    assert value["roster_unknown"]["rows"] == 10


def test_top_k_equal_limit_and_refills_after_locks():
    counts = {f"C{i}": 20 - i for i in range(12)}
    for weight in (0, 0.75, 1):
        choices = exp.rank(counts, counts, weight, {"C0", "C1"})
        assert len(choices) == 6
        assert choices == [f"C{i}" for i in range(2, 8)]
    assert exp.rank({"A": 1}, {"B": 1}, 0) == ["B"]
    assert exp.rank({"A": 1}, {"B": 1}, 1) == ["A"]


def test_different_opponents_and_leagues_cannot_be_one_series():
    first = game("one", exp.START)
    other = game("other", exp.START + timedelta(hours=1), red="C")
    again = game("again", exp.START + timedelta(hours=2))
    groups = exp.group_series(prepared(first, other, again)[0])
    assert len(groups) == 3
    different = game("diff", exp.START + timedelta(hours=1), league="LPL")
    assert len(exp.group_series(prepared(first, different)[0])) == 2


@pytest.mark.parametrize("bad", ["missing", "roles", "duplicate", "event_time"])
def test_invalid_identity_or_role_is_excluded(bad):
    match, events = game("bad", T0)
    if bad == "missing":
        events = (replace(events[0], player_id=None), *events[1:])
    elif bad == "roles":
        events = (replace(events[0], role="MID"), *events[1:])
    elif bad == "duplicate":
        events = (replace(events[0], player_id=events[1].player_id), *events[1:])
    else:
        events = (replace(events[0], observed_at=T0 + timedelta(seconds=1)), *events[1:])
    games, exclusions = prepared((match, events))
    assert not games
    assert sum(exclusions.values()) == 1


def test_other_season_is_excluded_and_other_league_can_supply_player_history():
    wrong = game("wrong", T0, season="2027")
    assert prepared(wrong)[1] == {"OUTSIDE_SEASON": 1}
    prior = game("prior", T0, league="ERL")
    target = game("eval", exp.START)
    value = report(prior, target)
    assert all(r["player_counts"] for r in value["primary_rows"])
    assert all(not r["meta_counts"] for r in value["primary_rows"])
    assert value["overall"]["common_rows"] == 0


def test_aggregate_and_cluster_interval_reproduce_from_rows():
    value = report(
        game("prior", T0), game("eval", exp.START), game("later", exp.START + timedelta(days=3))
    )
    rows = value["primary_rows"]
    assert len(rows) == 20
    for method in ("player", "meta", "blend"):
        hit = sum(r["actual_champion"] in r["predictions"][method] for r in rows)
        assert value["overall"]["metrics"][method]["common_hit"] == hit
    interval = exp.cluster_interval(rows)
    assert interval == exp.cluster_interval(rows)
    assert interval == {"clusters": 2, "lower": 0.0, "upper": 0.0}


def test_duplicate_match_is_not_added_twice():
    one = game("one", T0)
    # Duplicate record, not duplicate event payload.
    games, counts = exp.prepare((one[0], one[0]), one[1])
    assert len(games) == 1
    assert counts == {"DUPLICATE_MATCH_ID": 1}


def with_bans(pair):
    match, events = pair
    bans = tuple(
        replace(
            events[0 if i % 2 == 0 else 5],
            event_id=f"{match.match_id}-ban-{i}",
            action=DraftAction.BAN,
            sequence=i + 1,
            champion_id=f"Ban{i}",
        )
        for i in range(6)
    )
    return match, events + bans


def test_ban_comparison_frozen_before_series_and_missing_drafts_not_scored():
    value = report(
        with_bans(game("prior", T0)),
        with_bans(game("eval", exp.START)),
        with_bans(game("two", exp.START + timedelta(hours=2))),
        game("missing", exp.START + timedelta(days=3)),
    )["phase_one_bans"]
    assert value["summary"]["rows"] == 12
    assert value["summary"]["common_rows"] == 12
    assert value["summary"]["metrics"]["team_habit"]["common_hit"] == 12
    assert value["missing_phase_one_bans_games"] == ["missing"]
    assert all(sum(r["team_counts"].values()) == 3 for r in value["rows"])
    assert all(len(r["predictions"]["meta"]) == 6 for r in value["rows"])


def test_bad_phase_one_bans_are_not_silently_scored():
    match, events = with_bans(game("bad", exp.START))
    # One duplicated ban champion: keep pick benchmark, withdraw ban evaluation.
    events = (*events[:-1], replace(events[-1], champion_id=events[-2].champion_id))
    value = report((match, events))
    assert value["evaluation_games"] == 1
    assert value["phase_one_bans"]["summary"]["rows"] == 0
    assert value["phase_one_bans"]["missing_phase_one_bans_games"] == ["bad"]
