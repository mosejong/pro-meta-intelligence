import math
from datetime import UTC, datetime, timedelta, timezone

import pytest

import ops.pregame_player_history as ph
from ops.audit_performance_coverage import METRICS

T0 = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
DAY = timedelta(hours=24)
KST = timezone(timedelta(hours=9))


def full_metrics(value="1"):
    return {metric: value for metric in METRICS}


def obs(match, at, *, player="p1", role="mid", patch="16.10", metrics=None):
    return ph.HistoryObservation(
        match_id=match,
        player_id=player,
        role=role,
        patch_id=patch,
        observed_at=at,
        metrics=full_metrics() if metrics is None else metrics,
    )


def query(cutoff, *, target="target", player="p1", role="mid", patch="16.10"):
    return ph.HistoryQuery(
        target_match_id=target, player_id=player, role=role, patch_id=patch, cutoff=cutoff
    )


def run(observations, q, **config):
    return ph.extract_player_history(observations, q, ph.HistoryConfig(**config))


# ---------------------------------------------------------------- time / leakage


def test_target_match_always_excluded():
    items = [obs("target", T0 - 10 * DAY), obs("m1", T0 - 5 * DAY)]
    out = run(items, query(T0))
    assert out["used_match_ids"] == ["m1"]
    assert out["exclusions"]["target_match_observations"] == 1


def test_future_observation_excluded():
    items = [obs("m1", T0 - 3 * DAY), obs("m2", T0 + timedelta(hours=1))]
    out = run(items, query(T0))
    assert out["used_match_ids"] == ["m1"]
    assert out["exclusions"]["not_yet_available_at_cutoff"] == 1


def test_24h_boundary_inclusive():
    on_boundary = obs("edge", T0 - DAY)
    one_second_late = obs("late", T0 - DAY + timedelta(seconds=1))
    out = run([on_boundary, one_second_late], query(T0))
    assert out["used_match_ids"] == ["edge"]
    assert out["latest_simulated_available_at"] == "2026-06-01T12:00:00Z"


def test_same_time_other_game_respects_delay():
    items = [obs("target", T0), obs("parallel", T0)]
    at_kickoff = run(items, query(T0))
    assert at_kickoff["used_match_ids"] == []
    assert at_kickoff["exclusions"]["target_match_observations"] == 1
    assert at_kickoff["exclusions"]["not_yet_available_at_cutoff"] == 1
    assert at_kickoff["latest_simulated_available_at"] is None
    a_day_later = run(items, query(T0 + DAY))
    assert a_day_later["used_match_ids"] == ["parallel"]


def test_naive_datetimes_rejected():
    naive = datetime(2026, 6, 1, 12, 0)
    with pytest.raises(ValueError, match="timezone"):
        obs("m1", naive)
    with pytest.raises(ValueError, match="timezone"):
        query(naive)


def test_timezone_offsets_compare_by_instant():
    kst_equivalent = (T0 - DAY).astimezone(KST)  # same instant, +09:00 offset
    out = run([obs("kst", kst_equivalent)], query(T0.astimezone(KST)))
    assert out["used_match_ids"] == ["kst"]
    assert out["query"]["cutoff"] == "2026-06-01T12:00:00Z"
    later = obs("kst-late", kst_equivalent + timedelta(seconds=1))
    assert run([later], query(T0))["used_match_ids"] == []


# ---------------------------------------------------------------- identity scope


def test_player_role_patch_separation():
    items = [
        obs("same", T0 - 5 * DAY),
        obs("other-player", T0 - 5 * DAY, player="p2"),
        obs("other-role", T0 - 5 * DAY, role="top"),
        obs("other-patch", T0 - 5 * DAY, patch="16.11"),
        obs("prefix-patch", T0 - 5 * DAY, patch="16.1"),
    ]
    out = run(items, query(T0))
    assert out["used_match_ids"] == ["same"]
    assert out["exclusions"]["patch_mismatch"] == 2


def test_reversed_input_gives_identical_result():
    items = [obs(f"m{i:02d}", T0 - (30 - i) * DAY) for i in range(25)]
    items.append(obs("tie-b", T0 - 2 * DAY))
    items.append(obs("tie-a", T0 - 2 * DAY))
    forward = run(items, query(T0))
    backward = run(list(reversed(items)), query(T0))
    assert forward == backward


