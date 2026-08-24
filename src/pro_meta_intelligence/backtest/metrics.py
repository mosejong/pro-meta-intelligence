from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import median

from pro_meta_intelligence.models import CandidateSignal

CandidateKey = tuple[str, str]


@dataclass(frozen=True, slots=True)
class RankingMetrics:
    recall_at_k: float
    precision_at_k: float
    false_alert_rate: float
    false_alert_count: int
    median_lead_time_hours: float | None

    def to_dict(self) -> dict[str, float | int | None]:
        return {
            "recall_at_k": round(self.recall_at_k, 6),
            "precision_at_k": round(self.precision_at_k, 6),
            "false_alert_rate": round(self.false_alert_rate, 6),
            "false_alert_count": self.false_alert_count,
            "median_lead_time_hours": (
                round(self.median_lead_time_hours, 3)
                if self.median_lead_time_hours is not None
                else None
            ),
        }


def calculate_metrics(
    ranking: tuple[CandidateSignal, ...],
    top_k: int,
    adoption_times: dict[CandidateKey, datetime],
    cutoff: datetime,
) -> RankingMetrics:
    selected = ranking[:top_k]
    selected_keys = {signal.candidate_key for signal in selected}
    actual_keys = set(adoption_times)
    hits = selected_keys & actual_keys
    false_alerts = len(selected_keys - actual_keys)
    lead_times = [(adoption_times[key] - cutoff).total_seconds() / 3600 for key in sorted(hits)]
    return RankingMetrics(
        recall_at_k=len(hits) / len(actual_keys) if actual_keys else 0.0,
        precision_at_k=len(hits) / len(selected_keys) if selected_keys else 0.0,
        false_alert_rate=false_alerts / len(selected_keys) if selected_keys else 0.0,
        false_alert_count=false_alerts,
        median_lead_time_hours=median(lead_times) if lead_times else None,
    )
