"""Independent checks of the new descriptive context's history-admission boundary."""

from datetime import UTC, datetime, timedelta

from ops.pregame_metric_context import ContextObservation, build_metric_context
from ops.pregame_player_history import HistoryObservation, HistoryQuery

CUTOFF = datetime(2026, 8, 20, tzinfo=UTC)


def observation(player, game, *, patch="16.15", future=False):
    return ContextObservation(
        "LCK",
        HistoryObservation(
            match_id=game,
            player_id=player,
            role="mid",
            patch_id=patch,
            observed_at=CUTOFF + timedelta(days=1) if future else CUTOFF - timedelta(days=3),
            metrics={"golddiffat15": "0"},
        ),
    )


def fixture():
    rows = [observation(f"p{p}", f"game-{p}-{g}") for p in range(6) for g in range(5)]
    query = HistoryQuery("target", "p0", "mid", "16.15", CUTOFF)
    return rows, query


def test_available_cross_patch_revision_cannot_rescue_an_ambiguous_target_game():
    rows, query = fixture()
    before = build_metric_context(rows, query, league="LCK")
    assert before["status"] == "descriptive_context_available"
    assert before["position"]["position_fraction"] == 0.5
    # Existing extraction discards BOTH available copies before filtering exact patch.
    # Pre-filtering the helper's input to the requested patch would incorrectly keep five games.
    conflict = observation("p0", "game-0-0", patch="16.14")
    after = build_metric_context([*rows, conflict], query, league="LCK")
    assert after["status"] == "target_insufficient"
    assert after["target"]["valid_count"] == 4
    assert after["position"]["position_fraction"] is None


def test_future_revision_and_future_only_peers_do_not_change_any_returned_field():
    rows, query = fixture()
    before = build_metric_context(rows, query, league="LCK")
    additions = [observation("p0", "game-0-0", patch="16.14", future=True)]
    additions += [observation("future-peer", f"future-{i}", future=True) for i in range(5)]
    assert build_metric_context([*rows, *additions], query, league="LCK") == before
