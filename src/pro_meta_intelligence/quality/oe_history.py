"""Historical Oracle's Elixir archive readiness with deep snapshot validation."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from pro_meta_intelligence.ingestion.oracles_elixir import (
    OracleElixirCSVAdapter,
    OracleElixirImport,
)
from pro_meta_intelligence.quality.oe_coverage import KNOWN_EXCLUSION_CODES
from pro_meta_intelligence.sources import ArchiveInspection, SourceRegistry


@dataclass(frozen=True, slots=True)
class OEHistoryCriteria:
    minimum_retrievals: int = 14
    minimum_unique_states: int = 3
    minimum_collection_span_days: int = 14
    maximum_gap_hours: int = 48
    outcome_horizon_days: int = 7
    minimum_matured_cutoffs: int = 2

    def __post_init__(self) -> None:
        for field_name in (
            "minimum_retrievals",
            "minimum_unique_states",
            "minimum_collection_span_days",
            "maximum_gap_hours",
            "outcome_horizon_days",
            "minimum_matured_cutoffs",
        ):
            if getattr(self, field_name) < 1:
                raise ValueError(f"{field_name} must be positive")


@dataclass(frozen=True, slots=True)
class OEHistoryAudit:
    payload: dict[str, Any]

    @property
    def ready_for_historical_backtest(self) -> bool:
        return bool(self.payload["ready_for_historical_backtest"])

    def to_dict(self) -> dict[str, Any]:
        return self.payload


def audit_oe_history(
    inspection: ArchiveInspection,
    registry: SourceRegistry,
    *,
    source_timezone: str,
    criteria: OEHistoryCriteria,
) -> OEHistoryAudit:
    """Verify raw bytes and imports, then measure collection continuity and outcome maturity."""

    snapshots = inspection.snapshots
    by_hash = defaultdict(list)
    by_retrieved_at = defaultdict(set)
    for snapshot in snapshots:
        by_hash[snapshot.content_hash].append(snapshot)
        by_retrieved_at[snapshot.retrieved_at].add(snapshot.content_hash)

    validation_issues: list[dict[str, str]] = []
    validated: dict[str, dict[str, Any]] = {}
    state_fingerprints: dict[str, dict[str, str]] = {}
    state_observed_at: dict[str, dict[str, datetime]] = {}
    adapter = OracleElixirCSVAdapter(registry)
    for content_hash, occurrences in sorted(by_hash.items()):
        ordered = sorted(occurrences, key=lambda item: item.retrieved_at)
        representative = ordered[0]
        try:
            imported = adapter.import_file(
                representative.data_path,
                retrieved_at=representative.retrieved_at,
                source_timezone=source_timezone,
                source_uri=representative.final_url,
            )
        except Exception as error:
            validation_issues.append(
                {
                    "code": "IMPORT_VALIDATION_FAILED",
                    "content_hash": content_hash,
                    "detail": f"{type(error).__name__}: {error}",
                }
            )
            continue
        observed = [match.observed_at for match in imported.matches]
        issue_counts = dict(imported.report.issue_counts)
        known_exclusion_count = sum(
            count for code, count in issue_counts.items() if code in KNOWN_EXCLUSION_CODES
        )
        blocking_issue_count = sum(
            count for code, count in issue_counts.items() if code not in KNOWN_EXCLUSION_CODES
        )
        fingerprints = _match_fingerprints(imported)
        normalized_state_hash = _normalized_state_hash(fingerprints)
        state_fingerprints[normalized_state_hash] = fingerprints
        state_observed_at[normalized_state_hash] = {
            match.match_id: match.observed_at for match in imported.matches
        }
        validated[content_hash] = {
            "content_hash": content_hash,
            "normalized_state_hash": normalized_state_hash,
            "byte_length": representative.byte_length,
            "retrieval_count": len(ordered),
            "first_retrieved_at": ordered[0].retrieved_at.isoformat(),
            "last_retrieved_at": ordered[-1].retrieved_at.isoformat(),
            "discovered_game_count": imported.report.discovered_game_count,
            "imported_game_count": imported.report.imported_game_count,
            "rejected_game_count": imported.report.rejected_game_count,
            "known_exclusion_game_count": known_exclusion_count,
            "blocking_issue_game_count": blocking_issue_count,
            "issue_counts": issue_counts,
            "first_observed_at": min(observed).isoformat() if observed else None,
            "last_observed_at": max(observed).isoformat() if observed else None,
        }

    retrieval_times = sorted({snapshot.retrieved_at for snapshot in snapshots})
    gaps = []
    for previous, current in zip(retrieval_times, retrieval_times[1:], strict=False):
        gap_hours = (current - previous).total_seconds() / 3600
        if gap_hours > criteria.maximum_gap_hours:
            gaps.append(
                {
                    "start": previous.isoformat(),
                    "end": current.isoformat(),
                    "hours": round(gap_hours, 6),
                }
            )

    valid_hashes = set(validated)
    first_seen_by_state: dict[str, tuple[datetime, str]] = {}
    for content_hash, occurrences in by_hash.items():
        if content_hash not in valid_hashes:
            continue
        state_hash = validated[content_hash]["normalized_state_hash"]
        first_retrieved_at = min(item.retrieved_at for item in occurrences)
        previous = first_seen_by_state.get(state_hash)
        if previous is None or first_retrieved_at < previous[0]:
            first_seen_by_state[state_hash] = (first_retrieved_at, content_hash)

    matured_cutoffs = []
    horizon = timedelta(days=criteria.outcome_horizon_days)
    ordered_states = sorted(first_seen_by_state.items(), key=lambda item: (item[1][0], item[0]))
    for state_hash, (cutoff, content_hash) in ordered_states:
        later_states = [
            (
                other_state,
                other_time,
                other_content,
                sum(
                    observed_at > cutoff for observed_at in state_observed_at[other_state].values()
                ),
            )
            for other_state, (other_time, other_content) in first_seen_by_state.items()
            if other_state != state_hash
            and other_time >= cutoff + horizon
            and any(observed_at > cutoff for observed_at in state_observed_at[other_state].values())
        ]
        if later_states:
            outcome_state, _, outcome_content, future_match_count = min(
                later_states, key=lambda item: (item[1], item[0])
            )
            matured_cutoffs.append(
                {
                    "content_hash": content_hash,
                    "normalized_state_hash": state_hash,
                    "cutoff": cutoff.isoformat(),
                    "outcome_available_from_hash": outcome_content,
                    "outcome_normalized_state_hash": outcome_state,
                    "outcome_future_match_count": future_match_count,
                }
            )

    state_sequence: list[tuple[datetime, str, str]] = []
    for snapshot in snapshots:
        if snapshot.content_hash not in valid_hashes:
            continue
        state_hash = validated[snapshot.content_hash]["normalized_state_hash"]
        if not state_sequence or state_sequence[-1][1] != state_hash:
            state_sequence.append((snapshot.retrieved_at, state_hash, snapshot.content_hash))
    revision_ledger = []
    warnings: list[str] = []
    if any(summary["known_exclusion_game_count"] for summary in validated.values()):
        warnings.append("KNOWN_IMPORT_EXCLUSIONS_PRESENT")
    if any(summary["blocking_issue_game_count"] for summary in validated.values()):
        warnings.append("BLOCKING_GAME_IMPORT_ISSUES_PRESENT")
    for previous, current in zip(state_sequence, state_sequence[1:], strict=False):
        previous_time, previous_state, previous_content = previous
        current_time, current_state, current_content = current
        before = state_fingerprints[previous_state]
        after = state_fingerprints[current_state]
        common_ids = before.keys() & after.keys()
        revised_count = sum(before[match_id] != after[match_id] for match_id in common_ids)
        removed_count = len(before.keys() - after.keys())
        revision_ledger.append(
            {
                "from_retrieved_at": previous_time.isoformat(),
                "to_retrieved_at": current_time.isoformat(),
                "from_content_hash": previous_content,
                "to_content_hash": current_content,
                "from_normalized_state_hash": previous_state,
                "to_normalized_state_hash": current_state,
                "added_match_count": len(after.keys() - before.keys()),
                "removed_match_count": removed_count,
                "revised_match_count": revised_count,
                "unchanged_match_count": len(common_ids) - revised_count,
            }
        )
        if removed_count and "HISTORICAL_MATCH_REMOVALS_OBSERVED" not in warnings:
            warnings.append("HISTORICAL_MATCH_REMOVALS_OBSERVED")
        if revised_count and "HISTORICAL_MATCH_REVISIONS_OBSERVED" not in warnings:
            warnings.append("HISTORICAL_MATCH_REVISIONS_OBSERVED")

    collection_span_hours = (
        (retrieval_times[-1] - retrieval_times[0]).total_seconds() / 3600
        if len(retrieval_times) >= 2
        else 0.0
    )
    duplicate_times = [
        retrieved_at.isoformat()
        for retrieved_at, hashes in sorted(by_retrieved_at.items())
        if len(hashes) > 1
    ]
    reasons: list[str] = []
    if not snapshots:
        reasons.append("NO_ARCHIVED_RETRIEVALS")
    else:
        if inspection.issues:
            reasons.append("ARCHIVE_INTEGRITY_ISSUES_PRESENT")
        if validation_issues:
            reasons.append("SNAPSHOT_IMPORT_ISSUES_PRESENT")
        if duplicate_times:
            reasons.append("CONFLICTING_RETRIEVAL_TIMESTAMPS")
        if len(snapshots) < criteria.minimum_retrievals:
            reasons.append("RETRIEVAL_COUNT_BELOW_MINIMUM")
        if len(first_seen_by_state) < criteria.minimum_unique_states:
            reasons.append("NORMALIZED_STATE_COUNT_BELOW_MINIMUM")
        if collection_span_hours < criteria.minimum_collection_span_days * 24:
            reasons.append("COLLECTION_SPAN_BELOW_MINIMUM")
        if gaps:
            reasons.append("COLLECTION_GAP_ABOVE_MAXIMUM")
        if len(matured_cutoffs) < criteria.minimum_matured_cutoffs:
            reasons.append("MATURED_CUTOFF_COUNT_BELOW_MINIMUM")

    payload = {
        "schema_version": "1",
        "source_id": inspection.source_id,
        "ready_for_historical_backtest": not reasons,
        "blocking_reasons": reasons,
        "criteria": {
            "minimum_retrievals": criteria.minimum_retrievals,
            "minimum_unique_states": criteria.minimum_unique_states,
            "minimum_collection_span_days": criteria.minimum_collection_span_days,
            "maximum_gap_hours": criteria.maximum_gap_hours,
            "outcome_horizon_days": criteria.outcome_horizon_days,
            "minimum_matured_cutoffs": criteria.minimum_matured_cutoffs,
            "require_archive_integrity": True,
            "require_zero_file_import_failures": True,
            "defer_game_issue_scope_to_benchmark_patch": True,
            "allow_known_import_exclusions": True,
            "known_exclusion_codes": sorted(KNOWN_EXCLUSION_CODES),
        },
        "collection": {
            "retrieval_count": len(snapshots),
            "retrieval_timestamp_count": len(retrieval_times),
            "unique_content_count": len(by_hash),
            "validated_content_count": len(valid_hashes),
            "unique_normalized_state_count": len(first_seen_by_state),
            "unchanged_retrieval_count": len(snapshots) - len(by_hash),
            "first_retrieved_at": retrieval_times[0].isoformat() if retrieval_times else None,
            "last_retrieved_at": retrieval_times[-1].isoformat() if retrieval_times else None,
            "collection_span_hours": round(collection_span_hours, 6),
            "matured_cutoff_count": len(matured_cutoffs),
        },
        "content_snapshots": sorted(
            validated.values(), key=lambda item: (item["first_retrieved_at"], item["content_hash"])
        ),
        "matured_cutoffs": matured_cutoffs,
        "revision_ledger": revision_ledger,
        "warnings": warnings,
        "gaps_above_maximum": gaps,
        "conflicting_retrieval_timestamps": duplicate_times,
        "archive_integrity_issues": [issue.to_dict() for issue in inspection.issues],
        "snapshot_import_issues": validation_issues,
        "limitations": [
            "readiness means reproducible public-data backtest input, not statistical power",
            "each content version is imported at its earliest archived retrieval time",
            "known incomplete games and missing team IDs are excluded and counted per snapshot",
            "game-level contract issues are scoped to the selected patch by the benchmark",
            "later distinct normalized state is required to mature an outcome window",
            "a matured outcome state must contain matches observed after its cutoff",
        ],
    }
    return OEHistoryAudit(payload)


def _match_fingerprints(imported: OracleElixirImport) -> dict[str, str]:
    events_by_match = defaultdict(list)
    for event in imported.draft_events:
        events_by_match[event.match_id].append(
            {
                "sequence": event.sequence,
                "team_id": event.team_id,
                "side": event.side.value,
                "action": event.action.value,
                "champion_id": event.champion_id,
                "role": event.role,
                "observed_at": event.observed_at.isoformat(),
            }
        )
    fingerprints = {}
    for match in imported.matches:
        payload = {
            "match_id": match.match_id,
            "series_id": match.series_id,
            "league": match.league,
            "tournament": match.tournament,
            "patch_id": match.patch_id,
            "blue_team_id": match.blue_team_id,
            "red_team_id": match.red_team_id,
            "winner_team_id": match.winner_team_id,
            "observed_at": match.observed_at.isoformat(),
            "events": sorted(events_by_match[match.match_id], key=lambda item: item["sequence"]),
        }
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        fingerprints[match.match_id] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return fingerprints


def _normalized_state_hash(fingerprints: dict[str, str]) -> str:
    encoded = json.dumps(fingerprints, sort_keys=True, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"
