"""Leakage-safe opponent draft tendencies for a coaching-staff prep artifact."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pro_meta_intelligence.leakage import filter_available, reject_future
from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent, Side, require_aware


@dataclass(frozen=True, slots=True)
class OpponentPrepConfig:
    cutoff: datetime
    patch_id: str
    maximum_games_per_team: int = 10
    minimum_games_for_review: int = 3
    top_champions: int = 5

    def __post_init__(self) -> None:
        require_aware(self.cutoff, "cutoff")
        if not self.patch_id.strip():
            raise ValueError("patch_id cannot be blank")
        for field_name in (
            "maximum_games_per_team",
            "minimum_games_for_review",
            "top_champions",
        ):
            if getattr(self, field_name) < 1:
                raise ValueError(f"{field_name} must be positive")


@dataclass(frozen=True, slots=True)
class OpponentPrepReport:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


class OpponentPrepBuilder:
    """Build descriptive team tendencies without inferring intent or private readiness."""

    def build(
        self,
        matches: tuple[MatchRecord, ...],
        draft_events: tuple[PickBanEvent, ...],
        config: OpponentPrepConfig,
    ) -> OpponentPrepReport:
        available_matches = filter_available(matches, config.cutoff)
        available_events = filter_available(draft_events, config.cutoff)
        reject_future(available_matches, config.cutoff)
        reject_future(available_events, config.cutoff)
        target_matches = tuple(
            match for match in available_matches if match.patch_id == config.patch_id
        )
        if not target_matches:
            raise ValueError(f"patch {config.patch_id!r} has no matches available at the cutoff")

        match_by_id = {match.match_id: match for match in target_matches}
        if len(match_by_id) != len(target_matches):
            raise ValueError("match_id values must be unique")
        target_events = tuple(event for event in available_events if event.match_id in match_by_id)
        event_ids = [event.event_id for event in target_events]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("event_id values must be unique")
        events_by_match: dict[str, list[PickBanEvent]] = defaultdict(list)
        for event in target_events:
            match = match_by_id[event.match_id]
            if event.team_id not in {match.blue_team_id, match.red_team_id}:
                raise ValueError(f"event team is not part of its match: {event.event_id}")
            events_by_match[event.match_id].append(event)

        matches_by_team: dict[str, list[MatchRecord]] = defaultdict(list)
        for match in target_matches:
            matches_by_team[match.blue_team_id].append(match)
            matches_by_team[match.red_team_id].append(match)

        teams = [
            self._team_payload(team_id, items, events_by_match, config)
            for team_id, items in matches_by_team.items()
        ]
        teams.sort(
            key=lambda item: (
                "LOW_MATCH_SAMPLE" in item["quality_flags"],
                -item["game_count"],
                item["team_name"].casefold(),
                item["team_id"],
            )
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
        return OpponentPrepReport(
            {
                "schema_version": "1",
                "artifact_type": "opponent-prep-pack",
                "fixture_only": all(
                    "synthetic" in match.provenance.source_type.lower() for match in target_matches
                ),
                "cutoff": config.cutoff.isoformat(),
                "patch_id": config.patch_id,
                "team_count": len(teams),
                "config": {
                    "maximum_games_per_team": config.maximum_games_per_team,
                    "minimum_games_for_review": config.minimum_games_for_review,
                    "top_champions": config.top_champions,
                },
                "boundary": (
                    "Descriptive public match evidence only. Draft intent, scrim plans, player "
                    "readiness, and causal coaching attribution are not inferred."
                ),
                "formulae": {
                    "champion_game_rate": "distinct selected team games / selected team games",
                    "side_win_rate": "wins on side / games on side",
                    "first_pick_rate": "games owning global pick sequence 1 / selected team games",
                    "phase_1": "pick or ban sequence <= 6 within that action type",
                    "phase_2": "pick or ban sequence >= 7 within that action type",
                },
                "evidence_index": {
                    "source_versions": [
                        {
                            "source_id": source_id,
                            "source_version": source_version,
                            "content_hash": content_hash,
                        }
                        for source_id, source_version, content_hash in source_versions
                    ]
                },
                "teams": teams,
            }
        )

    def _team_payload(
        self,
        team_id: str,
        matches: list[MatchRecord],
        events_by_match: dict[str, list[PickBanEvent]],
        config: OpponentPrepConfig,
    ) -> dict[str, Any]:
        selected = tuple(
            sorted(matches, key=lambda match: (match.observed_at, match.match_id), reverse=True)[
                : config.maximum_games_per_team
            ]
        )
        selected_ids = {match.match_id for match in selected}
        selected_events = tuple(
            sorted(
                (event for match_id in selected_ids for event in events_by_match.get(match_id, ())),
                key=lambda event: (
                    event.observed_at,
                    event.match_id,
                    event.action.value,
                    event.sequence,
                ),
            )
        )
        team_events = tuple(event for event in selected_events if event.team_id == team_id)
        opponent_events = tuple(event for event in selected_events if event.team_id != team_id)
        picks = tuple(event for event in team_events if event.action is DraftAction.PICK)
        bans = tuple(event for event in team_events if event.action is DraftAction.BAN)
        received_bans = tuple(event for event in opponent_events if event.action is DraftAction.BAN)
        names = [name for match in selected if (name := _team_name(match, team_id))]
        team_name = names[0] if names else team_id
        name_aliases = sorted(set(names), key=str.casefold)
        quality_flags: list[str] = []
        if len(selected) < config.minimum_games_for_review:
            quality_flags.append("LOW_MATCH_SAMPLE")
        if any(
            len(
                [
                    event
                    for event in events_by_match.get(match.match_id, ())
                    if event.action is DraftAction.BAN
                ]
            )
            < 10
            for match in selected
        ):
            quality_flags.append("INCOMPLETE_BAN_EVIDENCE")
        if not names:
            quality_flags.append("MISSING_TEAM_DISPLAY_NAME")

        side_stats = {
            side.value: self._side_payload(team_id, side, selected)
            for side in (Side.BLUE, Side.RED)
        }
        wins = sum(match.winner_team_id == team_id for match in selected)
        first_pick_count = len({event.match_id for event in picks if event.sequence == 1})
        return {
            "team_id": team_id,
            "team_name": team_name,
            "team_name_aliases": name_aliases,
            "leagues": sorted({match.league for match in selected}),
            "game_count": len(selected),
            "win_count": wins,
            "win_rate": _rate(wins, len(selected)),
            "first_pick_count": first_pick_count,
            "first_pick_rate": _rate(first_pick_count, len(selected)),
            "side_stats": side_stats,
            "priority_picks": _champion_role_tendencies(picks, len(selected), config.top_champions),
            "frequent_bans": _champion_tendencies(bans, len(selected), config.top_champions),
            "received_bans": _champion_tendencies(
                received_bans, len(selected), config.top_champions
            ),
            "first_rotations": _first_rotations(team_id, selected, events_by_match),
            "quality_flags": quality_flags,
            "evidence": {
                "match_ids": sorted(selected_ids),
                "draft_event_ids": [event.event_id for event in selected_events],
                "first_observed_at": min(match.observed_at for match in selected).isoformat(),
                "last_observed_at": max(match.observed_at for match in selected).isoformat(),
            },
        }

    @staticmethod
    def _side_payload(
        team_id: str,
        side: Side,
        matches: tuple[MatchRecord, ...],
    ) -> dict[str, Any]:
        side_matches = tuple(
            match
            for match in matches
            if (match.blue_team_id if side is Side.BLUE else match.red_team_id) == team_id
        )
        wins = sum(match.winner_team_id == team_id for match in side_matches)
        return {
            "game_count": len(side_matches),
            "win_count": wins,
            "win_rate": _rate(wins, len(side_matches)) if side_matches else None,
        }


def _team_name(match: MatchRecord, team_id: str) -> str | None:
    if match.blue_team_id == team_id:
        return match.blue_team_name
    if match.red_team_id == team_id:
        return match.red_team_name
    return None


def _champion_role_tendencies(
    events: tuple[PickBanEvent, ...], game_count: int, limit: int
) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str], list[PickBanEvent]] = defaultdict(list)
    for event in events:
        by_key[(event.champion_id, event.role)].append(event)
    payload = [
        {
            "champion_id": champion_id,
            "role": role,
            "game_count": len({event.match_id for event in items}),
            "game_rate": _rate(len({event.match_id for event in items}), game_count),
            "phase_1_count": sum(event.sequence <= 6 for event in items),
            "phase_2_count": sum(event.sequence >= 7 for event in items),
            "evidence_event_ids": sorted(event.event_id for event in items),
        }
        for (champion_id, role), items in by_key.items()
    ]
    payload.sort(
        key=lambda item: (
            -item["game_count"],
            -item["phase_1_count"],
            item["champion_id"],
            item["role"],
        )
    )
    return payload[:limit]


def _champion_tendencies(
    events: tuple[PickBanEvent, ...], game_count: int, limit: int
) -> list[dict[str, Any]]:
    by_champion: dict[str, list[PickBanEvent]] = defaultdict(list)
    for event in events:
        by_champion[event.champion_id].append(event)
    payload = [
        {
            "champion_id": champion_id,
            "game_count": len({event.match_id for event in items}),
            "game_rate": _rate(len({event.match_id for event in items}), game_count),
            "phase_1_count": sum(event.sequence <= 6 for event in items),
            "phase_2_count": sum(event.sequence >= 7 for event in items),
            "evidence_event_ids": sorted(event.event_id for event in items),
        }
        for champion_id, items in by_champion.items()
    ]
    payload.sort(
        key=lambda item: (-item["game_count"], -item["phase_1_count"], item["champion_id"])
    )
    return payload[:limit]


def _first_rotations(
    team_id: str,
    matches: tuple[MatchRecord, ...],
    events_by_match: dict[str, list[PickBanEvent]],
) -> list[dict[str, Any]]:
    rotations: dict[tuple[str, tuple[str, ...]], list[str]] = defaultdict(list)
    for match in matches:
        side = Side.BLUE if match.blue_team_id == team_id else Side.RED
        champions = tuple(
            event.champion_id
            for event in sorted(
                events_by_match.get(match.match_id, ()), key=lambda item: item.sequence
            )
            if event.team_id == team_id and event.action is DraftAction.PICK and event.sequence <= 6
        )
        if champions:
            rotations[(side.value, champions)].append(match.match_id)
    payload = [
        {
            "side": side,
            "champions": list(champions),
            "game_count": len(match_ids),
            "evidence_match_ids": sorted(match_ids),
        }
        for (side, champions), match_ids in rotations.items()
    ]
    payload.sort(key=lambda item: (-item["game_count"], item["side"], item["champions"]))
    return payload[:5]


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 6) if denominator else 0.0
