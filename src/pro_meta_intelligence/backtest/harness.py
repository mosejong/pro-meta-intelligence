"""Leakage-safe historical baseline evaluation."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from pro_meta_intelligence.backtest.metrics import calculate_metrics
from pro_meta_intelligence.baselines import (
    HighEloUsageChange,
    PatchBuffHeuristic,
    RecentProPresenceChange,
)
from pro_meta_intelligence.baselines.base import Baseline, HistoricalSnapshot
from pro_meta_intelligence.ingestion.interfaces import (
    PatchDataSource,
    ProMatchDataSource,
    SoloQueueDataSource,
)
from pro_meta_intelligence.leakage import filter_available, reject_future
from pro_meta_intelligence.models import BacktestWindow, DraftAction, PickBanEvent


class EvaluationScenario(Protocol):
    scenario_id: str
    snapshot_id: str
    adoption_threshold: int
    fixture_only: bool
    window: BacktestWindow
    patch_adapter: PatchDataSource
    pro_adapter: ProMatchDataSource
    solo_queue_adapter: SoloQueueDataSource


@dataclass(frozen=True, slots=True)
class BacktestReport:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


class BacktestHarness:
    def __init__(self, baselines: tuple[Baseline, ...] | None = None) -> None:
        self.baselines = baselines or (
            RecentProPresenceChange(),
            HighEloUsageChange(),
            PatchBuffHeuristic(),
        )

    def run(
        self, scenario: EvaluationScenario, window: BacktestWindow | None = None
    ) -> BacktestReport:
        active_window = window or scenario.window
        snapshot = HistoricalSnapshot(
            cutoff=active_window.cutoff,
            patches=filter_available(scenario.patch_adapter.snapshots(), active_window.cutoff),
            matches=filter_available(scenario.pro_adapter.matches(), active_window.cutoff),
            draft_events=filter_available(
                scenario.pro_adapter.draft_events(), active_window.cutoff
            ),
            solo_queue_usage=filter_available(
                scenario.solo_queue_adapter.usage(), active_window.cutoff
            ),
        )
        reject_future(snapshot.patches, active_window.cutoff)
        reject_future(snapshot.matches, active_window.cutoff)
        reject_future(snapshot.draft_events, active_window.cutoff)
        reject_future(snapshot.solo_queue_usage, active_window.cutoff)

        adoption_times = self._future_adoptions(
            scenario.pro_adapter.draft_events(),
            active_window,
            scenario.adoption_threshold,
        )
        baseline_results: list[dict[str, Any]] = []
        for baseline in self.baselines:
            ranking = baseline.rank(snapshot)
            reject_future(ranking, active_window.cutoff)
            metrics = calculate_metrics(
                ranking,
                active_window.top_k,
                adoption_times,
                active_window.cutoff,
            )
            baseline_results.append(
                {
                    "baseline": baseline.name,
                    "ranking": [
                        signal.to_dict(rank=index) for index, signal in enumerate(ranking, start=1)
                    ],
                    "metrics": metrics.to_dict(),
                }
            )

        actual_adoptions = [
            {
                "champion_id": champion_id,
                "role": role,
                "first_adopted_at": adoption_times[(champion_id, role)].isoformat(),
            }
            for champion_id, role in sorted(adoption_times)
        ]
        return BacktestReport(
            {
                "schema_version": "1",
                "scenario_id": scenario.scenario_id,
                "snapshot_id": scenario.snapshot_id,
                "fixture_only": scenario.fixture_only,
                "window": {
                    "cutoff": active_window.cutoff.isoformat(),
                    "evaluation_start": active_window.evaluation_start.isoformat(),
                    "evaluation_end": active_window.evaluation_end.isoformat(),
                    "top_k": active_window.top_k,
                },
                "outcome_policy": {
                    "event": DraftAction.PICK.value,
                    "minimum_future_picks": scenario.adoption_threshold,
                },
                "actual_adoptions": actual_adoptions,
                "baselines": baseline_results,
            }
        )

    @staticmethod
    def _future_adoptions(
        events: tuple[PickBanEvent, ...],
        window: BacktestWindow,
        threshold: int,
    ) -> dict[tuple[str, str], datetime]:
        observable_outcomes = filter_available(events, window.evaluation_end)
        future_picks = [
            event
            for event in observable_outcomes
            if event.action is DraftAction.PICK
            and window.evaluation_start <= event.observed_at <= window.evaluation_end
        ]
        counts = Counter((event.champion_id, event.role) for event in future_picks)
        return {
            key: min(
                event.observed_at
                for event in future_picks
                if (event.champion_id, event.role) == key
            )
            for key, count in counts.items()
            if count >= threshold
        }
