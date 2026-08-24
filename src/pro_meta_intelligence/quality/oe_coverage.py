"""Explicit annual Oracle's Elixir coverage checks with no composite score."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirImport
from pro_meta_intelligence.models import DraftAction
from pro_meta_intelligence.radar import LeagueRegionMap

KNOWN_EXCLUSION_CODES = frozenset({"INCOMPLETE_GAME", "MISSING_TEAM_ID"})
BLOCKING_ISSUE_DISPOSITION = "BLOCKING_CONTRACT_ISSUE"
KNOWN_EXCLUSION_DISPOSITION = "KNOWN_EXCLUSION"


@dataclass(frozen=True, slots=True)
class OECoverageCriteria:
    minimum_matches: int = 20
    minimum_distinct_teams: int = 8
    minimum_regions: int = 2
    patch_id: str | None = None

    def __post_init__(self) -> None:
        for field_name in ("minimum_matches", "minimum_distinct_teams", "minimum_regions"):
            if getattr(self, field_name) < 1:
                raise ValueError(f"{field_name} must be positive")
        if self.patch_id is not None and not self.patch_id.strip():
            raise ValueError("patch_id cannot be blank")


@dataclass(frozen=True, slots=True)
class OECoverageAudit:
    payload: dict[str, Any]

    @property
    def ready_for_radar(self) -> bool:
        return bool(self.payload["ready_for_radar"])

    def to_dict(self) -> dict[str, Any]:
        return self.payload


def audit_oe_coverage(
    imported: OracleElixirImport,
    league_regions: LeagueRegionMap,
    criteria: OECoverageCriteria,
) -> OECoverageAudit:
    """Measure annual and per-patch coverage, then evaluate the selected patch gates."""

    matches = imported.matches
    events_by_match: Counter[str] = Counter(
        event.match_id for event in imported.draft_events if event.action is DraftAction.PICK
    )
    patch_matches = defaultdict(list)
    for match in matches:
        patch_matches[match.patch_id].append(match)

    selected_patch_id = criteria.patch_id
    if selected_patch_id is None and matches:
        latest_match = max(matches, key=lambda item: (item.observed_at, item.match_id))
        selected_patch_id = latest_match.patch_id

    patches = []
    selected: dict[str, Any] | None = None
    for patch_id, items in sorted(patch_matches.items(), key=lambda item: item[0]):
        leagues = sorted({match.league for match in items})
        unknown_leagues = sorted(
            league for league in leagues if league_regions.region_for(league) is None
        )
        regions = sorted(
            {
                region
                for league in leagues
                if (region := league_regions.region_for(league)) is not None
            }
        )
        patch = {
            "patch_id": patch_id,
            "match_count": len(items),
            "pick_event_count": sum(events_by_match[match.match_id] for match in items),
            "league_count": len(leagues),
            "region_count": len(regions),
            "distinct_team_count": len(
                {team for match in items for team in (match.blue_team_id, match.red_team_id)}
            ),
            "first_observed_at": min(match.observed_at for match in items).isoformat(),
            "last_observed_at": max(match.observed_at for match in items).isoformat(),
            "leagues": leagues,
            "regions": regions,
            "unknown_leagues": unknown_leagues,
        }
        patches.append(patch)
        if patch_id == selected_patch_id:
            selected = patch

    issue_context = [
        {
            "patch_id": patch_id,
            "league": league,
            "code": code,
            "count": count,
            "disposition": _issue_disposition(code),
        }
        for patch_id, league, code, count in imported.report.issue_context_counts
    ]
    selected_issue_context = [
        item for item in issue_context if item["patch_id"] == selected_patch_id
    ]
    selected_issue_counts = _sum_issue_counts(selected_issue_context)
    selected_known_exclusion_count = sum(
        item["count"]
        for item in selected_issue_context
        if item["disposition"] == KNOWN_EXCLUSION_DISPOSITION
    )
    selected_blocking_issue_count = sum(
        item["count"]
        for item in selected_issue_context
        if item["disposition"] == BLOCKING_ISSUE_DISPOSITION
    )
    unattributed_blocking_issue_count = sum(
        item["count"]
        for item in issue_context
        if item["patch_id"] is None and item["disposition"] == BLOCKING_ISSUE_DISPOSITION
    )
    annual_known_exclusion_count = sum(
        item["count"]
        for item in issue_context
        if item["disposition"] == KNOWN_EXCLUSION_DISPOSITION
    )
    annual_blocking_issue_count = sum(
        item["count"] for item in issue_context if item["disposition"] == BLOCKING_ISSUE_DISPOSITION
    )

    reasons: list[str] = []
    warnings: list[str] = []
    if not matches:
        reasons.append("NO_IMPORTED_MATCHES")
    elif selected is None:
        reasons.append("SELECTED_PATCH_NOT_FOUND")
    else:
        if selected["match_count"] < criteria.minimum_matches:
            reasons.append("PATCH_MATCH_COUNT_BELOW_MINIMUM")
        if selected["distinct_team_count"] < criteria.minimum_distinct_teams:
            reasons.append("PATCH_DISTINCT_TEAM_COUNT_BELOW_MINIMUM")
        if selected["region_count"] < criteria.minimum_regions:
            reasons.append("PATCH_REGION_COUNT_BELOW_MINIMUM")
        if selected["unknown_leagues"]:
            reasons.append("PATCH_HAS_UNKNOWN_LEAGUES")
    if selected_blocking_issue_count:
        reasons.append("PATCH_HAS_BLOCKING_IMPORT_ISSUES")
    if unattributed_blocking_issue_count:
        reasons.append("UNATTRIBUTED_BLOCKING_IMPORT_ISSUES")
    if selected_known_exclusion_count:
        warnings.append("PATCH_HAS_KNOWN_IMPORT_EXCLUSIONS")
    if annual_blocking_issue_count > selected_blocking_issue_count:
        warnings.append("ANNUAL_BLOCKING_IMPORT_ISSUES_OUTSIDE_SELECTED_PATCH")
    if annual_known_exclusion_count > selected_known_exclusion_count:
        warnings.append("ANNUAL_KNOWN_IMPORT_EXCLUSIONS_OUTSIDE_SELECTED_PATCH")

    selected_import_quality = None
    if selected is not None:
        selected_import_quality = {
            "patch_id": selected_patch_id,
            "imported_game_count": selected["match_count"],
            "known_exclusion_game_count": selected_known_exclusion_count,
            "blocking_issue_game_count": selected_blocking_issue_count,
            "discovered_game_count": (
                selected["match_count"]
                + selected_known_exclusion_count
                + selected_blocking_issue_count
            ),
            "issue_counts": selected_issue_counts,
            "issue_context": selected_issue_context,
        }

    payload = {
        "schema_version": "2",
        "source_id": "oracles-elixir-match-data",
        "source_version": imported.report.source_version,
        "retrieved_at": imported.report.retrieved_at.isoformat(),
        "annual_coverage": {
            "discovered_game_count": imported.report.discovered_game_count,
            "imported_game_count": imported.report.imported_game_count,
            "rejected_game_count": imported.report.rejected_game_count,
            "known_exclusion_game_count": annual_known_exclusion_count,
            "blocking_issue_game_count": annual_blocking_issue_count,
            "issue_counts": dict(imported.report.issue_counts),
            "patch_count": len(patches),
            "league_count": len({match.league for match in matches}),
            "first_observed_at": (
                min(match.observed_at for match in matches).isoformat() if matches else None
            ),
            "last_observed_at": (
                max(match.observed_at for match in matches).isoformat() if matches else None
            ),
        },
        "patches": patches,
        "selected_patch_id": selected_patch_id,
        "selected_patch": selected,
        "selected_patch_import_quality": selected_import_quality,
        "issue_policy": {
            "known_exclusion_codes": sorted(KNOWN_EXCLUSION_CODES),
            "default_disposition": BLOCKING_ISSUE_DISPOSITION,
            "scope": "SELECTED_PATCH_AND_UNATTRIBUTED_BLOCKING_ISSUES",
        },
        "criteria": {
            "minimum_matches": criteria.minimum_matches,
            "minimum_distinct_teams": criteria.minimum_distinct_teams,
            "minimum_regions": criteria.minimum_regions,
            "require_zero_rejected_games": False,
            "require_zero_selected_patch_blocking_import_issues": True,
            "allow_known_exclusions_when_remaining_coverage_passes": True,
            "require_all_leagues_mapped": True,
        },
        "ready_for_radar": not reasons,
        "blocking_reasons": reasons,
        "warnings": warnings,
    }
    return OECoverageAudit(payload)


def _issue_disposition(code: str) -> str:
    if code in KNOWN_EXCLUSION_CODES:
        return KNOWN_EXCLUSION_DISPOSITION
    return BLOCKING_ISSUE_DISPOSITION


def _sum_issue_counts(context: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for item in context:
        counts[str(item["code"])] += int(item["count"])
    return dict(sorted(counts.items()))
