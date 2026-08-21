import json
from dataclasses import replace

import pytest

from pro_meta_intelligence.backtest import BacktestHarness
from pro_meta_intelligence.ingestion import load_synthetic_scenario


def test_synthetic_backtest_emits_expected_metrics_for_each_baseline() -> None:
    scenario = load_synthetic_scenario()
    payload = BacktestHarness().run(scenario).to_dict()

    assert payload["fixture_only"] is True
    assert payload["actual_adoptions"] == [
        {
            "champion_id": "Zyra",
            "role": "JUNGLE",
            "first_adopted_at": "2026-08-16T12:00:00+00:00",
        }
    ]
    assert {result["baseline"] for result in payload["baselines"]} == {
        "recent_pro_presence_change",
        "high_elo_usage_change",
        "patch_buff_heuristic",
    }
    for result in payload["baselines"]:
        assert result["metrics"] == {
            "recall_at_k": 1.0,
            "precision_at_k": 0.5,
            "false_alert_rate": 0.5,
            "false_alert_count": 1,
            "median_lead_time_hours": 36.0,
        }


def test_fixture_backtest_is_byte_for_byte_deterministic_json() -> None:
    scenario = load_synthetic_scenario()
    harness = BacktestHarness()

    first = harness.run(scenario).to_json()
    second = harness.run(scenario).to_json()

    assert first == second
    assert json.loads(first)["snapshot_id"] == "fixture-2026-08-15T00:00:00Z-v1"


def test_false_positive_is_preserved_in_ranking() -> None:
    payload = BacktestHarness().run(load_synthetic_scenario()).to_dict()

    for result in payload["baselines"]:
        selected = result["ranking"][:2]
        assert "Shyvana" in {candidate["champion_id"] for candidate in selected}
        assert result["metrics"]["false_alert_count"] == 1


def test_top_one_exposes_ranking_tradeoff() -> None:
    scenario = load_synthetic_scenario()
    window = scenario.window
    payload = BacktestHarness().run(scenario, replace(window, top_k=1)).to_dict()

    for result in payload["baselines"]:
        assert result["metrics"]["recall_at_k"] == pytest.approx(0.0)
        assert result["metrics"]["false_alert_rate"] == pytest.approx(1.0)
