"""Typed, immutable domain contracts used by ingestion and historical evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any


def require_aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")


def require_temporal_order(observed_at: datetime, available_at: datetime) -> None:
    require_aware(observed_at, "observed_at")
    require_aware(available_at, "available_at")
    if available_at < observed_at:
        raise ValueError("available_at cannot be earlier than observed_at")


class DraftAction(StrEnum):
    PICK = "PICK"
    BAN = "BAN"


class Side(StrEnum):
    BLUE = "BLUE"
    RED = "RED"


class PatchChangeKind(StrEnum):
    BUFF = "BUFF"
    NERF = "NERF"
    ADJUST = "ADJUST"


@dataclass(frozen=True, slots=True)
class Provenance:
    source_id: str
    source_type: str
    source_uri: str
    source_version: str
    retrieved_at: datetime
    content_hash: str
    schema_version: str = "1"

    def __post_init__(self) -> None:
        require_aware(self.retrieved_at, "retrieved_at")
        for field_name in (
            "source_id",
            "source_type",
            "source_uri",
            "source_version",
            "content_hash",
            "schema_version",
        ):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} cannot be empty")


@dataclass(frozen=True, slots=True)
class ChampionPatchChange:
    champion_id: str
    role: str
    kind: PatchChangeKind
    reason: str


@dataclass(frozen=True, slots=True)
class PatchSnapshot:
    patch_id: str
    region: str
    champion_state_version: str
    item_state_version: str
    rune_state_version: str
    changes: tuple[ChampionPatchChange, ...]
    observed_at: datetime
    available_at: datetime
    provenance: Provenance

    def __post_init__(self) -> None:
        require_temporal_order(self.observed_at, self.available_at)


@dataclass(frozen=True, slots=True)
class MatchRecord:
    match_id: str
    series_id: str
    league: str
    tournament: str
    patch_id: str
    blue_team_id: str
    red_team_id: str
    winner_team_id: str
    observed_at: datetime
    available_at: datetime
    provenance: Provenance

    def __post_init__(self) -> None:
        require_temporal_order(self.observed_at, self.available_at)


@dataclass(frozen=True, slots=True)
class PickBanEvent:
    event_id: str
    match_id: str
    sequence: int
    team_id: str
    side: Side
    action: DraftAction
    champion_id: str
    role: str
    observed_at: datetime
    available_at: datetime
    provenance: Provenance

    def __post_init__(self) -> None:
        require_temporal_order(self.observed_at, self.available_at)
        if self.sequence < 1:
            raise ValueError("sequence must be positive")


@dataclass(frozen=True, slots=True)
class PlayerChampionUsage:
    usage_id: str
    champion_id: str
    role: str
    patch_id: str
    tier_bucket: str
    window_start: datetime
    window_end: datetime
    pick_count: int
    game_count: int
    observed_at: datetime
    available_at: datetime
    provenance: Provenance
    player_id: str | None = None

    def __post_init__(self) -> None:
        require_aware(self.window_start, "window_start")
        require_aware(self.window_end, "window_end")
        require_temporal_order(self.observed_at, self.available_at)
        if self.window_end <= self.window_start:
            raise ValueError("window_end must be after window_start")
        if self.observed_at != self.window_end:
            raise ValueError("aggregate usage observed_at must equal window_end")
        if self.pick_count < 0 or self.game_count <= 0 or self.pick_count > self.game_count:
            raise ValueError("usage counts must satisfy 0 <= pick_count <= game_count")

    @property
    def usage_rate(self) -> float:
        return self.pick_count / self.game_count


@dataclass(frozen=True, slots=True)
class EvidenceRecord:
    evidence_id: str
    evidence_type: str
    subject_id: str
    claim: str
    observed_at: datetime
    available_at: datetime
    provenance: Provenance

    def __post_init__(self) -> None:
        require_temporal_order(self.observed_at, self.available_at)


@dataclass(frozen=True, slots=True)
class SignalComponent:
    name: str
    value: float


@dataclass(frozen=True, slots=True)
class CandidateSignal:
    champion_id: str
    role: str
    baseline: str
    score: float
    formula: str
    explanation: str
    components: tuple[SignalComponent, ...]
    evidence_ids: tuple[str, ...]
    observed_at: datetime
    available_at: datetime

    def __post_init__(self) -> None:
        require_temporal_order(self.observed_at, self.available_at)
        if not self.formula or not self.evidence_ids:
            raise ValueError("candidate signals require a formula and evidence")

    @property
    def candidate_key(self) -> tuple[str, str]:
        return self.champion_id, self.role

    def to_dict(self, rank: int | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {
            "champion_id": self.champion_id,
            "role": self.role,
            "baseline": self.baseline,
            "score": round(self.score, 6),
            "formula": self.formula,
            "explanation": self.explanation,
            "components": {item.name: round(item.value, 6) for item in self.components},
            "evidence_ids": list(self.evidence_ids),
            "observed_at": self.observed_at.isoformat(),
            "available_at": self.available_at.isoformat(),
        }
        if rank is not None:
            result["rank"] = rank
        return result


@dataclass(frozen=True, slots=True)
class BacktestWindow:
    cutoff: datetime
    evaluation_start: datetime
    evaluation_end: datetime
    top_k: int

    def __post_init__(self) -> None:
        require_aware(self.cutoff, "cutoff")
        require_aware(self.evaluation_start, "evaluation_start")
        require_aware(self.evaluation_end, "evaluation_end")
        if self.evaluation_start < self.cutoff:
            raise ValueError("evaluation_start cannot be earlier than cutoff")
        if self.evaluation_end <= self.evaluation_start:
            raise ValueError("evaluation_end must be after evaluation_start")
        if self.top_k < 1:
            raise ValueError("top_k must be positive")
