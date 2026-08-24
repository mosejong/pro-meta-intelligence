from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from pro_meta_intelligence.models import (
    CandidateSignal,
    MatchRecord,
    PatchSnapshot,
    PickBanEvent,
    PlayerChampionUsage,
    require_aware,
)


@dataclass(frozen=True, slots=True)
class HistoricalSnapshot:
    cutoff: datetime
    patches: tuple[PatchSnapshot, ...]
    matches: tuple[MatchRecord, ...]
    draft_events: tuple[PickBanEvent, ...]
    solo_queue_usage: tuple[PlayerChampionUsage, ...]

    def __post_init__(self) -> None:
        require_aware(self.cutoff, "cutoff")


class Baseline(Protocol):
    name: str

    def rank(self, snapshot: HistoricalSnapshot) -> tuple[CandidateSignal, ...]: ...


def rank_signals(signals: list[CandidateSignal]) -> tuple[CandidateSignal, ...]:
    return tuple(sorted(signals, key=lambda item: (-item.score, item.champion_id, item.role)))
