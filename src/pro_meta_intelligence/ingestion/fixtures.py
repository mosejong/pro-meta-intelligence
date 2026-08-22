"""Offline adapters backed by a versioned, deterministic synthetic fixture."""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any

from pro_meta_intelligence.models import (
    BacktestWindow,
    ChampionPatchChange,
    DraftAction,
    EvidenceRecord,
    MatchRecord,
    PatchChangeKind,
    PatchSnapshot,
    PickBanEvent,
    PlayerChampionUsage,
    Provenance,
    Side,
)
from pro_meta_intelligence.temporal import parse_datetime


def _provenance(raw: dict[str, Any]) -> Provenance:
    return Provenance(
        source_id=raw["source_id"],
        source_type=raw["source_type"],
        source_uri=raw["source_uri"],
        source_version=raw["source_version"],
        retrieved_at=parse_datetime(raw["retrieved_at"]),
        content_hash=raw["content_hash"],
        schema_version=raw["schema_version"],
    )


@dataclass(frozen=True, slots=True)
class FixturePatchAdapter:
    records: tuple[PatchSnapshot, ...]

    def snapshots(self) -> tuple[PatchSnapshot, ...]:
        return self.records


@dataclass(frozen=True, slots=True)
class FixtureProMatchAdapter:
    match_records: tuple[MatchRecord, ...]
    event_records: tuple[PickBanEvent, ...]

    def matches(self) -> tuple[MatchRecord, ...]:
        return self.match_records

    def draft_events(self) -> tuple[PickBanEvent, ...]:
        return self.event_records


@dataclass(frozen=True, slots=True)
class FixtureSoloQueueAdapter:
    records: tuple[PlayerChampionUsage, ...]

    def usage(self) -> tuple[PlayerChampionUsage, ...]:
        return self.records


@dataclass(frozen=True, slots=True)
class SyntheticScenario:
    scenario_id: str
    snapshot_id: str
    adoption_threshold: int
    fixture_only: bool
    window: BacktestWindow
    patch_adapter: FixturePatchAdapter
    pro_adapter: FixtureProMatchAdapter
    solo_queue_adapter: FixtureSoloQueueAdapter
    evidence: tuple[EvidenceRecord, ...]

    def __post_init__(self) -> None:
        if self.adoption_threshold < 1:
            raise ValueError("adoption_threshold must be positive")


def load_synthetic_scenario(path: Path | None = None) -> SyntheticScenario:
    fixture_path = path or Path(
        str(files("pro_meta_intelligence").joinpath("fixtures/synthetic_scenario.json"))
    )
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    sources = {key: _provenance(value) for key, value in raw["sources"].items()}

    patches = tuple(
        PatchSnapshot(
            patch_id=item["patch_id"],
            region=item["region"],
            champion_state_version=item["champion_state_version"],
            item_state_version=item["item_state_version"],
            rune_state_version=item["rune_state_version"],
            changes=tuple(
                ChampionPatchChange(
                    champion_id=change["champion_id"],
                    role=change["role"],
                    kind=PatchChangeKind(change["kind"]),
                    reason=change["reason"],
                )
                for change in item["changes"]
            ),
            observed_at=parse_datetime(item["observed_at"]),
            available_at=parse_datetime(item["available_at"]),
            provenance=sources[item["source"]],
        )
        for item in raw["patch_snapshots"]
    )
    matches = tuple(
        MatchRecord(
            match_id=item["match_id"],
            series_id=item["series_id"],
            league=item["league"],
            tournament=item["tournament"],
            patch_id=item["patch_id"],
            blue_team_id=item["blue_team_id"],
            red_team_id=item["red_team_id"],
            winner_team_id=item["winner_team_id"],
            observed_at=parse_datetime(item["observed_at"]),
            available_at=parse_datetime(item["available_at"]),
            provenance=sources[item["source"]],
        )
        for item in raw["matches"]
    )
    events = tuple(
        PickBanEvent(
            event_id=item["event_id"],
            match_id=item["match_id"],
            sequence=item["sequence"],
            team_id=item["team_id"],
            side=Side(item["side"]),
            action=DraftAction(item["action"]),
            champion_id=item["champion_id"],
            role=item["role"],
            observed_at=parse_datetime(item["observed_at"]),
            available_at=parse_datetime(item["available_at"]),
            provenance=sources[item["source"]],
        )
        for item in raw["pick_ban_events"]
    )
    usage = tuple(
        PlayerChampionUsage(
            usage_id=item["usage_id"],
            player_id=item.get("player_id"),
            champion_id=item["champion_id"],
            role=item["role"],
            patch_id=item["patch_id"],
            tier_bucket=item["tier_bucket"],
            window_start=parse_datetime(item["window_start"]),
            window_end=parse_datetime(item["window_end"]),
            pick_count=item["pick_count"],
            game_count=item["game_count"],
            observed_at=parse_datetime(item["observed_at"]),
            available_at=parse_datetime(item["available_at"]),
            provenance=sources[item["source"]],
        )
        for item in raw["solo_queue_usage"]
    )
    evidence = tuple(
        EvidenceRecord(
            evidence_id=item["evidence_id"],
            evidence_type=item["evidence_type"],
            subject_id=item["subject_id"],
            claim=item["claim"],
            observed_at=parse_datetime(item["observed_at"]),
            available_at=parse_datetime(item["available_at"]),
            provenance=sources[item["source"]],
        )
        for item in raw["evidence"]
    )
    window_data = raw["window"]
    return SyntheticScenario(
        scenario_id=raw["scenario_id"],
        snapshot_id=raw["snapshot_id"],
        adoption_threshold=raw["adoption_threshold"],
        fixture_only=True,
        window=BacktestWindow(
            cutoff=parse_datetime(window_data["cutoff"]),
            evaluation_start=parse_datetime(window_data["evaluation_start"]),
            evaluation_end=parse_datetime(window_data["evaluation_end"]),
            top_k=window_data["top_k"],
        ),
        patch_adapter=FixturePatchAdapter(patches),
        pro_adapter=FixtureProMatchAdapter(matches, events),
        solo_queue_adapter=FixtureSoloQueueAdapter(usage),
        evidence=evidence,
    )
