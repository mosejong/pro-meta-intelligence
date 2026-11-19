import copy
from datetime import UTC, datetime, timedelta

import pytest

import ops.pregame_metric_context as mc
import ops.pregame_player_history as ph

T0 = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
DAY = timedelta(hours=24)
TARGET = "player-target"


def co(match, at, player, value, *, league="LCK", role="mid", patch="16.10"):
    metrics = {} if value == "absent" else {"golddiffat15": value}
    return mc.ContextObservation(
        league=league,
        observation=ph.HistoryObservation(
            match_id=match,
            player_id=player,
            role=role,
            patch_id=patch,
            observed_at=at,
            metrics=metrics,
        ),
    )


def series(player, values, *, start_days=40, tag="", **kwargs):
    """One row per value, oldest first, all available well before T0."""
    return [
        co(f"{player}{tag}-g{i:02d}", T0 - (start_days - i) * DAY, player, v, **kwargs)
        for i, v in enumerate(values)
    ]


def q(player=TARGET, *, cutoff=T0, target="target-match", role="mid", patch="16.10"):
    return ph.HistoryQuery(
        target_match_id=target, player_id=player, role=role, patch_id=patch, cutoff=cutoff
    )


def build(items, query=None, **kwargs):
    kwargs.setdefault("league", "LCK")
    return mc.build_metric_context(items, q() if query is None else query, **kwargs)


def base_scenario():
    # Target mean = 30. Peer means by hand: 10, 20, 30, 40, 10 (signed values).
    items = series(TARGET, ["10", "20", "30", "40", "50"])
    items += series("peer-a", ["10"] * 5)
    items += series("peer-b", ["20"] * 5)
    items += series("peer-c", ["30"] * 5)
    items += series("peer-d", ["40"] * 5)
    items += series("peer-e", ["-10", "0", "10", "20", "30"])
    return items


# ---------------------------------------------------------------- hand-computed position


def test_hand_computed_less_tie_greater():
    out = build(base_scenario())
    assert out["status"] == "descriptive_context_available"
    assert out["target"]["mean_raw"] == 30.0
    assert out["target"]["valid_count"] == 5
    assert out["target"]["games_used"] == 5
    # less: 10, 20, 10 -> 3; equal: 30 -> 1; greater: 40 -> 1
    assert out["position"]["less_count"] == 3
    assert out["position"]["equal_count"] == 1
    assert out["position"]["greater_count"] == 1
    assert out["position"]["position_fraction"] == pytest.approx((3 + 0.5) / 5)
    assert out["position"]["reference_degenerate"] is False
    assert out["peers"] == {"candidate_count": 5, "eligible_count": 5, "insufficient_count": 0}


def test_each_peer_one_vote_and_window_kept():
    items = series(TARGET, ["0"] * 5)
    # 30 games: oldest 10 are -999, latest 20 are 50 -> windowed mean 50 (> target).
    # If all 30 were used the mean would be negative (< target).
    items += series("peer-many", ["-999"] * 10 + ["50"] * 20, start_days=60)
    items += series("peer-b", ["50"] * 5)
    items += series("peer-c", ["-50"] * 5)
    items += series("peer-d", ["-50"] * 5)
    items += series("peer-e", ["-50"] * 5)
    out = build(items)
    assert out["position"]["less_count"] == 3
    assert out["position"]["greater_count"] == 2
    assert out["position"]["position_fraction"] == pytest.approx(0.6)


def test_target_with_four_valid_is_rejected():
    items = series(TARGET, ["10"] * 4) + base_scenario()[5:]
    out = build(items)
    assert out["status"] == "target_insufficient"
    assert out["target"]["mean_raw"] is None
    assert out["target"]["valid_count"] == 4
    assert all(v is None for v in out["position"].values())


def test_four_eligible_peers_is_rejected():
    items = base_scenario()
    items = [i for i in items if i.observation.player_id != "peer-e"]
    items += series("peer-e", ["5"] * 4)  # 4 valid: insufficient
    out = build(items)
    assert out["status"] == "peers_insufficient"
    assert out["peers"] == {"candidate_count": 5, "eligible_count": 4, "insufficient_count": 1}
    assert all(v is None for v in out["position"].values())
    assert out["target"]["mean_raw"] == 30.0


def test_literal_zero_valid_and_signed_negative():
    items = series(TARGET, ["0"] * 5)
    items += series("peer-a", ["0"] * 5)
    items += series("peer-b", ["-1"] * 5)
    items += series("peer-c", ["-0.5", "-0.5", "-0.5", "-0.5", "-0.5"])
    items += series("peer-d", ["1"] * 5)
    items += series("peer-e", ["0", "0", "0", "-0", "0"])
    out = build(items)
    assert out["target"]["mean_raw"] == 0.0
    assert out["position"]["less_count"] == 2
    assert out["position"]["equal_count"] == 2  # -0.0 == 0.0 exactly
    assert out["position"]["greater_count"] == 1
    assert out["position"]["position_fraction"] == pytest.approx(0.6)


