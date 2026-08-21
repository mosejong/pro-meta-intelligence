"""Transparent Phase 1 baselines. Every score is directly derived from named features."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from pro_meta_intelligence.baselines.base import HistoricalSnapshot, rank_signals
from pro_meta_intelligence.models import (
    CandidateSignal,
    PatchChangeKind,
    PickBanEvent,
    PlayerChampionUsage,
    SignalComponent,
)


class RecentProPresenceChange:
    name = "recent_pro_presence_change"
    formula = "recent_presence_per_match - prior_presence_per_match"

    def __init__(self, window_days: int = 7) -> None:
        if window_days < 1:
            raise ValueError("window_days must be positive")
        self.window_days = window_days

    def rank(self, snapshot: HistoricalSnapshot) -> tuple[CandidateSignal, ...]:
        if not snapshot.matches:
            return ()
        cutoff = snapshot.cutoff
        recent_start = cutoff - timedelta(days=self.window_days)
        prior_start = recent_start - timedelta(days=self.window_days)
        recent_matches = {
            match.match_id
            for match in snapshot.matches
            if recent_start < match.observed_at <= cutoff
        }
        prior_matches = {
            match.match_id
            for match in snapshot.matches
            if prior_start < match.observed_at <= recent_start
        }
        if not recent_matches or not prior_matches:
            return ()

        recent: dict[tuple[str, str], set[str]] = defaultdict(set)
        prior: dict[tuple[str, str], set[str]] = defaultdict(set)
        evidence: dict[tuple[str, str], list[PickBanEvent]] = defaultdict(list)
        for event in snapshot.draft_events:
            key = (event.champion_id, event.role)
            if event.match_id in recent_matches:
                recent[key].add(event.match_id)
                evidence[key].append(event)
            elif event.match_id in prior_matches:
                prior[key].add(event.match_id)
                evidence[key].append(event)

        signals: list[CandidateSignal] = []
        for champion_id, role in sorted(set(recent) | set(prior)):
            key = (champion_id, role)
            recent_rate = len(recent[key]) / len(recent_matches)
            prior_rate = len(prior[key]) / len(prior_matches)
            delta = recent_rate - prior_rate
            if delta <= 0:
                continue
            records = evidence[key]
            signals.append(
                CandidateSignal(
                    champion_id=champion_id,
                    role=role,
                    baseline=self.name,
                    score=delta,
                    formula=self.formula,
                    explanation=(
                        f"Presence rose from {prior_rate:.3f} to {recent_rate:.3f} "
                        f"per match across adjacent {self.window_days}-day windows."
                    ),
                    components=(
                        SignalComponent("prior_presence_per_match", prior_rate),
                        SignalComponent("recent_presence_per_match", recent_rate),
                        SignalComponent("delta", delta),
                    ),
                    evidence_ids=tuple(sorted(record.event_id for record in records)),
                    observed_at=max(record.observed_at for record in records),
                    available_at=max(record.available_at for record in records),
                )
            )
        return rank_signals(signals)


class HighEloUsageChange:
    name = "high_elo_usage_change"
    formula = "current_pick_count/current_game_count - prior_pick_count/prior_game_count"

    def rank(self, snapshot: HistoricalSnapshot) -> tuple[CandidateSignal, ...]:
        grouped: dict[tuple[str, str], list[PlayerChampionUsage]] = defaultdict(list)
        for usage in snapshot.solo_queue_usage:
            grouped[(usage.champion_id, usage.role)].append(usage)

        signals: list[CandidateSignal] = []
        for (champion_id, role), records in sorted(grouped.items()):
            ordered = sorted(records, key=lambda item: (item.window_end, item.usage_id))
            if len(ordered) < 2:
                continue
            prior, current = ordered[-2:]
            delta = current.usage_rate - prior.usage_rate
            if delta <= 0:
                continue
            signals.append(
                CandidateSignal(
                    champion_id=champion_id,
                    role=role,
                    baseline=self.name,
                    score=delta,
                    formula=self.formula,
                    explanation=(
                        f"High-Elo usage rose from {prior.usage_rate:.3f} to "
                        f"{current.usage_rate:.3f} across consecutive fixture windows."
                    ),
                    components=(
                        SignalComponent("prior_usage_rate", prior.usage_rate),
                        SignalComponent("current_usage_rate", current.usage_rate),
                        SignalComponent("delta", delta),
                    ),
                    evidence_ids=(prior.usage_id, current.usage_id),
                    observed_at=current.observed_at,
                    available_at=current.available_at,
                )
            )
        return rank_signals(signals)


class PatchBuffHeuristic:
    name = "patch_buff_heuristic"
    formula = "1 if latest available patch contains a direct champion buff, otherwise 0"

    def rank(self, snapshot: HistoricalSnapshot) -> tuple[CandidateSignal, ...]:
        if not snapshot.patches:
            return ()
        patch = max(snapshot.patches, key=lambda item: (item.observed_at, item.patch_id))
        signals: list[CandidateSignal] = []
        for change in patch.changes:
            if change.kind is not PatchChangeKind.BUFF:
                continue
            signals.append(
                CandidateSignal(
                    champion_id=change.champion_id,
                    role=change.role,
                    baseline=self.name,
                    score=1.0,
                    formula=self.formula,
                    explanation=f"Direct buff in patch {patch.patch_id}: {change.reason}",
                    components=(SignalComponent("direct_buff", 1.0),),
                    evidence_ids=(patch.provenance.source_id,),
                    observed_at=patch.observed_at,
                    available_at=patch.available_at,
                )
            )
        return rank_signals(signals)
