import pytest

from pro_meta_intelligence.ingestion import load_synthetic_scenario
from pro_meta_intelligence.leakage import FutureDataError, filter_available, reject_future


def test_cutoff_allows_equal_timestamp_and_filters_future_data() -> None:
    scenario = load_synthetic_scenario()
    usage = scenario.solo_queue_adapter.usage()

    visible = filter_available(usage, scenario.window.cutoff)

    assert "usage-current-zyra" in {record.usage_id for record in visible}
    assert "usage-future-karthus" not in {record.usage_id for record in visible}


def test_strict_guard_rejects_future_available_record() -> None:
    scenario = load_synthetic_scenario()

    with pytest.raises(FutureDataError, match="exceeds cutoff"):
        reject_future(scenario.solo_queue_adapter.usage(), scenario.window.cutoff)


def test_future_match_results_never_enter_feature_snapshot() -> None:
    scenario = load_synthetic_scenario()
    visible_matches = filter_available(scenario.pro_adapter.matches(), scenario.window.cutoff)
    visible_events = filter_available(scenario.pro_adapter.draft_events(), scenario.window.cutoff)

    assert {match.match_id for match in visible_matches} == {
        "prior-1",
        "prior-2",
        "recent-1",
        "recent-2",
    }
    assert all(not event.match_id.startswith("future-") for event in visible_events)