def test_missing_is_not_zero_filled():
    items = series(TARGET, ["0", "0", "0", "0", None, "", "absent"])
    items += base_scenario()[5:]
    out = build(items)
    assert out["target"]["valid_count"] == 4
    assert out["target"]["games_used"] == 7
    assert out["status"] == "target_insufficient"


# ---------------------------------------------------------------- scope / leakage


def test_noise_leaves_entire_result_unchanged():
    base = base_scenario()
    noise = [
        # other league / role / patch for existing players and brand-new players
        *series(TARGET, ["9999"] * 5, league="LPL"),
        *series("peer-a", ["9999"] * 5, league="LPL"),
        *series("other-league", ["1"] * 5, league="LPL"),
        *series("peer-b", ["9999"] * 5, role="top"),
        *series("other-role", ["1"] * 5, role="top"),
        # distinct match IDs: same-ID rows on another patch would be duplicates by design
        *series("peer-c", ["9999"] * 5, patch="16.11", tag="-np"),
        *series("other-patch", ["1"] * 5, patch="16.1"),
        # future-only player and future rows for an existing peer
        *[co(f"fut-{i}", T0 + i * DAY, "future-only", "1") for i in range(5)],
        co("peer-d-future", T0 - DAY + timedelta(seconds=1), "peer-d", "9999"),
        # target-match rows: a player present only there, existing peer and the target
        co("target-match", T0 - 30 * DAY, "only-in-target", "1"),
        co("target-match", T0 - 30 * DAY, "peer-a", "-9999"),
        co("target-match", T0 - 30 * DAY, TARGET, "9999"),
    ]
    assert build(base + noise) == build(base)
    assert build(base + noise)["peers"]["candidate_count"] == 5


def test_target_player_excluded_from_reference():
    out = build(base_scenario())
    assert out["peers"]["candidate_count"] == 5
    # Querying a peer instead: the original target now appears as a peer candidate.
    peer_view = build(base_scenario(), q("peer-a"))
    assert peer_view["peers"]["candidate_count"] == 5
    assert peer_view["target"]["mean_raw"] == 10.0
    # peers: target 30, b 20, c 30, d 40, e 10 -> all >= 10; e ties
    assert peer_view["position"]["less_count"] == 0
    assert peer_view["position"]["equal_count"] == 1


def test_exact_24h_boundary():
    target = series(TARGET, ["0"] * 5)
    edge_peer = series("peer-x", ["1"] * 4) + [co("edge", T0 - DAY, "peer-x", "1")]
    late_peer = series("peer-x", ["1"] * 4) + [
        co("edge", T0 - DAY + timedelta(seconds=1), "peer-x", "1")
    ]
    on_edge = build(target + edge_peer, minimum_peer_players=1)
    assert on_edge["peers"] == {"candidate_count": 1, "eligible_count": 1, "insufficient_count": 0}
    late = build(target + late_peer, minimum_peer_players=1)
    assert late["peers"] == {"candidate_count": 1, "eligible_count": 0, "insufficient_count": 1}
    only_late = build(
        target + [co("edge", T0 - DAY + timedelta(seconds=1), "late-only", "1")],
        minimum_peer_players=1,
    )
    assert only_late["peers"]["candidate_count"] == 0


def test_future_duplicate_does_not_erase_past():
    base = base_scenario()
    revision = co("peer-a-g00", T0 + DAY, "peer-a", "9999")
    target_revision = co(f"{TARGET}-g00", T0 + DAY, TARGET, "-9999")
    assert build(base + [revision, target_revision]) == build(base)


def test_available_duplicates_all_dropped():
    items = base_scenario()
    items.append(co("peer-a-g00", T0 - 39 * DAY, "peer-a", "10"))  # duplicate of an existing row
    out = build(items)
    assert out["peers"] == {"candidate_count": 5, "eligible_count": 4, "insufficient_count": 1}
    assert out["status"] == "peers_insufficient"


# ---------------------------------------------------------------- invariance / immutability


def test_order_invariance_and_inputs_unchanged():
    items = base_scenario()
    snapshot = list(items)
    forward = build(items)
    assert items == snapshot
    assert build(list(reversed(items))) == forward
    assert build(iter(items)) == forward


