from dataclasses import replace
from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.ingestion import load_synthetic_scenario
from pro_meta_intelligence.models import BacktestWindow


def test_required_domain_models_are_populated_by_fixture() -> None:
    scenario = load_synthetic_scenario()

    assert scenario.patch_adapter.snapshots()[0].patch_id == "26.16"
    assert scenario.pro_adapter.matches()[0].match_id == "prior-1"
    assert scenario.pro_adapter.draft_events()[0].event_id.startswith("draft-")
    assert scenario.solo_queue_adapter.usage()[0].usage_rate == pytest.approx(0.01)
    assert scenario.evidence[0].evidence_id == "evidence-fixture-scope"


def test_time_sensitive_model_rejects_naive_timestamp() -> None:
    usage = load_synthetic_scenario().solo_queue_adapter.usage()[0]

    with pytest.raises(ValueError, match="timezone-aware"):
        replace(usage, available_at=datetime(2026, 8, 8))


def test_backtest_window_requires_future_evaluation_period() -> None:
    cutoff = datetime(2026, 8, 15, tzinfo=UTC)

    with pytest.raises(ValueError, match="evaluation_end"):
        BacktestWindow(
            cutoff=cutoff,
            evaluation_start=cutoff,
            evaluation_end=cutoff,
            top_k=2,
        )
