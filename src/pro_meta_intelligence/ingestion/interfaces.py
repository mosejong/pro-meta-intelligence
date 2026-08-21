"""Source boundaries. Network implementations can be added without changing evaluation code."""

from __future__ import annotations

from typing import Protocol

from pro_meta_intelligence.models import (
    MatchRecord,
    PatchSnapshot,
    PickBanEvent,
    PlayerChampionUsage,
)


class PatchDataSource(Protocol):
    def snapshots(self) -> tuple[PatchSnapshot, ...]: ...


class ProMatchDataSource(Protocol):
    def matches(self) -> tuple[MatchRecord, ...]: ...

    def draft_events(self) -> tuple[PickBanEvent, ...]: ...


class SoloQueueDataSource(Protocol):
    def usage(self) -> tuple[PlayerChampionUsage, ...]: ...
