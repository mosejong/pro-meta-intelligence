"""Walk-forward check of draft scouting packs against the drafts that actually followed.

Each event series is scouted with only games public before its first game, then every game
in the series is scored. Bulk files carry one retrieval time for every row, so availability is
simulated as `observed_at + publication_delay` (the provider publishes once per day). Champions
picked earlier in the same series are removed from every predicted set (Fearless locks).
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Any

from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent
from pro_meta_intelligence.opponent.draft_scout import (
    INTERNATIONAL,
    PHASE_ONE_LAST_SEQUENCE,
    DraftScoutBuilder,
    DraftScoutConfig,
)
from pro_meta_intelligence.radar.models import LeagueRegionMap

SERIES_GAP = timedelta(hours=12)
METRICS = (
    "expected_phase_one_bans",
    "season_ban_habit",
    "expected_picks",
    "player_pool_picks",
    "role_meta_picks",
    "international_meta_picks",
    "deny_hits_real_pick",
)


@dataclass(frozen=True, slots=True)
class DraftScoutBacktestConfig:
    league: str
    target_teams: dict[str, str]
    own_team_name: str = "T1"
    publication_delay: timedelta = timedelta(hours=24)
    maximum_games_per_team: int = 40


@dataclass(frozen=True, slots=True)
class DraftScoutBacktestReport:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


def backtest_draft_scout(
    matches: tuple[MatchRecord, ...],
    draft_events: tuple[PickBanEvent, ...],
    regions: LeagueRegionMap,
    config: DraftScoutBacktestConfig,
) -> DraftScoutBacktestReport:
    delay = config.publication_delay
    matches = tuple(replace(match, available_at=match.observed_at + delay) for match in matches)
    draft_events = tuple(
        replace(event, available_at=event.observed_at + delay) for event in draft_events
    )
    events_by_match: dict[str, list[PickBanEvent]] = defaultdict(list)
    for event in draft_events:
        events_by_match[event.match_id].append(event)

    totals: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    skipped = []
    for code, team_name in config.target_teams.items():
        event_games = [
            match
            for match in matches
            if match.league == config.league and _side_team_id(match, team_name)
        ]
        for series in _series(event_games):
            cutoff = series[0].observed_at - timedelta(minutes=1)
            try:
                pack = (
                    DraftScoutBuilder()
                    .build(
                        matches,
                        draft_events,
                        regions,
                        DraftScoutConfig(
                            cutoff=cutoff,
                            target_team_name=team_name,
                            own_team_name=config.own_team_name,
                            maximum_games_per_team=config.maximum_games_per_team,
                        ),
                    )
                    .to_dict()
                )
            except ValueError:
                skipped.append({"team": code, "series_start": series[0].observed_at.isoformat()})
                continue
            _score_series(pack, series, team_name, events_by_match, totals[code])

    overall: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for counts in totals.values():
        for metric, (hit, total) in counts.items():
            overall[metric][0] += hit
            overall[metric][1] += total
    return DraftScoutBacktestReport(
        {
            "schema_version": "1",
            "artifact_type": "draft-scout-backtest",
            "league": config.league,
            "own_team_name": config.own_team_name,
            "publication_delay_hours": delay.total_seconds() / 3600,
            "game_count": overall["deny_hits_real_pick"][1],
            "overall": _summary(overall),
            "teams": {code: _summary(counts) for code, counts in sorted(totals.items())},
            "skipped_series": skipped,
            "boundary": (
                "Hit rates of descriptive scouting sets against later public drafts. Availability "
                "is simulated from the provider's daily publication; not a win-probability claim."
            ),
        }
    )


def _score_series(
    pack: dict[str, Any],
    series: list[MatchRecord],
    team_name: str,
    events_by_match: dict[str, list[PickBanEvent]],
    totals: dict[str, list[int]],
) -> None:
    levers = pack["levers"]
    size = pack["config"]["top_champions"]
    expected = [item["champion_id"] for item in levers["expected_phase_one_bans"]]
    habit = [item["champion_id"] for item in pack["target"]["phase_one_bans"]]
    pools = {
        pool["role"]: [item["champion_id"] for item in pool["champions"]]
        for pool in pack["target"]["player_pools"]
    }
    expected_picks = {
        group["role"]: [item["champion_id"] for item in group["champions"]]
        for group in levers["expected_picks"]
    }
    role_meta = {
        role: [item["champion_id"] for item in items]
        for group in pack["league_meta"]
        if group["group"] == INTERNATIONAL
        for role, items in group["role_picks"].items()
    }
    deny = [item["champion_id"] for item in levers["deny_comfort"]]
    meta = [
        item["champion_id"]
        for group in pack["league_meta"]
        if group["group"] == INTERNATIONAL
        for item in group["presence"]
    ]
    locked: set[str] = set()
    for game in series:
        team_id = _side_team_id(game, team_name)
        events = events_by_match.get(game.match_id, [])
        mine = [event for event in events if event.team_id == team_id]
        bans = [
            event.champion_id
            for event in mine
            if event.action is DraftAction.BAN and event.sequence <= PHASE_ONE_LAST_SEQUENCE
        ]
        picks = [
            (event.champion_id, event.role) for event in mine if event.action is DraftAction.PICK
        ]

        def open_(champions: list[str]) -> list[str]:
            return [champion for champion in champions if champion not in locked]

        pool_size = sum(len(open_(champions)) for champions in pools.values())
        scores = {
            "expected_phase_one_bans": (_hits(bans, open_(expected)[:size]), len(bans)),
            "season_ban_habit": (_hits(bans, open_(habit)[:size]), len(bans)),
            "expected_picks": (
                sum(
                    champion in open_(expected_picks.get(role, []))[:size]
                    for champion, role in picks
                ),
                len(picks),
            ),
            "role_meta_picks": (
                sum(champion in open_(role_meta.get(role, []))[:size] for champion, role in picks),
                len(picks),
            ),
            "player_pool_picks": (
                sum(champion in open_(pools.get(role, [])) for champion, role in picks),
                len(picks),
            ),
            "international_meta_picks": (
                _hits([champion for champion, _ in picks], open_(meta)[:pool_size]),
                len(picks),
            ),
            "deny_hits_real_pick": (
                int(any(champion in open_(deny) for champion, _ in picks)),
                1,
            ),
        }
        for metric, (hit, total) in scores.items():
            totals[metric][0] += hit
            totals[metric][1] += total
        locked.update(event.champion_id for event in events if event.action is DraftAction.PICK)


def _hits(actual: list[str], predicted: list[str]) -> int:
    chosen = set(predicted)
    return sum(champion in chosen for champion in actual)


def _summary(counts: dict[str, list[int]]) -> dict[str, dict[str, Any]]:
    return {
        metric: {
            "hit": counts[metric][0],
            "of": counts[metric][1],
            "rate": round(counts[metric][0] / counts[metric][1], 3) if counts[metric][1] else None,
        }
        for metric in METRICS
    }


def _side_team_id(match: MatchRecord, team_name: str) -> str | None:
    if match.blue_team_name == team_name:
        return match.blue_team_id
    if match.red_team_name == team_name:
        return match.red_team_id
    return None


def _series(games: list[MatchRecord]) -> list[list[MatchRecord]]:
    series: list[list[MatchRecord]] = []
    for game in sorted(games, key=lambda match: match.observed_at):
        if series and game.observed_at - series[-1][-1].observed_at <= SERIES_GAP:
            series[-1].append(game)
        else:
            series.append([game])
    return series
