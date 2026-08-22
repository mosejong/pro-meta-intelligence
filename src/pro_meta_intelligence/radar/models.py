"""Typed contracts for explainable patch-level Meta Radar output."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from importlib.resources import files
from pathlib import Path
from typing import Any

from pro_meta_intelligence.models import require_aware


@dataclass(frozen=True, slots=True)
class LeagueRegionMap:
    mappings: tuple[tuple[str, str], ...]
    schema_version: str = "1"

    def __post_init__(self) -> None:
        if self.schema_version != "1":
            raise ValueError("unsupported league-region schema_version")
        leagues = [league for league, _ in self.mappings]
        if len(leagues) != len(set(leagues)):
            raise ValueError("league-region mappings require unique league IDs")
        if any(not league or not region for league, region in self.mappings):
            raise ValueError("league and region values cannot be blank")

    @classmethod
    def from_json(cls, path: Path) -> LeagueRegionMap:
        return cls._from_raw(json.loads(path.read_text(encoding="utf-8")))

    @classmethod
    def load_default(cls) -> LeagueRegionMap:
        resource = files("pro_meta_intelligence").joinpath("config/league_regions.json")
        return cls._from_raw(json.loads(resource.read_text(encoding="utf-8")))

    @classmethod
    def _from_raw(cls, raw: dict[str, Any]) -> LeagueRegionMap:
        if not isinstance(raw, dict):
            raise ValueError("league-region config must be a JSON object")
        if raw.get("schema_version") != "1":
            raise ValueError("unsupported league-region schema_version")
        leagues = raw.get("leagues")
        if not isinstance(leagues, dict):
            raise ValueError("league-region config requires a leagues object")
        mappings: list[tuple[str, str]] = []
        for league, region in leagues.items():
            if not isinstance(league, str) or not isinstance(region, str):
                raise ValueError("league and region values must be strings")
            if league != league.strip() or region != region.strip():
                raise ValueError("league and region values cannot have surrounding whitespace")
            mappings.append((league, region))
        return cls(tuple(sorted(mappings)))

    def region_for(self, league: str) -> str | None:
        return dict(self.mappings).get(league)

    def to_dict(self) -> dict[str, str]:
        return dict(self.mappings)


@dataclass(frozen=True, slots=True)
class MetaRadarConfig:
    cutoff: datetime
    patch_id: str | None = None
    recent_window_days: int = 7
    prior_window_days: int = 7
    minimum_recent_matches: int = 5
    minimum_prior_matches: int = 5
    minimum_region_matches: int = 3
    minimum_current_picks: int = 2

    def __post_init__(self) -> None:
        require_aware(self.cutoff, "cutoff")
        for field_name in (
            "recent_window_days",
            "prior_window_days",
            "minimum_recent_matches",
            "minimum_prior_matches",
            "minimum_region_matches",
            "minimum_current_picks",
        ):
            if getattr(self, field_name) < 1:
                raise ValueError(f"{field_name} must be positive")
        if self.patch_id is not None and not self.patch_id.strip():
            raise ValueError("patch_id cannot be blank")


@dataclass(frozen=True, slots=True)
class RegionPresence:
    region: str
    match_count: int
    pick_count: int
    pick_presence: float
    delta_from_global: float
    sample_eligible: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "region": self.region,
            "match_count": self.match_count,
            "pick_count": self.pick_count,
            "pick_presence": _round(self.pick_presence),
            "delta_from_global": _round(self.delta_from_global),
            "sample_eligible": self.sample_eligible,
        }


@dataclass(frozen=True, slots=True)
class MetaRadarEntry:
    champion_id: str
    role: str
    current_pick_count: int
    prior_pick_count: int
    current_pick_presence: float
    prior_pick_presence: float
    pick_presence_delta: float
    current_distinct_team_count: int
    prior_distinct_team_count: int
    current_demand: float
    prior_demand: float
    demand_velocity: float
    team_concentration: float | None
    regional_divergence: float | None
    most_divergent_region: str | None
    most_divergent_region_delta: float | None
    region_presence: tuple[RegionPresence, ...]
    eligible_for_review: bool
    quality_flags: tuple[str, ...]
    evidence_event_ids: tuple[str, ...]

    @property
    def candidate_key(self) -> tuple[str, str]:
        return self.champion_id, self.role

    def to_dict(self, rank: int) -> dict[str, object]:
        return {
            "rank": rank,
            "champion_id": self.champion_id,
            "role": self.role,
            "eligible_for_review": self.eligible_for_review,
            "quality_flags": list(self.quality_flags),
            "metrics": {
                "current_pick_count": self.current_pick_count,
                "prior_pick_count": self.prior_pick_count,
                "current_pick_presence": _round(self.current_pick_presence),
                "prior_pick_presence": _round(self.prior_pick_presence),
                "pick_presence_delta": _round(self.pick_presence_delta),
                "current_distinct_team_count": self.current_distinct_team_count,
                "prior_distinct_team_count": self.prior_distinct_team_count,
                "current_demand": _round(self.current_demand),
                "prior_demand": _round(self.prior_demand),
                "demand_velocity": _round(self.demand_velocity),
                "team_concentration": _optional_round(self.team_concentration),
                "regional_divergence": _optional_round(self.regional_divergence),
                "most_divergent_region": self.most_divergent_region,
                "most_divergent_region_delta": _optional_round(self.most_divergent_region_delta),
            },
            "region_presence": [item.to_dict() for item in self.region_presence],
            "evidence_event_ids": list(self.evidence_event_ids),
        }


@dataclass(frozen=True, slots=True)
class MetaRadarReport:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


def _round(value: float) -> float:
    return round(value, 6)


def _optional_round(value: float | None) -> float | None:
    return _round(value) if value is not None else None
