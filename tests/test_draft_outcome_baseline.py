"""Synthetic-fixture checks for the exploratory draft outcome baseline experiment."""

import dataclasses
import math
from datetime import UTC, datetime, timedelta

import pytest

import ops.draft_outcome_baseline as exp
from pro_meta_intelligence.models import (
    DraftAction,
    MatchRecord,
    PickBanEvent,
    Provenance,
    Side,
)

T0 = datetime(2026, 7, 1, 12, tzinfo=UTC)
RETRIEVED = datetime(2026, 11, 11, tzinfo=UTC)
PROV = Provenance(
    source_id="synthetic",
    source_type="TEST",
    source_uri="local-file:synthetic.csv",
    source_version="v1",
    retrieved_at=RETRIEVED,
    content_hash="sha256:test",
)
BLUE_DEFAULT = ("Ahri", "Lee Sin", "Jinx", "Thresh", "Garen")
RED_DEFAULT = ("Syndra", "Vi", "Ezreal", "Nautilus", "Darius")


def _game(
    match_id,
    when,
    *,
    blue="A",
    red="B",
    winner=None,
    blue_picks=BLUE_DEFAULT,
    red_picks=RED_DEFAULT,
    league="LCK",
    season="2026",
):
    match = MatchRecord(
        match_id=match_id,
        series_id=f"{match_id}:s",
        league=league,
        tournament=f"{season} {league} Split",
        patch_id="16.14",
        blue_team_id=blue,
        red_team_id=red,
        winner_team_id=blue if winner is None else winner,
        observed_at=when,
        available_at=RETRIEVED,
        provenance=PROV,
    )
    events = []
    for side, team, picks in ((Side.BLUE, blue, blue_picks), (Side.RED, red, red_picks)):
        for index, champion in enumerate(picks, start=1):
            events.append(
                PickBanEvent(
                    event_id=f"{match_id}:{side.value}:{index}",
                    match_id=match_id,
                    sequence=index if side is Side.BLUE else index + 5,
                    team_id=team,
                    side=side,
                    action=DraftAction.PICK,
                    champion_id=champion,
                    role="UNKNOWN",
                    observed_at=when,
                    available_at=RETRIEVED,
                    provenance=PROV,
                )
            )
    return match, events


def _samples(games):
    matches = [match for match, _ in games]
    events = [event for _, items in games for event in items]
    samples, exclusions = exp.prepare_samples(matches, events)
    return samples, exclusions


def _by_id(result):
    return {prediction.sample.match_id: prediction for prediction in result.predictions}


def test_frozen_parameters_match_the_fixed_design():
    assert exp.FROZEN.to_dict() == {
        "season": "2026",
        "evaluation_start": "2026-08-01T00:00:00+00:00",
        "publication_delay_hours": 24.0,
        "elo_initial": 1500.0,
        "elo_k": 20.0,
        "elo_scale": 400.0,
        "elo_side_advantage": 0.0,
        "draft_learning_rate": 0.03,
        "draft_l2_factor": 0.9999,
        "logloss_epsilon": 1e-12,
        "bootstrap_replicates": 1000,
        "bootstrap_seed": 20261117,
        "minimum_bootstrap_days": 10,
        "minimum_segment_games": 30,
    }
    with pytest.raises(dataclasses.FrozenInstanceError):
        exp.FROZEN.elo_k = 32.0  # type: ignore[misc]
    assert set(exp.FOCUS_LEAGUES) == {"WLDs", "LCK", "LEC", "LPL"}


def test_validation_excludes_and_counts_bad_games():
    games = [
        _game("ok", T0),
        _game("same", T0, blue="A", red="A"),
        _game("winner", T0, winner="Z"),
        _game("four", T0, blue_picks=BLUE_DEFAULT[:4]),
        _game("dup", T0, red_picks=("Vi", "vi", "Ezreal", "Nautilus", "Darius")),
        _game("both", T0, red_picks=("Ahri", "Vi", "Ezreal", "Nautilus", "Darius")),
        _game("old", T0, season="2025"),
    ]
    # A pick attributed to the wrong team must also be rejected.
    match, events = _game("mismatch", T0)
    events[0] = dataclasses.replace(events[0], team_id="B")
    games.append((match, events))
    samples, exclusions = _samples(games)
    assert [sample.match_id for sample in samples] == ["ok"]
    assert exclusions == {
        "BLUE_PICK_COUNT_NOT_5": 1,
        "CHAMPION_ON_BOTH_TEAMS": 1,
        "DUPLICATE_CHAMPION_WITHIN_TEAM": 1,
        "OUTSIDE_SEASON": 1,
        "PICK_TEAM_MISMATCH": 1,
        "SAME_TEAM_BOTH_SIDES": 1,
        "WINNER_NOT_A_PARTICIPANT": 1,
    }
    sample = samples[0]
    assert sample.blue_win is True
    assert sample.source_available_at == RETRIEVED
    assert sample.simulated_label_available_at == T0 + timedelta(hours=24)