def test_latest_twenty_selected_with_match_id_tiebreak():
    items = [obs(f"m{i:02d}", T0 - (30 - i) * DAY) for i in range(25)]
    items += [obs("tie-b", T0 - DAY), obs("tie-a", T0 - DAY)]
    out = run(items, query(T0))
    assert out["games_used"] == 20
    assert out["used_match_ids"] == [f"m{i:02d}" for i in range(7, 25)] + ["tie-a", "tie-b"]
    assert out["exclusions"]["beyond_maximum_games"] == 7
    assert out["latest_simulated_available_at"] == "2026-06-01T12:00:00Z"


def test_duplicate_match_observations_all_excluded():
    items = [
        obs("dup", T0 - 5 * DAY),
        obs("dup", T0 - 5 * DAY),  # identical content
        obs("ok", T0 - 4 * DAY),
        obs("other-dup", T0 - 5 * DAY, player="p2"),
        obs("other-dup", T0 - 5 * DAY, player="p2"),
        obs("ok", T0 - 4 * DAY, role="top"),  # same match, other role: not a duplicate here
    ]
    out = run(items, query(T0))
    assert out["used_match_ids"] == ["ok"]
    assert out["exclusions"]["duplicate_match_ids"] == 1
    assert out["exclusions"]["duplicate_match_observations"] == 2
    other = run(items, query(T0, player="p2"))
    assert other["used_match_ids"] == []
    assert other["exclusions"]["duplicate_match_ids"] == 1


# ---------------------------------------------------------------- metric values


def test_blank_absent_invalid_and_zero_are_distinguished():
    def with_kills(value, *, drop=False):
        metrics = full_metrics()
        if drop:
            metrics.pop("kills")
        else:
            metrics["kills"] = value
        return metrics

    variants = ["0", "0", "0", "0", "0", None, "absent", "abc", "-1"]
    items = [
        obs(f"m{i}", T0 - (10 - i) * DAY, metrics=with_kills(v, drop=v == "absent"))
        for i, v in enumerate(variants)
    ]
    kills = run(items, query(T0))["metrics"]["kills"]
    assert kills["valid_count"] == 5
    assert kills["missing_count"] == 2
    assert kills["missing"] == {"blank": 1, "column_absent": 1}
    assert kills["invalid_count"] == 2
    assert kills["invalid"]["unparseable_string"] == 1
    assert kills["invalid"]["negative_not_allowed"] == 1
    assert kills["mean_raw"] == 0.0
    assert kills["mean_status"] == "computed"
    assert kills["unit"] == "RAW_NOT_NORMALIZED"


def test_signed_metric_mean_is_raw():
    values = ["-10", "0", "10", "20", "-5"]
    items = [
        obs(f"m{i}", T0 - (10 - i) * DAY, metrics={"golddiffat15": v}) for i, v in enumerate(values)
    ]
    entry = run(items, query(T0))["metrics"]["golddiffat15"]
    assert entry["mean_raw"] == pytest.approx(3.0)
    assert run(items, query(T0))["metrics"]["kills"]["missing"]["column_absent"] == 5


def test_minimum_sample():
    four = [obs(f"m{i}", T0 - (10 - i) * DAY) for i in range(4)]
    out = run(four, query(T0))
    assert out["sample"] == {"games_used": 4, "minimum_games": 5, "below_minimum_games": True}
    assert out["metrics"]["kills"]["mean_raw"] is None
    assert out["metrics"]["kills"]["mean_status"] == "insufficient_valid_values"
    five = four + [obs("m4", T0 - 6 * DAY)]
    out = run(five, query(T0))
    assert out["sample"]["below_minimum_games"] is False
    assert out["metrics"]["kills"]["mean_raw"] == 1.0


def test_valid_count_below_minimum_even_with_enough_games():
    items = [
        obs(f"m{i}", T0 - (10 - i) * DAY, metrics={"kills": "2" if i < 4 else ""}) for i in range(6)
    ]
    kills = run(items, query(T0))["metrics"]["kills"]
    assert kills["valid_count"] == 4
    assert kills["mean_raw"] is None