def test_returned_dict_mutation_does_not_affect_later_calls():
    items = base_scenario()
    first = build(items)
    expected = copy.deepcopy(first)
    first["claims"].append("X")
    first["position"]["less_count"] = 99
    first["peers"]["eligible_count"] = -1
    assert build(items) == expected


def test_context_observation_is_frozen():
    item = co("m1", T0 - 5 * DAY, "p", "1")
    with pytest.raises(AttributeError):
        item.league = "LPL"
    with pytest.raises(TypeError):
        item.observation.metrics["golddiffat15"] = "2"


def test_output_hides_peer_and_match_ids():
    out = build(base_scenario())
    text = repr(out)
    for secret in ("peer-a", "peer-e", TARGET, "target-match", "-g0"):
        assert secret not in text
    assert set(out["query_context"]) == {"league", "role", "patch_id", "cutoff"}
    assert out["local_research_only"] is True
    assert out["publication_permitted"] is False
    assert out["metric"] == "golddiffat15"
    assert out["history_delay_basis"] == ph.AVAILABILITY_BASIS
    assert out["known_roster_assumption"] == ph.TARGET_ROSTER_BASIS
    assert "SIMULATED_24H_NOT_ACTUAL_AVAILABILITY" in out["claims"]
    for claim in (
        "NO_MODEL_NO_LABELS_NO_OUTCOME",
        "EXACT_LEAGUE_ROLE_PATCH_ONLY",
        "EACH_PEER_EQUAL_WEIGHT",
        "TARGET_PLAYER_EXCLUDED_FROM_REFERENCE",
        "LOCAL_RESEARCH_ONLY_NOT_FOR_EXPORT",
        "NOT_STRENGTH_OR_WINRATE_OR_FEATURE_ADMISSION",
    ):
        assert claim in out["claims"]
    assert out["config"] == {
        "publication_delay_seconds": 86400.0,
        "maximum_games": 20,
        "minimum_games": 5,
        "minimum_peer_players": 5,
    }


def test_configured_delay_changes_claim():
    out = build(base_scenario(), config=ph.HistoryConfig(publication_delay=timedelta(hours=48)))
    assert "SIMULATED_24H_NOT_ACTUAL_AVAILABILITY" not in out["claims"]
    assert "SIMULATED_CONFIGURED_DELAY_NOT_ACTUAL_AVAILABILITY" in out["claims"]


# ---------------------------------------------------------------- degenerate references


def test_empty_reference():
    items = series(TARGET, ["0"] * 5)
    out = build(items, minimum_peer_players=1)
    assert out["status"] == "peers_insufficient"
    assert out["peers"] == {"candidate_count": 0, "eligible_count": 0, "insufficient_count": 0}
    assert out["position"]["position_fraction"] is None
    assert build([], minimum_peer_players=1)["status"] == "target_insufficient"


def test_all_peers_same_mean():
    peers = []
    for name in ("peer-a", "peer-b", "peer-c", "peer-d", "peer-e"):
        peers += series(name, ["7"] * 5)
    tie = build(series(TARGET, ["7"] * 5) + peers)
    assert tie["position"]["position_fraction"] == 0.5
    assert tie["position"]["equal_count"] == 5
    assert tie["position"]["reference_degenerate"] is True
    above = build(series(TARGET, ["8"] * 5) + peers)
    assert above["position"]["position_fraction"] == 1.0
    assert above["position"]["reference_degenerate"] is True


# ---------------------------------------------------------------- validation


@pytest.mark.parametrize("league", ["", " LCK", "LCK "])
def test_bad_league_value(league):
    with pytest.raises(ValueError):
        build(base_scenario(), league=league)
    with pytest.raises(ValueError):
        co("m1", T0, "p", "1", league=league)


@pytest.mark.parametrize("league", [None, 1, b"LCK"])
def test_bad_league_type(league):
    with pytest.raises(TypeError):
        build(base_scenario(), league=league)


@pytest.mark.parametrize("value", [True, False, 2.5, "5", None])
def test_minimum_peer_players_type(value):
    with pytest.raises(TypeError):
        build(base_scenario(), minimum_peer_players=value)


@pytest.mark.parametrize("value", [0, -1])
def test_minimum_peer_players_value(value):
    with pytest.raises(ValueError):
        build(base_scenario(), minimum_peer_players=value)


def test_invalid_input_types():
    raw = base_scenario()[0].observation
    with pytest.raises(TypeError):
        build([raw])
    with pytest.raises(TypeError):
        build("abc")
    with pytest.raises(TypeError):
        mc.build_metric_context(base_scenario(), "query", league="LCK")
    with pytest.raises(TypeError):
        build(base_scenario(), config={"minimum_games": 5})
    with pytest.raises(TypeError):
        mc.ContextObservation(league="LCK", observation={"match_id": "m1"})
