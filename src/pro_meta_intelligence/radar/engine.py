"""Leakage-safe and formula-first patch Meta Radar aggregation."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from pro_meta_intelligence.leakage import filter_available, reject_future
from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent
from pro_meta_intelligence.radar.models import (
    LeagueRegionMap,
    MetaRadarConfig,
    MetaRadarEntry,
    MetaRadarReport,
    RegionPresence,
)

CandidateKey = tuple[str, str]


@dataclass(frozen=True, slots=True)
class _WindowData:
    matches: tuple[MatchRecord, ...]
    events: tuple[PickBanEvent, ...]
    active_team_ids: frozenset[str]


class MetaRadar:
    """Build a patch-level report without a learned or arbitrary composite score."""

    def build(
        self,
        matches: tuple[MatchRecord, ...],
        draft_events: tuple[PickBanEvent, ...],
        config: MetaRadarConfig,
        league_regions: LeagueRegionMap,
    ) -> MetaRadarReport:
        self._validate_unique_ids(matches, draft_events)
        available_matches = filter_available(matches, config.cutoff)
        available_events = filter_available(draft_events, config.cutoff)
        reject_future(available_matches, config.cutoff)
        reject_future(available_events, config.cutoff)
        if not available_matches:
            raise ValueError("no matches are available at the radar cutoff")

        available_match_by_id = {match.match_id: match for match in available_matches}
        for event in available_events:
            match = available_match_by_id.get(event.match_id)
            if match is None:
                raise ValueError(f"available event has no available match: {event.event_id}")
            if event.observed_at != match.observed_at:
                raise ValueError(f"event/match observed_at mismatch: {event.event_id}")
            if event.team_id not in {match.blue_team_id, match.red_team_id}:
                raise ValueError(f"event team is not part of its match: {event.event_id}")

        patch_id = (
            config.patch_id
            or max(
                available_matches,
                key=lambda match: (match.observed_at, match.match_id),
            ).patch_id
        )
        if not any(match.patch_id == patch_id for match in available_matches):
            raise ValueError(f"patch {patch_id!r} has no matches available at the cutoff")

        recent_start = config.cutoff - timedelta(days=config.recent_window_days)
        prior_start = recent_start - timedelta(days=config.prior_window_days)
        target_matches = tuple(
            match
            for match in available_matches
            if match.patch_id == patch_id and prior_start < match.observed_at <= config.cutoff
        )
        target_match_ids = {match.match_id for match in target_matches}
        target_picks = tuple(
            event
            for event in available_events
            if event.action is DraftAction.PICK and event.match_id in target_match_ids
        )
        recent = self._window(
            target_matches,
            target_picks,
            start=recent_start,
            end=config.cutoff,
        )
        prior = self._window(
            target_matches,
            target_picks,
            start=prior_start,
            end=recent_start,
        )
        entries = self._entries(recent, prior, config, league_regions)
        ranked = tuple(sorted(entries, key=self._ranking_key))

        unknown_leagues = sorted(
            {
                match.league
                for match in target_matches
                if league_regions.region_for(match.league) is None
            }
        )
        source_versions = sorted(
            {
                (
                    match.provenance.source_id,
                    match.provenance.source_version,
                    match.provenance.content_hash,
                )
                for match in target_matches
            }
        )
        payload = {
            "schema_version": "1",
            "fixture_only": all(
                "synthetic" in match.provenance.source_type.lower() for match in target_matches
            )
            if target_matches
            else False,
            "cutoff": config.cutoff.isoformat(),
            "patch_id": patch_id,
            "windows": {
                "prior": {
                    "start_exclusive": prior_start.isoformat(),
                    "end_inclusive": recent_start.isoformat(),
                    "days": config.prior_window_days,
                    "match_count": len(prior.matches),
                    "active_team_count": len(prior.active_team_ids),
                },
                "recent": {
                    "start_exclusive": recent_start.isoformat(),
                    "end_inclusive": config.cutoff.isoformat(),
                    "days": config.recent_window_days,
                    "match_count": len(recent.matches),
                    "active_team_count": len(recent.active_team_ids),
                },
            },
            "thresholds": {
                "minimum_recent_matches": config.minimum_recent_matches,
                "minimum_prior_matches": config.minimum_prior_matches,
                "minimum_region_matches": config.minimum_region_matches,
                "minimum_current_picks": config.minimum_current_picks,
            },
            "league_regions": league_regions.to_dict(),
            "quality": {
                "unknown_leagues": unknown_leagues,
                "future_match_count_excluded": len(matches) - len(available_matches),
                "future_event_count_excluded": len(draft_events) - len(available_events),
                "available_other_patch_or_window_match_count_excluded": (
                    len(available_matches) - len(target_matches)
                ),
            },
            "formulae": {
                "pick_presence": "unique matches containing champion-role pick / window matches",
                "pick_presence_delta": "recent pick presence - prior pick presence",
                "demand": "distinct teams picking champion-role / active teams in window",
                "demand_velocity": "recent demand - prior demand",
                "team_concentration": (
                    "largest team champion-role pick count / all recent champion-role picks"
                ),
                "regional_divergence": (
                    "max(abs(eligible-region pick presence - global pick presence))"
                ),
            },
            "ranking_policy": [
                "eligible_for_review first",
                "demand_velocity descending",
                "pick_presence_delta descending",
                "regional_divergence descending",
                "current_pick_presence descending",
                "champion_id and role ascending for deterministic ties",
            ],
            "evidence_index": {
                "prior_match_ids": sorted(match.match_id for match in prior.matches),
                "recent_match_ids": sorted(match.match_id for match in recent.matches),
                "source_versions": [
                    {
                        "source_id": source_id,
                        "source_version": source_version,
                        "content_hash": content_hash,
                    }
                    for source_id, source_version, content_hash in source_versions
                ],
            },
            "entries": [entry.to_dict(rank) for rank, entry in enumerate(ranked, start=1)],
        }
        return MetaRadarReport(payload)

    @staticmethod
    def _window(
        matches: tuple[MatchRecord, ...],
        events: tuple[PickBanEvent, ...],
        *,
        start: datetime,
        end: datetime,
    ) -> _WindowData:
        window_matches = tuple(match for match in matches if start < match.observed_at <= end)
        match_ids = {match.match_id for match in window_matches}
        window_events = tuple(event for event in events if event.match_id in match_ids)
        active_teams = frozenset(
            team_id
            for match in window_matches
            for team_id in (match.blue_team_id, match.red_team_id)
        )
        return _WindowData(window_matches, window_events, active_teams)

    def _entries(
        self,
        recent: _WindowData,
        prior: _WindowData,
        config: MetaRadarConfig,
        league_regions: LeagueRegionMap,
    ) -> tuple[MetaRadarEntry, ...]:
        recent_by_key = self._events_by_key(recent.events)
        prior_by_key = self._events_by_key(prior.events)
        keys = sorted(set(recent_by_key) | set(prior_by_key))
        recent_matches_by_id = {match.match_id: match for match in recent.matches}
        region_match_ids: dict[str, set[str]] = defaultdict(set)
        for match in recent.matches:
            region = league_regions.region_for(match.league)
            if region is not None:
                region_match_ids[region].add(match.match_id)

        entries: list[MetaRadarEntry] = []
        for champion_id, role in keys:
            key = (champion_id, role)
            current_events = recent_by_key.get(key, ())
            prior_events = prior_by_key.get(key, ())
            current_match_ids = {event.match_id for event in current_events}
            prior_match_ids = {event.match_id for event in prior_events}
            current_teams = {event.team_id for event in current_events}
            prior_teams = {event.team_id for event in prior_events}
            current_presence = _rate(len(current_match_ids), len(recent.matches))
            prior_presence = _rate(len(prior_match_ids), len(prior.matches))
            current_demand = _rate(len(current_teams), len(recent.active_team_ids))
            prior_demand = _rate(len(prior_teams), len(prior.active_team_ids))

            team_counts = Counter((event.team_id, event.match_id) for event in current_events)
            picks_by_team = Counter(team_id for team_id, _ in team_counts)
            concentration = (
                max(picks_by_team.values()) / len(current_match_ids) if current_match_ids else None
            )

            regions: list[RegionPresence] = []
            for region, match_ids in sorted(region_match_ids.items()):
                region_pick_count = len(current_match_ids & match_ids)
                presence = _rate(region_pick_count, len(match_ids))
                regions.append(
                    RegionPresence(
                        region=region,
                        match_count=len(match_ids),
                        pick_count=region_pick_count,
                        pick_presence=presence,
                        delta_from_global=presence - current_presence,
                        sample_eligible=len(match_ids) >= config.minimum_region_matches,
                    )
                )
            eligible_regions = [region for region in regions if region.sample_eligible]
            most_divergent = (
                sorted(
                    eligible_regions,
                    key=lambda item: (
                        -abs(item.delta_from_global),
                        -item.delta_from_global,
                        item.region,
                    ),
                )[0]
                if eligible_regions
                else None
            )

            flags: list[str] = []
            if len(recent.matches) < config.minimum_recent_matches:
                flags.append("INSUFFICIENT_RECENT_MATCHES")
            if len(prior.matches) < config.minimum_prior_matches:
                flags.append("INSUFFICIENT_PRIOR_MATCHES")
            if len(current_match_ids) < config.minimum_current_picks:
                flags.append("LOW_CURRENT_PICK_COUNT")
            if not eligible_regions:
                flags.append("INSUFFICIENT_REGIONAL_SAMPLES")
            if any(
                league_regions.region_for(recent_matches_by_id[event.match_id].league) is None
                for event in current_events
            ):
                flags.append("UNMAPPED_LEAGUE_EVIDENCE")
            critical = {
                "INSUFFICIENT_RECENT_MATCHES",
                "INSUFFICIENT_PRIOR_MATCHES",
                "LOW_CURRENT_PICK_COUNT",
            }
            entries.append(
                MetaRadarEntry(
                    champion_id=champion_id,
                    role=role,
                    current_pick_count=len(current_match_ids),
                    prior_pick_count=len(prior_match_ids),
                    current_pick_presence=current_presence,
                    prior_pick_presence=prior_presence,
                    pick_presence_delta=current_presence - prior_presence,
                    current_distinct_team_count=len(current_teams),
                    prior_distinct_team_count=len(prior_teams),
                    current_demand=current_demand,
                    prior_demand=prior_demand,
                    demand_velocity=current_demand - prior_demand,
                    team_concentration=concentration,
                    regional_divergence=(
                        abs(most_divergent.delta_from_global) if most_divergent else None
                    ),
                    most_divergent_region=most_divergent.region if most_divergent else None,
                    most_divergent_region_delta=(
                        most_divergent.delta_from_global if most_divergent else None
                    ),
                    region_presence=tuple(regions),
                    eligible_for_review=not any(flag in critical for flag in flags),
                    quality_flags=tuple(flags),
                    evidence_event_ids=tuple(
                        sorted(event.event_id for event in (*prior_events, *current_events))
                    ),
                )
            )
        return tuple(entries)

    @staticmethod
    def _events_by_key(
        events: tuple[PickBanEvent, ...],
    ) -> dict[CandidateKey, tuple[PickBanEvent, ...]]:
        grouped: dict[CandidateKey, list[PickBanEvent]] = defaultdict(list)
        for event in events:
            grouped[(event.champion_id, event.role)].append(event)
        result: dict[CandidateKey, tuple[PickBanEvent, ...]] = {}
        for key, values in grouped.items():
            match_ids = [event.match_id for event in values]
            if len(match_ids) != len(set(match_ids)):
                raise ValueError(
                    f"a champion-role can appear at most once per match: {key[0]} {key[1]}"
                )
            result[key] = tuple(
                sorted(values, key=lambda event: (event.observed_at, event.event_id))
            )
        return result

    @staticmethod
    def _ranking_key(entry: MetaRadarEntry) -> tuple[object, ...]:
        return (
            not entry.eligible_for_review,
            -entry.demand_velocity,
            -entry.pick_presence_delta,
            -(entry.regional_divergence if entry.regional_divergence is not None else -1.0),
            -entry.current_pick_presence,
            entry.champion_id,
            entry.role,
        )

    @staticmethod
    def _validate_unique_ids(
        matches: tuple[MatchRecord, ...], events: tuple[PickBanEvent, ...]
    ) -> None:
        match_ids = [match.match_id for match in matches]
        if len(match_ids) != len(set(match_ids)):
            raise ValueError("match_id values must be unique")
        event_ids = [event.event_id for event in events]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("event_id values must be unique")


def _rate(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0
