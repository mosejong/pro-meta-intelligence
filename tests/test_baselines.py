import pytest

from pro_meta_intelligence.baselines import (
    HighEloUsageChange,
    PatchBuffHeuristic,
    RecentProPresenceChange,
)
from pro_meta_intelligence.baselines.base import HistoricalSnapshot
from pro_meta_intelligence.ingestion import load_synthetic_scenario
from pro_meta_intelligence.leakage import filter_available


def build_snapshot() -> HistoricalSnapshot:
    scenario = load_synthetic_scenario()
    cutoff = scenario.window.cutoff
    return HistoricalSnapshot(
        cutoff=cutoff,
        patches=filter_available(scenario.patch_adapter.snapshots(), cutoff),
        matches=filter_available(scenario.pro_adapter.matches(), cutoff),
        draft_events=filter_available(scenario.pro_adapter.draft_events(), cutoff),
        solo_queue_usage=filter_available(scenario.solo_queue_adapter.usage(), cutoff),
    )


def test_recent_pro_presence_formula_is_explainable_and_deterministic() -> None:
    ranking = RecentProPresenceChange().rank(build_snapshot())

    assert [(signal.champion_id, signal.score) for signal in ranking] == [
        ("Shyvana", pytest.approx(0.5)),
        ("Zyra", pytest.approx(0.5)),
    ]
    assert ranking[0].formula == "recent_presence_per_match - prior_presence_per_match"


def test_high_elo_usage_change_uses_rate_delta() -> None:
    ranking = HighEloUsageChange().rank(build_snapshot())

    assert [signal.champion_id for signal in ranking] == ["Shyvana", "Zyra"]
    assert ranking[0].score == pytest.approx(0.05)
    assert ranking[1].score == pytest.approx(0.03)
    assert "Karthus" not in {signal.champion_id for signal in ranking}


def test_patch_buff_heuristic_has_no_opaque_score() -> None:
    ranking = PatchBuffHeuristic().rank(build_snapshot())

    assert [signal.champion_id for signal in ranking] == ["Shyvana", "Zyra"]
    assert all(signal.score == 1.0 for signal in ranking)
    assert all(signal.components[0].name == "direct_buff" for signal in ranking)
