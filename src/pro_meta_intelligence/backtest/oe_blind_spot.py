"""Walk-forward Blind Spot Benchmark over immutable Oracle's Elixir archives."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from statistics import median
from typing import Any

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction, PickBanEvent
from pro_meta_intelligence.quality import OEHistoryCriteria, audit_oe_history
from pro_meta_intelligence.quality.oe_coverage import KNOWN_EXCLUSION_CODES
from pro_meta_intelligence.radar import LeagueRegionMap, MetaRadar, MetaRadarConfig
from pro_meta_intelligence.sources import ArchivedSnapshot, ArchiveInspection, SourceRegistry

CandidateKey = tuple[str, str]


@dataclass(frozen=True, slots=True)
class OEBlindSpotConfig:
    top_k: int = 10
    minimum_future_picks: int = 2
    minimum_future_distinct_teams: int = 2
    maximum_pre_cutoff_presence: float = 0.1
    patch_id: str | None = None
    recent_window_days: int = 7
    prior_window_days: int = 7
    minimum_recent_matches: int = 5
    minimum_prior_matches: int = 5
    minimum_region_matches: int = 3
    minimum_current_picks: int = 2

    def __post_init__(self) -> None:
        for field_name in (
            "top_k",
            "minimum_future_picks",
            "minimum_future_distinct_teams",
            "recent_window_days",
            "prior_window_days",
            "minimum_recent_matches",
            "minimum_prior_matches",
            "minimum_region_matches",
            "minimum_current_picks",
        ):
            if getattr(self, field_name) < 1:
                raise ValueError(f"{field_name} must be positive")
        if not 0 <= self.maximum_pre_cutoff_presence <= 1:
            raise ValueError("maximum_pre_cutoff_presence must be between 0 and 1")
        if self.patch_id is not None and not self.patch_id.strip():
            raise ValueError("patch_id cannot be blank")


@dataclass(frozen=True, slots=True)
class OEBlindSpotReport:
    payload: dict[str, Any]

    @property
    def benchmark_ready(self) -> bool:
        return bool(self.payload["benchmark_ready"])

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


def benchmark_oe_blind_spots(
    inspection: ArchiveInspection,
    registry: SourceRegistry,
    *,
    source_timezone: str,
    history_criteria: OEHistoryCriteria,
    config: OEBlindSpotConfig,
    league_regions: LeagueRegionMap,
) -> OEBlindSpotReport:
    """Evaluate only matured point-in-time states and pin each future outcome state by hash."""

    history = audit_oe_history(
        inspection,
        registry,
        source_timezone=source_timezone,
        criteria=history_criteria,
    ).to_dict()
    base = {
        "schema_version": "1",
        "benchmark_kind": "OE_WALK_FORWARD_BLIND_SPOT",
        "source_id": inspection.source_id,
        "benchmark_ready": False,
        "history_readiness": {
            "ready": history["ready_for_historical_backtest"],
            "blocking_reasons": history["blocking_reasons"],
            "criteria": history["criteria"],
            "collection": history["collection"],
            "warnings": history["warnings"],
        },
        "candidate_policy": {
            "ranking": "eligible Meta Radar entries in their published deterministic order",
            "top_k": config.top_k,
            "maximum_pre_cutoff_pick_presence": config.maximum_pre_cutoff_presence,
            "presence_filter_applies_before_top_k": True,
        },
        "outcome_policy": {
            "event": DraftAction.PICK.value,
            "same_patch_only": True,
            "minimum_future_picks": config.minimum_future_picks,
            "minimum_future_distinct_teams": config.minimum_future_distinct_teams,
            "confirmation_time": "first future event where both thresholds are satisfied",
        },
        "radar_config": {
            "patch_id": config.patch_id,
            "recent_window_days": config.recent_window_days,
            "prior_window_days": config.prior_window_days,
            "minimum_recent_matches": config.minimum_recent_matches,
            "minimum_prior_matches": config.minimum_prior_matches,
            "minimum_region_matches": config.minimum_region_matches,
            "minimum_current_picks": config.minimum_current_picks,
        },
        "cutoffs": [],
        "skipped_cutoffs": [],
        "aggregate": _empty_aggregate(),
        "limitations": [
            "readiness and measured recall are not evidence of causal draft prediction",
            "outcomes use only a later immutable content hash named by the history audit",
            "public match data cannot measure scrim readiness, player comfort, or team intent",
            "small or repeated walk-forward windows are descriptive and require uncertainty review",
        ],
    }
    if not history["ready_for_historical_backtest"]:
        base["status"] = "HISTORY_NOT_READY"
        return OEBlindSpotReport(base)

    snapshots = _first_snapshots_by_hash(inspection.snapshots)
    adapter = OracleElixirCSVAdapter(registry)
    import_cache = {}
    evaluated = []
    skipped = []
    for matured in history["matured_cutoffs"]:
        cutoff_snapshot = snapshots.get(matured["content_hash"])
        outcome_snapshot = snapshots.get(matured["outcome_available_from_hash"])
        if cutoff_snapshot is None or outcome_snapshot is None:
            raise ValueError("history audit referenced a snapshot hash absent from the inspection")
        cutoff = cutoff_snapshot.retrieved_at
        if cutoff.isoformat() != matured["cutoff"]:
            raise ValueError("history cutoff does not match the first archived retrieval")
        cutoff_import = _load_import(adapter, cutoff_snapshot, source_timezone, import_cache)
        outcome_import = _load_import(adapter, outcome_snapshot, source_timezone, import_cache)
        radar_config = MetaRadarConfig(
            cutoff=cutoff,
            patch_id=config.patch_id,
            recent_window_days=config.recent_window_days,
            prior_window_days=config.prior_window_days,
            minimum_recent_matches=config.minimum_recent_matches,
            minimum_prior_matches=config.minimum_prior_matches,
            minimum_region_matches=config.minimum_region_matches,
            minimum_current_picks=config.minimum_current_picks,
        )
        try:
            radar = (
                MetaRadar()
                .build(
                    cutoff_import.matches,
                    cutoff_import.draft_events,
                    radar_config,
                    league_regions,
                )
                .to_dict()
            )
        except ValueError as error:
            skipped.append(
                {
                    "cutoff": cutoff.isoformat(),
                    "cutoff_content_hash": cutoff_snapshot.content_hash,
                    "outcome_content_hash": outcome_snapshot.content_hash,
                    "reason": "RADAR_BUILD_FAILED",
                    "detail": str(error),
                }
            )
            continue
        patch_id = radar["patch_id"]
        cutoff_import_quality = _patch_import_quality(cutoff_import.report, patch_id)
        outcome_import_quality = _patch_import_quality(outcome_import.report, patch_id)
        if (
            cutoff_import_quality["blocking_issue_game_count"]
            or outcome_import_quality["blocking_issue_game_count"]
        ):
            skipped.append(
                {
                    "cutoff": cutoff.isoformat(),
                    "patch_id": patch_id,
                    "cutoff_content_hash": cutoff_snapshot.content_hash,
                    "outcome_content_hash": outcome_snapshot.content_hash,
                    "reason": "PATCH_HAS_BLOCKING_IMPORT_ISSUES",
                    "cutoff_import_quality": cutoff_import_quality,
                    "outcome_import_quality": outcome_import_quality,
                }
            )
            continue
        evaluated.append(
            _evaluate_cutoff(
                radar,
                outcome_import.matches,
                outcome_import.draft_events,
                cutoff=cutoff,
                cutoff_hash=cutoff_snapshot.content_hash,
                outcome_snapshot=outcome_snapshot,
                config=config,
                cutoff_import_quality=cutoff_import_quality,
                outcome_import_quality=outcome_import_quality,
            )
        )

    base["cutoffs"] = evaluated
    base["skipped_cutoffs"] = skipped
    base["aggregate"] = _aggregate(evaluated, skipped)
    base["benchmark_ready"] = bool(evaluated)
    base["status"] = "COMPLETE" if evaluated else "NO_EVALUABLE_CUTOFFS"
    return OEBlindSpotReport(base)


def _load_import(adapter, snapshot, source_timezone, cache):
    imported = cache.get(snapshot.content_hash)
    if imported is None:
        imported = adapter.import_file(
            snapshot.data_path,
            retrieved_at=snapshot.retrieved_at,
            source_timezone=source_timezone,
            source_uri=snapshot.final_url,
        )
        cache[snapshot.content_hash] = imported
    return imported


def _first_snapshots_by_hash(
    snapshots: tuple[ArchivedSnapshot, ...],
) -> dict[str, ArchivedSnapshot]:
    first = {}
    for snapshot in snapshots:
        current = first.get(snapshot.content_hash)
        if current is None or snapshot.retrieved_at < current.retrieved_at:
            first[snapshot.content_hash] = snapshot
    return first


def _evaluate_cutoff(
    radar: dict[str, Any],
    outcome_matches,
    outcome_events: tuple[PickBanEvent, ...],
    *,
    cutoff: datetime,
    cutoff_hash: str,
    outcome_snapshot: ArchivedSnapshot,
    config: OEBlindSpotConfig,
    cutoff_import_quality: dict[str, Any],
    outcome_import_quality: dict[str, Any],
) -> dict[str, Any]:
    entries = radar["entries"]
    by_key = {(item["champion_id"], item["role"]): item for item in entries}
    eligible = [
        item
        for item in entries
        if item["eligible_for_review"]
        and item["metrics"]["current_pick_presence"] <= config.maximum_pre_cutoff_presence
    ]
    selected = eligible[: config.top_k]
    selected_keys = {(item["champion_id"], item["role"]) for item in selected}
    patch_id = radar["patch_id"]
    future_match_ids = {
        match.match_id
        for match in outcome_matches
        if match.patch_id == patch_id
        and cutoff < match.observed_at <= outcome_snapshot.retrieved_at
    }
    future_picks = [
        event
        for event in outcome_events
        if event.action is DraftAction.PICK and event.match_id in future_match_ids
    ]
    targets = _meaningful_adoptions(future_picks, by_key, config)
    target_keys = set(targets)
    hits = selected_keys & target_keys
    misses = target_keys - selected_keys
    false_alerts = selected_keys - target_keys
    lead_times = [
        (targets[key]["confirmed_at_value"] - cutoff).total_seconds() / 3600 for key in sorted(hits)
    ]
    selected_payload = [
        {
            "rank": item["rank"],
            "champion_id": item["champion_id"],
            "role": item["role"],
            "current_pick_presence": item["metrics"]["current_pick_presence"],
            "pick_presence_delta": item["metrics"]["pick_presence_delta"],
            "demand_velocity": item["metrics"]["demand_velocity"],
            "evidence_event_ids": item["evidence_event_ids"],
            "outcome": "HIT" if (item["champion_id"], item["role"]) in hits else "FALSE_ALERT",
        }
        for item in selected
    ]
    adoption_payload = [
        {
            key_name: value
            for key_name, value in targets[key].items()
            if key_name != "confirmed_at_value"
        }
        for key in sorted(targets)
    ]
    failure_cases = [
        {
            "type": "MISSED_ADOPTION",
            "champion_id": key[0],
            "role": key[1],
            "future_pick_count": targets[key]["future_pick_count"],
            "future_distinct_team_count": targets[key]["future_distinct_team_count"],
            "confirmed_at": targets[key]["confirmed_at"],
            "outcome_match_ids": targets[key]["outcome_match_ids"],
        }
        for key in sorted(misses)
    ] + [
        {
            "type": "FALSE_ALERT",
            "champion_id": key[0],
            "role": key[1],
            "radar_rank": by_key[key]["rank"],
            "evidence_event_ids": by_key[key]["evidence_event_ids"],
        }
        for key in sorted(false_alerts)
    ]
    selected_count = len(selected_keys)
    target_count = len(target_keys)
    hit_count = len(hits)
    evidence_count = sum(bool(item["evidence_event_ids"]) for item in selected)
    return {
        "cutoff": cutoff.isoformat(),
        "outcome_end": outcome_snapshot.retrieved_at.isoformat(),
        "patch_id": patch_id,
        "cutoff_content_hash": cutoff_hash,
        "outcome_content_hash": outcome_snapshot.content_hash,
        "radar_source_versions": radar["evidence_index"]["source_versions"],
        "cutoff_import_quality": cutoff_import_quality,
        "outcome_import_quality": outcome_import_quality,
        "windows": radar["windows"],
        "candidate_count": len(entries),
        "eligible_low_presence_candidate_count": len(eligible),
        "selected_candidates": selected_payload,
        "actual_adoptions": adoption_payload,
        "failure_cases": failure_cases,
        "metrics": {
            "recall_at_k": _rate_or_none(hit_count, target_count),
            "precision_at_k": _rate_or_none(hit_count, selected_count),
            "false_alert_rate": _rate_or_none(len(false_alerts), selected_count),
            "false_alert_count": len(false_alerts),
            "hit_count": hit_count,
            "miss_count": len(misses),
            "target_count": target_count,
            "selected_count": selected_count,
            "median_lead_time_hours": _rounded(median(lead_times)) if lead_times else None,
            "review_compression": _rate_or_none(len(entries), selected_count),
            "evidence_coverage": _rate_or_none(evidence_count, selected_count),
        },
    }


def _patch_import_quality(report, patch_id):
    context = [
        {
            "patch_id": item_patch,
            "league": league,
            "code": code,
            "count": count,
            "disposition": "KNOWN_EXCLUSION" if code in KNOWN_EXCLUSION_CODES else "BLOCKING",
        }
        for item_patch, league, code, count in report.issue_context_counts
        if item_patch in {None, patch_id}
    ]
    known = sum(item["count"] for item in context if item["disposition"] == "KNOWN_EXCLUSION")
    blocking = sum(item["count"] for item in context if item["disposition"] == "BLOCKING")
    return {
        "patch_id": patch_id,
        "known_exclusion_game_count": known,
        "blocking_issue_game_count": blocking,
        "issue_context": context,
    }


def _meaningful_adoptions(future_picks, pre_cutoff, config):
    grouped = defaultdict(list)
    for event in future_picks:
        grouped[(event.champion_id, event.role)].append(event)
    targets = {}
    for key, events in sorted(grouped.items()):
        pre_presence = pre_cutoff.get(key, {}).get("metrics", {}).get("current_pick_presence", 0.0)
        if pre_presence > config.maximum_pre_cutoff_presence:
            continue
        ordered = sorted(events, key=lambda item: (item.observed_at, item.event_id))
        match_ids = set()
        team_ids = set()
        confirmed_at = None
        for event in ordered:
            match_ids.add(event.match_id)
            team_ids.add(event.team_id)
            if (
                len(match_ids) >= config.minimum_future_picks
                and len(team_ids) >= config.minimum_future_distinct_teams
            ):
                confirmed_at = event.observed_at
                break
        if confirmed_at is None:
            continue
        targets[key] = {
            "champion_id": key[0],
            "role": key[1],
            "pre_cutoff_pick_presence": _rounded(pre_presence),
            "future_pick_count": len({event.match_id for event in ordered}),
            "future_distinct_team_count": len({event.team_id for event in ordered}),
            "first_future_pick_at": ordered[0].observed_at.isoformat(),
            "confirmed_at": confirmed_at.isoformat(),
            "confirmed_at_value": confirmed_at,
            "outcome_match_ids": sorted({event.match_id for event in ordered}),
            "outcome_event_ids": sorted(event.event_id for event in ordered),
        }
    return targets


def _aggregate(cutoffs, skipped):
    if not cutoffs:
        return _empty_aggregate(skipped_count=len(skipped))
    metrics = [item["metrics"] for item in cutoffs]
    recall_values = [item["recall_at_k"] for item in metrics if item["recall_at_k"] is not None]
    precision_values = [
        item["precision_at_k"] for item in metrics if item["precision_at_k"] is not None
    ]
    lead_times = []
    for cutoff in cutoffs:
        cutoff_at = datetime.fromisoformat(cutoff["cutoff"])
        hit_keys = {
            (item["champion_id"], item["role"])
            for item in cutoff["selected_candidates"]
            if item["outcome"] == "HIT"
        }
        for adoption in cutoff["actual_adoptions"]:
            if (adoption["champion_id"], adoption["role"]) in hit_keys:
                confirmed_at = datetime.fromisoformat(adoption["confirmed_at"])
                lead_times.append((confirmed_at - cutoff_at).total_seconds() / 3600)
    total_hits = sum(item["hit_count"] for item in metrics)
    total_targets = sum(item["target_count"] for item in metrics)
    total_selected = sum(item["selected_count"] for item in metrics)
    total_false_alerts = sum(item["false_alert_count"] for item in metrics)
    total_candidates = sum(item["candidate_count"] for item in cutoffs)
    evidence_selected = sum(
        bool(candidate["evidence_event_ids"])
        for cutoff in cutoffs
        for candidate in cutoff["selected_candidates"]
    )
    return {
        "evaluated_cutoff_count": len(cutoffs),
        "skipped_cutoff_count": len(skipped),
        "target_observation_count": total_targets,
        "selected_candidate_observation_count": total_selected,
        "hit_observation_count": total_hits,
        "false_alert_observation_count": total_false_alerts,
        "micro_recall_at_k": _rate_or_none(total_hits, total_targets),
        "micro_precision_at_k": _rate_or_none(total_hits, total_selected),
        "macro_recall_at_k": _mean_or_none(recall_values),
        "macro_precision_at_k": _mean_or_none(precision_values),
        "false_alerts_per_cutoff": _rounded(total_false_alerts / len(cutoffs)),
        "median_lead_time_hours": _rounded(median(lead_times)) if lead_times else None,
        "review_compression": _rate_or_none(total_candidates, total_selected),
        "evidence_coverage": _rate_or_none(evidence_selected, total_selected),
    }


def _empty_aggregate(*, skipped_count=0):
    return {
        "evaluated_cutoff_count": 0,
        "skipped_cutoff_count": skipped_count,
        "target_observation_count": 0,
        "selected_candidate_observation_count": 0,
        "hit_observation_count": 0,
        "false_alert_observation_count": 0,
        "micro_recall_at_k": None,
        "micro_precision_at_k": None,
        "macro_recall_at_k": None,
        "macro_precision_at_k": None,
        "false_alerts_per_cutoff": None,
        "median_lead_time_hours": None,
        "review_compression": None,
        "evidence_coverage": None,
    }


def _rate_or_none(numerator, denominator):
    return _rounded(numerator / denominator) if denominator else None


def _mean_or_none(values):
    return _rounded(sum(values) / len(values)) if values else None


def _rounded(value):
    return round(value, 6)