def test_same_timestamp_and_24h_boundary():
    games = [
        _game("g1", T0),
        _game("g1b", T0, blue="C", red="D"),  # same timestamp: cannot see g1
        _game("g2", T0 + timedelta(hours=24)),  # exactly +24h: still not visible
        _game("g3", T0 + timedelta(hours=24, seconds=1)),  # now g1 and g1b are visible
    ]
    samples, _ = _samples(games)
    predictions = _by_id(exp.run_walk_forward(samples))
    assert predictions["g1"].labels_known_at_prediction == 0
    assert predictions["g1b"].labels_known_at_prediction == 0
    assert predictions["g2"].labels_known_at_prediction == 0
    assert predictions["g2"].p_elo == 0.5
    assert predictions["g3"].labels_known_at_prediction == 2
    assert predictions["g3"].p_elo > 0.5


def test_same_day_outcomes_never_change_same_day_predictions():
    base = [
        _game("d0", T0 - timedelta(days=2)),
        _game("d0b", T0 - timedelta(days=2), blue="B", red="C", winner="C"),
        _game("x1", T0),
        _game("x2", T0 + timedelta(hours=3), blue="B", red="A"),
        _game("x3", T0 + timedelta(hours=6)),
    ]
    flipped = [
        (
            match
            if match.match_id.startswith("d")
            else dataclasses.replace(match, winner_team_id=match.red_team_id),
            events,
        )
        for match, events in base
    ]
    first = _by_id(exp.run_walk_forward(_samples(base)[0]))
    second = _by_id(exp.run_walk_forward(_samples(flipped)[0]))
    for match_id in ("x1", "x2", "x3"):
        assert first[match_id].p_elo == second[match_id].p_elo
        assert first[match_id].p_draft == second[match_id].p_draft
    # The earlier labels were used, so the check is not vacuous.
    assert first["x1"].labels_known_at_prediction == 2
    assert first["x1"].p_draft != 0.5


def test_elo_update_direction_and_magnitude():
    games = [
        _game(
            "g1",
            T0,
            blue_picks=("A1", "A2", "A3", "A4", "A5"),
            red_picks=("B1", "B2", "B3", "B4", "B5"),
        ),
        _game(
            "g2",
            T0 + timedelta(days=2),
            blue="B",
            red="A",
            blue_picks=("C1", "C2", "C3", "C4", "C5"),
            red_picks=("D1", "D2", "D3", "D4", "D5"),
        ),
    ]
    result = exp.run_walk_forward(_samples(games)[0])
    assert result.final_ratings["A"] > exp.ELO_INITIAL > result.final_ratings["B"]
    g2 = _by_id(result)["g2"]
    # A won g1 (+10); now A plays red so blue (B, 1490) is the underdog.
    expected = 1.0 / (1.0 + 10 ** ((1510 - 1490) / 400))
    assert math.isclose(g2.p_elo, expected, rel_tol=1e-12)
    # Champions in g2 have never been updated: draft model equals Elo exactly.
    assert g2.p_draft == g2.p_elo


def test_champion_weights_follow_gradient_and_zero_weights_match_elo():
    games = [_game("g1", T0), _game("g2", T0 + timedelta(days=2))]
    result = exp.run_walk_forward(_samples(games)[0])
    predictions = _by_id(result)
    assert predictions["g1"].p_draft == predictions["g1"].p_elo == 0.5
    lr = exp.DRAFT_LEARNING_RATE
    # g1 applied before g2 (p = 0.5, err = +0.5); g2's own label is still pending at the end.
    assert result.labels_applied == 1
    assert math.isclose(result.final_weights["ahri"], lr * 0.5)
    assert math.isclose(result.final_weights["syndra"], -lr * 0.5)
    margin = 5 * lr * 0.5 * 2
    assert math.isclose(
        predictions["g2"].p_draft, exp.sigmoid(predictions["g2"].elo_logit + margin)
    )
    assert predictions["g2"].p_draft > predictions["g2"].p_elo


def test_repeated_runs_are_deterministic_and_bootstrap_respects_day_minimum():
    games = []
    teams = ["A", "B", "C", "D"]
    for day in range(40):
        when = datetime(2026, 7, 20, 10, tzinfo=UTC) + timedelta(days=day)
        blue, red = teams[day % 4], teams[(day + 1) % 4]
        winner = blue if day % 3 else red
        games.append(_game(f"m{day}", when, blue=blue, red=red, winner=winner))
    samples, _ = _samples(games)
    first = exp.build_report(samples, exp.run_walk_forward(samples))
    second = exp.build_report(samples, exp.run_walk_forward(samples))
    assert first == second
    assert first["data_window"]["evaluated_games"] == 28
    assert first["data_window"]["warmup_games"] == 12
    overall = first["overall"]
    assert overall["coin_50"]["accuracy"] == 0.5
    assert math.isclose(overall["coin_50"]["logloss"], round(math.log(2), 6))
    assert overall["paired_daily"]["days"] == 28
    low, high = overall["paired_daily"]["bootstrap"]["logloss_difference_95"]
    assert low <= overall["paired_daily"]["mean_logloss_difference"] <= high
    # A tiny segment reports no interval rather than an unstable one.
    tiny = exp.paired_daily_bootstrap(exp.run_walk_forward(samples[:5]).predictions)
    assert tiny["bootstrap"] is None


def test_logloss_clamps_only_extremes():
    assert math.isclose(exp.logloss(1.0, False), -math.log(1e-12), rel_tol=1e-5)
    assert math.isfinite(exp.logloss(0.0, True))
    assert math.isclose(exp.logloss(0.7, True), -math.log(0.7))
    assert exp.brier(1.0, False) == 1.0
    assert exp.correct(0.5, True) == 0.5
