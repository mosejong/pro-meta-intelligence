"""Season-wide head-to-head draft scouting: where an opponent's ban/pick plan can be beaten.

Everything here is a count over public pro games available at the cutoff. Levers are
deterministic, descriptive rules (comfort, overlap, bans spent) for coaching review; they are
never win probabilities and never a claim about the opponent's private preparation.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pro_meta_intelligence.leakage import filter_available, reject_future
from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent, require_aware
from pro_meta_intelligence.radar.models import LeagueRegionMap

PHASE_ONE_LAST_SEQUENCE = 6
FIRST_ROTATION_LAST_SEQUENCE = 3
LAST_PICK_SEQUENCE = 10
ROLES = ("TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT")
INTERNATIONAL = "INTERNATIONAL"
# Worlds walk-forward checks: ranking each player's pool with a quarter weight on the current
# international role meta, and refilling the list after Fearless locks, beat the raw pool.
EXPECTED_PICK_PLAYER_WEIGHT = 0.75
EXPECTED_PICK_LIMIT = 15
ROLE_META_LIMIT = 20


@dataclass(frozen=True, slots=True)
class DraftScoutConfig:
    cutoff: datetime
    target_team_name: str
    own_team_name: str = "T1"
    maximum_games_per_team: int = 40
    top_champions: int = 6
    meta_patches_per_region: int = 2
    minimum_comfort_games: int = 3

    def __post_init__(self) -> None:
        require_aware(self.cutoff, "cutoff")
        if not self.target_team_name.strip() or not self.own_team_name.strip():
            raise ValueError("team names cannot be blank")
        if self.target_team_name.casefold() == self.own_team_name.casefold():
            raise ValueError("target and own team must differ")
        for field_name in (
            "maximum_games_per_team",
            "top_champions",
            "meta_patches_per_region",
            "minimum_comfort_games",
        ):
            if getattr(self, field_name) < 1:
                raise ValueError(f"{field_name} must be positive")


@dataclass(frozen=True, slots=True)
class DraftScoutReport:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


class DraftScoutBuilder:
    def build(
        self,
        matches: tuple[MatchRecord, ...],
        draft_events: tuple[PickBanEvent, ...],
        regions: LeagueRegionMap,
        config: DraftScoutConfig,
    ) -> DraftScoutReport:
        available_matches = reject_future(filter_available(matches, config.cutoff), config.cutoff)
        available_events = reject_future(
            filter_available(draft_events, config.cutoff), config.cutoff
        )
        events_by_match: dict[str, list[PickBanEvent]] = defaultdict(list)
        for event in available_events:
            events_by_match[event.match_id].append(event)

        target_ids = _team_ids(available_matches, config.target_team_name)
        own_ids = _team_ids(available_matches, config.own_team_name)
        target = _TeamWindow.collect(target_ids, available_matches, events_by_match, config)
        own = _TeamWindow.collect(own_ids, available_matches, events_by_match, config)
        head_to_head = _head_to_head(own_ids, target_ids, available_matches, events_by_match)
        target_profile = target.profile(regions, config)
        own_profile = own.profile(regions, config)
        international = tuple(
            league for league, region in regions.mappings if region == INTERNATIONAL
        )
        meta_groups = {
            league: (league,)
            for league in (target_profile["home_league"], own_profile["home_league"])
            if league is not None
        }
        meta_groups[INTERNATIONAL] = international
        league_meta = [
            _league_meta(group, leagues, available_matches, events_by_match, config)
            for group, leagues in meta_groups.items()
        ]
        quality_flags = []
        if len(head_to_head) < 3:
            quality_flags.append("LOW_HEAD_TO_HEAD_SAMPLE")
        if len({match.patch_id for match in target.matches}) > 1:
            quality_flags.append("MULTI_PATCH_WINDOW")
        if not any(match.league == "WLDs" for match in target.matches + own.matches):
            quality_flags.append("CURRENT_EVENT_GAMES_MISSING")
        return DraftScoutReport(
            {
                "schema_version": "1",
                "artifact_type": "draft-scout-pack",
                "cutoff": config.cutoff.isoformat(),
                "config": {
                    "maximum_games_per_team": config.maximum_games_per_team,
                    "meta_patches_per_region": config.meta_patches_per_region,
                    "minimum_comfort_games": config.minimum_comfort_games,
                    "top_champions": config.top_champions,
                },
                "target": target_profile,
                "own": own_profile,
                "head_to_head": head_to_head,
                "league_meta": league_meta,
                "levers": {
                    **_levers(target_profile, own_profile, head_to_head, league_meta, config),
                    "expected_picks": _expected_picks(
                        target.games, target_profile["player_pools"], league_meta
                    ),
                },
                "quality_flags": quality_flags,
                "boundary": (
                    "Descriptive counts from public pro games at the cutoff. Levers are review "
                    "prompts for the coaching staff, not win probabilities or final picks."
                ),
            }
        )


@dataclass(frozen=True, slots=True)
class _Game:
    match: MatchRecord
    team_id: str
    won: bool
    side: str
    events: tuple[PickBanEvent, ...]

    @property
    def own_events(self) -> tuple[PickBanEvent, ...]:
        return tuple(event for event in self.events if event.team_id == self.team_id)

    @property
    def opponent_events(self) -> tuple[PickBanEvent, ...]:
        return tuple(event for event in self.events if event.team_id != self.team_id)

    @property
    def first_selection(self) -> bool:
        return any(
            event.action is DraftAction.PICK and event.sequence == 1 for event in self.own_events
        )


@dataclass(frozen=True, slots=True)
class _TeamWindow:
    team_name: str
    team_ids: tuple[str, ...]
    games: tuple[_Game, ...]

    @property
    def matches(self) -> tuple[MatchRecord, ...]:
        return tuple(game.match for game in self.games)

    @classmethod
    def collect(
        cls,
        team_ids: tuple[str, ...],
        matches: tuple[MatchRecord, ...],
        events_by_match: dict[str, list[PickBanEvent]],
        config: DraftScoutConfig,
    ) -> _TeamWindow:
        involved = sorted(
            (
                match
                for match in matches
                if match.blue_team_id in team_ids or match.red_team_id in team_ids
            ),
            key=lambda match: (match.observed_at, match.match_id),
            reverse=True,
        )[: config.maximum_games_per_team]
        games = tuple(_game_for(match, team_ids, events_by_match) for match in involved)
        name = next(
            (
                game.match.blue_team_name
                if game.side == "BLUE"
                else game.match.red_team_name or game.team_id
                for game in games
            ),
            team_ids[0],
        )
        return cls(team_name=name or team_ids[0], team_ids=team_ids, games=games)

    def profile(self, regions: LeagueRegionMap, config: DraftScoutConfig) -> dict[str, Any]:
        games = self.games
        top = config.top_champions
        side_record = {
            side: _record([game for game in games if game.side == side]) for side in ("BLUE", "RED")
        }
        first_games = [game for game in games if game.first_selection]
        bans = {1: Counter[str](), 2: Counter[str]()}
        received = {1: Counter[str](), 2: Counter[str]()}
        first_rotation: Counter[str] = Counter()
        last_pick_roles: Counter[str] = Counter()
        last_pick_champions: Counter[str] = Counter()
        picks: dict[str, list[bool]] = defaultdict(list)
        pick_roles: dict[str, Counter[str]] = defaultdict(Counter)
        players: dict[str, Counter[str]] = defaultdict(Counter)
        for game in games:
            for event in game.own_events:
                phase = 1 if event.sequence <= PHASE_ONE_LAST_SEQUENCE else 2
                if event.action is DraftAction.BAN:
                    bans[phase][event.champion_id] += 1
                    continue
                picks[event.champion_id].append(game.won)
                pick_roles[event.champion_id][event.role] += 1
                if event.sequence <= FIRST_ROTATION_LAST_SEQUENCE:
                    first_rotation[event.champion_id] += 1
                if event.sequence == LAST_PICK_SEQUENCE:
                    last_pick_roles[event.role] += 1
                    last_pick_champions[event.champion_id] += 1
                if event.player_name:
                    players[event.role][event.player_name] += 1
            for event in game.opponent_events:
                if event.action is DraftAction.BAN:
                    phase = 1 if event.sequence <= PHASE_ONE_LAST_SEQUENCE else 2
                    received[phase][event.champion_id] += 1

        league_counts = Counter(game.match.league for game in games)
        home_leagues = [
            league
            for league, _ in sorted(league_counts.items(), key=lambda item: (-item[1], item[0]))
            if regions.region_for(league) != INTERNATIONAL
        ]
        second_side_games = [game for game in games if not game.first_selection]
        return {
            "team_name": self.team_name,
            "team_ids": list(self.team_ids),
            "game_count": len(games),
            "record": _record(list(games)),
            "home_league": home_leagues[0] if home_leagues else None,
            "leagues": dict(sorted(league_counts.items())),
            "patches": sorted({game.match.patch_id for game in games}),
            "window": {
                "first_observed_at": min(game.match.observed_at for game in games).isoformat(),
                "last_observed_at": max(game.match.observed_at for game in games).isoformat(),
            },
            "side_record": side_record,
            "first_selection": {
                **_record(first_games),
                "rate": _rate(len(first_games), len(games)),
            },
            "phase_one_bans": _counted(bans[1], len(games), top),
            "phase_two_bans": _counted(bans[2], len(games), top),
            "received_phase_one_bans": _counted(received[1], len(games), top),
            "received_phase_two_bans": _counted(received[2], len(games), top),
            "first_rotation_picks": _counted(first_rotation, len(games), top),
            "top_picks": _top_picks(picks, pick_roles, len(games), top),
            "pick_counts": {champion: len(results) for champion, results in sorted(picks.items())},
            "last_pick": {
                "game_count": len(second_side_games),
                "roles": _counted(last_pick_roles, len(second_side_games), len(ROLES)),
                "champions": _counted(last_pick_champions, len(second_side_games), top),
            },
            "player_pools": [
                _player_pool(role, games, players.get(role, Counter()), config) for role in ROLES
            ],
        }


def _game_for(
    match: MatchRecord, team_ids: tuple[str, ...], events_by_match: dict[str, list[PickBanEvent]]
) -> _Game:
    team_id = match.blue_team_id if match.blue_team_id in team_ids else match.red_team_id
    return _Game(
        match=match,
        team_id=team_id,
        won=match.winner_team_id == team_id,
        side="BLUE" if team_id == match.blue_team_id else "RED",
        events=tuple(sorted(events_by_match.get(match.match_id, ()), key=_event_order)),
    )


def _event_order(event: PickBanEvent) -> tuple[int, str]:
    return event.sequence, event.action.value


def _team_ids(matches: tuple[MatchRecord, ...], team_name: str) -> tuple[str, ...]:
    wanted = team_name.strip().casefold()
    ids = sorted(
        {
            team_id
            for match in matches
            for team_id, name in (
                (match.blue_team_id, match.blue_team_name),
                (match.red_team_id, match.red_team_name),
            )
            if name and name.strip().casefold() == wanted
        }
    )
    if not ids:
        raise ValueError(f"team {team_name!r} has no games available at the cutoff")
    return tuple(ids)


def _record(games: list[_Game]) -> dict[str, Any]:
    wins = sum(game.won for game in games)
    return {"game_count": len(games), "win_count": wins, "win_rate": _rate(wins, len(games))}


def _rate(count: int, total: int) -> float | None:
    return round(count / total, 3) if total else None


def _counted(counter: Counter[str], total: int, limit: int) -> list[dict[str, Any]]:
    ordered = sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]
    return [
        {"champion_id": key, "game_count": count, "rate": _rate(count, total)}
        for key, count in ordered
    ]


def _top_picks(
    picks: dict[str, list[bool]],
    pick_roles: dict[str, Counter[str]],
    total: int,
    limit: int,
) -> list[dict[str, Any]]:
    ordered = sorted(picks.items(), key=lambda item: (-len(item[1]), item[0]))[:limit]
    return [
        {
            "champion_id": champion,
            "role": pick_roles[champion].most_common(1)[0][0],
            "game_count": len(results),
            "win_count": sum(results),
            "rate": _rate(len(results), total),
        }
        for champion, results in ordered
    ]


def _player_pool(
    role: str, games: tuple[_Game, ...], names: Counter[str], config: DraftScoutConfig
) -> dict[str, Any]:
    # The newest game decides who currently plays the role; older substitutes are excluded.
    current = next(
        (
            event.player_name
            for game in games
            for event in game.own_events
            if event.action is DraftAction.PICK and event.role == role and event.player_name
        ),
        None,
    )
    champions: dict[str, list[bool]] = defaultdict(list)
    for game in games:
        for event in game.own_events:
            if (
                event.action is DraftAction.PICK
                and event.role == role
                and event.player_name == current
            ):
                champions[event.champion_id].append(game.won)
    played = sum(len(results) for results in champions.values())
    ordered = sorted(champions.items(), key=lambda item: (-len(item[1]), item[0]))
    top_three = sum(len(results) for _, results in ordered[:3])
    return {
        "role": role,
        "player_name": current,
        "game_count": played,
        "unique_champions": len(ordered),
        "comfort_champions": sum(
            len(results) >= config.minimum_comfort_games for _, results in ordered
        ),
        "top_three_share": _rate(top_three, played),
        "champions": [
            {
                "champion_id": champion,
                "game_count": len(results),
                "win_count": sum(results),
                "share": _rate(len(results), played),
            }
            for champion, results in ordered[: config.top_champions]
        ],
        "other_players": sorted(name for name in names if name != current),
    }


def _head_to_head(
    own_ids: tuple[str, ...],
    target_ids: tuple[str, ...],
    matches: tuple[MatchRecord, ...],
    events_by_match: dict[str, list[PickBanEvent]],
) -> list[dict[str, Any]]:
    games = []
    for match in sorted(matches, key=lambda item: (item.observed_at, item.match_id)):
        sides = {match.blue_team_id, match.red_team_id}
        if not (sides & set(own_ids) and sides & set(target_ids)):
            continue
        game = _game_for(match, own_ids, events_by_match)

        def draft(events: tuple[PickBanEvent, ...]) -> dict[str, Any]:
            return {
                "bans": [event.champion_id for event in events if event.action is DraftAction.BAN],
                "picks": [
                    {
                        "sequence": event.sequence,
                        "champion_id": event.champion_id,
                        "role": event.role,
                        "player_name": event.player_name,
                    }
                    for event in events
                    if event.action is DraftAction.PICK
                ],
            }

        games.append(
            {
                "match_id": match.match_id,
                "observed_at": match.observed_at.isoformat(),
                "league": match.league,
                "patch_id": match.patch_id,
                "own_side": game.side,
                "own_first_selection": game.first_selection,
                "own_won": game.won,
                "own": draft(game.own_events),
                "target": draft(game.opponent_events),
            }
        )
    return games


def _league_meta(
    group: str,
    leagues: tuple[str, ...],
    matches: tuple[MatchRecord, ...],
    events_by_match: dict[str, list[PickBanEvent]],
    config: DraftScoutConfig,
) -> dict[str, Any]:
    in_region = [match for match in matches if match.league in leagues]
    latest_patch_time: dict[str, datetime] = {}
    for match in in_region:
        latest_patch_time[match.patch_id] = max(
            latest_patch_time.get(match.patch_id, match.observed_at), match.observed_at
        )
    patches = sorted(latest_patch_time, key=latest_patch_time.__getitem__, reverse=True)[
        : config.meta_patches_per_region
    ]
    window = [match for match in in_region if match.patch_id in patches]
    presence: Counter[str] = Counter()
    picked: Counter[str] = Counter()
    banned: Counter[str] = Counter()
    role_picks: dict[str, Counter[str]] = {role: Counter() for role in ROLES}
    for match in window:
        events = events_by_match.get(match.match_id, ())
        for champion in {event.champion_id for event in events}:
            presence[champion] += 1
        for event in events:
            (picked if event.action is DraftAction.PICK else banned)[event.champion_id] += 1
            if event.action is DraftAction.PICK and event.role in role_picks:
                role_picks[event.role][event.champion_id] += 1
    ordered = sorted(presence.items(), key=lambda item: (-item[1], item[0]))[:10]
    return {
        "group": group,
        "leagues": sorted({match.league for match in window}),
        "patches": sorted(patches),
        "game_count": len(window),
        "presence": [
            {
                "champion_id": champion,
                "presence_rate": _rate(count, len(window)),
                "pick_count": picked[champion],
                "ban_count": banned[champion],
            }
            for champion, count in ordered
        ],
        # Only the international group feeds expected picks, so home leagues stay compact.
        "role_picks": {
            role: [
                {"champion_id": champion, "pick_share": _rate(count, sum(counts.values()))}
                for champion, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[
                    :ROLE_META_LIMIT
                ]
            ]
            for role, counts in role_picks.items()
            if group == INTERNATIONAL
        },
    }


def _expected_picks(
    games: tuple[_Game, ...], pools: list[dict[str, Any]], league_meta: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    role_meta = next(
        (group["role_picks"] for group in league_meta if group["group"] == INTERNATIONAL), {}
    )
    expected = []
    for pool in pools:
        role = pool["role"]
        counts = Counter(
            event.champion_id
            for game in games
            for event in game.own_events
            if event.action is DraftAction.PICK
            and event.role == role
            and event.player_name == pool["player_name"]
        )
        played = sum(counts.values())
        meta = {item["champion_id"]: item["pick_share"] or 0.0 for item in role_meta.get(role, [])}
        scores = {
            champion: EXPECTED_PICK_PLAYER_WEIGHT * (counts[champion] / played if played else 0.0)
            + (1 - EXPECTED_PICK_PLAYER_WEIGHT) * meta.get(champion, 0.0)
            for champion in set(counts) | set(meta)
        }
        ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
        expected.append(
            {
                "role": role,
                "player_name": pool["player_name"],
                # Kept longer than top_champions so readers can skip Fearless-locked champions.
                "champions": [
                    {
                        "champion_id": champion,
                        "score": round(score, 3),
                        "player_game_count": counts[champion],
                        "meta_pick_share": meta.get(champion),
                    }
                    for champion, score in ordered[:EXPECTED_PICK_LIMIT]
                ],
            }
        )
    return expected


def _levers(
    target: dict[str, Any],
    own: dict[str, Any],
    head_to_head: list[dict[str, Any]],
    league_meta: list[dict[str, Any]],
    config: DraftScoutConfig,
) -> dict[str, Any]:
    own_priority = {item["champion_id"] for item in own["top_picks"]} | {
        item["champion_id"] for item in own["first_rotation_picks"]
    }
    target_priority = {item["champion_id"] for item in target["top_picks"]} | {
        item["champion_id"] for item in target["first_rotation_picks"]
    }
    deny = []
    for pool in target["player_pools"]:
        for champion in pool["champions"][:2]:
            if champion["game_count"] < config.minimum_comfort_games:
                continue
            deny.append(
                {
                    "champion_id": champion["champion_id"],
                    "role": pool["role"],
                    "player_name": pool["player_name"],
                    "game_count": champion["game_count"],
                    "win_count": champion["win_count"],
                    "share": champion["share"],
                    "also_own_priority": champion["champion_id"] in own_priority,
                }
            )
    deny.sort(key=lambda item: (-item["game_count"], item["champion_id"]))

    target_counts = target["pick_counts"]
    own_counts = own["pick_counts"]
    contested = sorted(
        (
            {
                "champion_id": champion,
                "own_game_count": own_counts.get(champion, 0),
                "target_game_count": target_counts.get(champion, 0),
            }
            for champion in own_priority & target_priority
        ),
        key=lambda item: (
            -(item["own_game_count"] + item["target_game_count"]),
            item["champion_id"],
        ),
    )

    banned_by_target: Counter[str] = Counter(
        champion for game in head_to_head for champion in game["target"]["bans"]
    )
    received = {item["champion_id"]: item["game_count"] for item in own["received_phase_one_bans"]}
    protect = sorted(
        (
            {
                "champion_id": champion,
                "own_game_count": own_counts.get(champion, 0),
                "received_phase_one_ban_count": received.get(champion, 0),
                "banned_by_target_head_to_head": banned_by_target.get(champion, 0),
            }
            for champion in set(received) | set(banned_by_target)
            if own_counts.get(champion, 0)
        ),
        key=lambda item: (
            -(item["banned_by_target_head_to_head"] + item["received_phase_one_ban_count"]),
            item["champion_id"],
        ),
    )[: config.top_champions]

    pressure = sorted(
        (pool for pool in target["player_pools"] if pool["game_count"]),
        key=lambda pool: (
            pool["comfort_champions"],
            -(pool["top_three_share"] or 0.0),
            pool["role"],
        ),
    )
    last_roles = target["last_pick"]["roles"]
    return {
        "deny_comfort": deny[: config.top_champions],
        "contested_priority": contested[: config.top_champions],
        "protect_own": protect,
        "target_spends_phase_one_bans": target["phase_one_bans"][:3],
        # Worlds walk-forward checks found current international presence predicts a team's
        # phase-one bans better than that team's own season ban habit. The full presence list
        # is kept so readers can skip Fearless-locked champions and still show top_champions.
        "expected_phase_one_bans": [
            {"champion_id": item["champion_id"], "presence_rate": item["presence_rate"]}
            for group in league_meta
            if group["group"] == INTERNATIONAL
            for item in group["presence"]
        ],
        "fearless_pressure": [
            {
                "role": pool["role"],
                "player_name": pool["player_name"],
                "unique_champions": pool["unique_champions"],
                "comfort_champions": pool["comfort_champions"],
                "top_three_share": pool["top_three_share"],
            }
            for pool in pressure
        ],
        "counterpick_role": last_roles[0] if last_roles else None,
    }
