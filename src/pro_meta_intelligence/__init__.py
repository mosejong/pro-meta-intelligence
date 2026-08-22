"""Evidence-first foundations for Pro Meta Intelligence."""

from pro_meta_intelligence.backtest.harness import BacktestHarness, BacktestReport
from pro_meta_intelligence.ingestion.fixtures import load_synthetic_scenario

__all__ = ["BacktestHarness", "BacktestReport", "load_synthetic_scenario"]
__version__ = "0.3.0"