def test_very_large_finite_values():
    items = [obs(f"m{i}", T0 - (10 - i) * DAY, metrics={"totalgold": "1e308"}) for i in range(5)]
    entry = run(items, query(T0))["metrics"]["totalgold"]
    assert entry["mean_status"] == "computed"
    assert entry["mean_raw"] == pytest.approx(1e308)
    biggest = [
        obs(f"m{i}", T0 - (10 - i) * DAY, metrics={"totalgold": "1.7976931348623157e308"})
        for i in range(5)
    ]
    entry = run(biggest, query(T0))["metrics"]["totalgold"]
    if entry["mean_raw"] is None:
        assert entry["mean_status"] == "nonfinite_mean_not_reported"
    else:
        assert math.isfinite(entry["mean_raw"])
        assert entry["mean_status"] == "computed"


def test_overflowing_literal_is_invalid_not_infinite():
    items = [obs(f"m{i}", T0 - (10 - i) * DAY, metrics={"totalgold": "1e999"}) for i in range(5)]
    entry = run(items, query(T0))["metrics"]["totalgold"]
    assert entry["invalid"]["nonfinite"] == 5
    assert entry["mean_raw"] is None


# ---------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "kwargs",
    [
        {"publication_delay": timedelta(0)},
        {"publication_delay": -DAY},
        {"maximum_games": 0},
        {"minimum_games": -1},
        {"minimum_games": 21},
    ],
)
def test_invalid_config_values(kwargs):
    with pytest.raises(ValueError):
        ph.HistoryConfig(**kwargs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"publication_delay": 86400},
        {"maximum_games": True},
        {"minimum_games": 2.5},
    ],
)
def test_invalid_config_types(kwargs):
    with pytest.raises(TypeError):
        ph.HistoryConfig(**kwargs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"player": ""},
        {"player": " p1"},
        {"role": "adc"},
        {"role": "MID"},
        {"patch": ""},
        {"match": ""},
    ],
)
def test_invalid_observation_identity(kwargs):
    args = {"match": "m1", **kwargs}
    match = args.pop("match")
    with pytest.raises(ValueError):
        obs(match, T0, **args)


def test_invalid_query_identity():
    with pytest.raises(ValueError):
        query(T0, target="")
    with pytest.raises(ValueError):
        query(T0, role="support")


def test_outcome_and_non_string_metrics_rejected():
    with pytest.raises(ValueError, match="unknown metric"):
        obs("m1", T0, metrics={"result": "1"})
    with pytest.raises(TypeError):
        obs("m1", T0, metrics={"kills": 0})
    with pytest.raises(TypeError):
        ph.extract_player_history([{"match_id": "m1"}], query(T0))


# ---------------------------------------------------------------- immutability / output


def test_inputs_not_mutated():
    caller_metrics = {"kills": "3", "deaths": None}
    first = obs("m1", T0 - 3 * DAY, metrics=caller_metrics)
    items = [obs("m2", T0 - 2 * DAY), first, obs("target", T0 - 5 * DAY)]
    before = list(items)
    run(items, query(T0))
    assert items == before
    assert [o.match_id for o in items] == ["m2", "m1", "target"]
    assert caller_metrics == {"kills": "3", "deaths": None}
    caller_metrics["kills"] = "999"
    assert first.metrics["kills"] == "3"
    with pytest.raises(TypeError):
        first.metrics["kills"] = "5"


def test_output_marks_local_research_assumptions():
    out = ph.extract_player_history([obs("m1", T0 - 2 * DAY)], query(T0))
    assert out["local_research_only"] is True
    assert out["publication_permitted"] is False
    assert out["availability_basis"] == "observed_at_plus_fixed_publication_delay_assumption"
    assert out["target_roster_basis"] == "known_target_roster_assumption"
    assert out["config"] == {
        "publication_delay_seconds": 86400.0,
        "maximum_games": 20,
        "minimum_games": 5,
    }
    assert set(out["metrics"]) == set(METRICS)
    assert "result" not in out["metrics"]


def test_not_yet_available_duplicate_does_not_erase_eligible_history():
    past = obs("m1", T0 - 3 * DAY, metrics={"kills": "3"})
    future_revision = obs("m1", T0 + DAY, metrics={"kills": "999"})
    before = run([past], query(T0), minimum_games=1)
    after = run([past, future_revision], query(T0), minimum_games=1)
    assert after["used_match_ids"] == before["used_match_ids"] == ["m1"]
    assert after["metrics"] == before["metrics"]
    assert after["exclusions"]["not_yet_available_at_cutoff"] == 1
