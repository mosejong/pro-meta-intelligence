"""Season-long, per-role player pick history for a reference roster (player-season-history v1).

Players are matched only by the exact (source team ID, player ID) pair of a reference roster
profile. Names never join records, a player's games for another team are never added, and
``name:`` fallback identities are reported as unsupported instead of being matched.

Only PICK events of accepted (adapter-validated) matches that were observable and available at
the cutoff and fall inside the calendar season (UTC) are counted. The role is the event's own
role, so a player's games are split by the role actually played. The output is a derived
aggregate: counts, date ranges and at most ``MAX_EXAMPLE_IDS`` example event IDs per champion,
never raw rows or per-game listings.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent, require_aware

ARTIFACT_TYPE = "player-season-history"
SCHEMA_VERSION = 1
ROLES = ("TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT")
RECENT_GAME_LIMIT = 20
MAX_EXAMPLE_IDS = 3
NAME_FALLBACK_PREFIX = "name:"


@dataclass(frozen=True, slots=True)
class RosterReference:
    team_id: str
    team_name: str
    player_id: str
    player_name: str


@dataclass(frozen=True, slots=True)
class _Appearance:
    match: MatchRecord
    role: str
    champion_id: str
    event_id: str


def roster_basis_from_feed(feed: Mapping[str, Any]) -> dict[str, Any]:
    """The same basis shape the web roster scenario derives from the feed (roster-scenario v1)."""

    sources = (feed.get("evidence_index") or {}).get("source_versions") or []
    return {
        "patch_id": feed["patch_id"],
        "cutoff": feed["cutoff"],
        "fixture_only": bool(feed["fixture_only"]),
        "source_versions": sorted(
            f"{item['source_id']}@{item['source_version']}#{item['content_hash']}"
            for item in sources
        ),
    }


def roster_references_from_feed(feed: Mapping[str, Any]) -> tuple[RosterReference, ...]:
    references: list[RosterReference] = []
    for team in (feed.get("opponent_prep") or {}).get("teams") or []:
        for profile in team.get("player_profiles") or []:
            if not profile.get("player_id"):
                continue
            references.append(
                RosterReference(
                    team_id=team["team_id"],
                    team_name=team["team_name"],
                    player_id=profile["player_id"],
                    player_name=profile.get("player_name") or "",
                )
            )
    return tuple(references)


def _utc(value: datetime) -> datetime:
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat()


def _dedupe_matches(
    matches: Iterable[MatchRecord], *, cutoff: datetime, season: int
) -> tuple[dict[str, MatchRecord], dict[str, int]]:
    excluded = {"after_cutoff": 0, "outside_season": 0, "conflicting_duplicate": 0}
    kept: dict[str, MatchRecord] = {}
    conflicting: set[str] = set()
    for match in matches:
        if match.available_at > cutoff or match.observed_at > cutoff:
            excluded["after_cutoff"] += 1
            continue
        if _utc(match.observed_at).year != season:
            excluded["outside_season"] += 1
            continue
        if match.match_id in conflicting:
            continue
        previous = kept.get(match.match_id)
        if previous is None:
            kept[match.match_id] = match
        elif previous != match:
            # Two different records claim one match ID: trust neither.
            conflicting.add(match.match_id)
            del kept[match.match_id]
    excluded["conflicting_duplicate"] = len(conflicting)
    return kept, excluded


def _appearances(
    events: Iterable[PickBanEvent],
    matches: Mapping[str, MatchRecord],
    *,
    cutoff: datetime,
    wanted: set[tuple[str, str]],
) -> tuple[dict[tuple[str, str], list[_Appearance]], dict[str, int]]:
    excluded = {"conflicting_player_game": 0}
    by_event: dict[str, PickBanEvent] = {}
    conflicting_events: set[str] = set()
    for event in events:
        if event.action is not DraftAction.PICK:
            continue
        if event.available_at > cutoff or event.observed_at > cutoff:
            continue
        match = matches.get(event.match_id)
        if match is None or event.team_id not in {match.blue_team_id, match.red_team_id}:
            continue
        if event.role not in ROLES or not event.player_id:
            continue
        if (event.team_id, event.player_id) not in wanted:
            continue
        if event.event_id in conflicting_events:
            continue
        previous = by_event.get(event.event_id)
        if previous is None:
            by_event[event.event_id] = event
        elif previous != event:
            conflicting_events.add(event.event_id)
            del by_event[event.event_id]

    # One pick per (match, team, player). Duplicates of the same pick under different event IDs
    # count once; a player with two different picks in one game is excluded for that game.
    per_game: dict[tuple[str, str, str], dict[tuple[str, str], PickBanEvent]] = defaultdict(dict)
    for event in sorted(by_event.values(), key=lambda item: item.event_id):
        key = (event.match_id, event.team_id, event.player_id or "")
        per_game[key].setdefault((event.role, event.champion_id.casefold()), event)

    result: dict[tuple[str, str], list[_Appearance]] = defaultdict(list)
    for (match_id, team_id, player_id), picks in per_game.items():
        if len(picks) != 1:
            excluded["conflicting_player_game"] += 1
            continue
        event = next(iter(picks.values()))
        result[(team_id, player_id)].append(
            _Appearance(matches[match_id], event.role, event.champion_id, event.event_id)
        )
    excluded["conflicting_event_id"] = len(conflicting_events)
    return result, excluded


def _ordered(appearances: Iterable[_Appearance]) -> list[_Appearance]:
    return sorted(appearances, key=lambda item: (item.match.observed_at, item.match.match_id))


def _scope(appearances: Sequence[_Appearance], *, examples: bool) -> dict[str, Any]:
    if not appearances:
        return {"games": 0, "first_observed_at": None, "last_observed_at": None, "champions": []}
    grouped: dict[str, list[_Appearance]] = defaultdict(list)
    for item in appearances:
        grouped[item.champion_id].append(item)
    champions: list[dict[str, Any]] = []
    for champion_id, items in grouped.items():
        entry: dict[str, Any] = {"champion_id": champion_id, "games": len(items)}
        if examples:
            latest = sorted(
                items, key=lambda item: (item.match.observed_at, item.event_id), reverse=True
            )
            entry["example_event_ids"] = [item.event_id for item in latest[:MAX_EXAMPLE_IDS]]
        champions.append(entry)
    champions.sort(key=lambda entry: (-entry["games"], entry["champion_id"]))
    return {
        "games": len(appearances),
        "first_observed_at": _iso(min(item.match.observed_at for item in appearances)),
        "last_observed_at": _iso(max(item.match.observed_at for item in appearances)),
        "champions": champions,
    }


def _breakdown(appearances: Sequence[_Appearance], field: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[_Appearance]] = defaultdict(list)
    for item in appearances:
        grouped[getattr(item.match, field)].append(item)
    rows = [
        {
            "id": key,
            "games": len(items),
            "first_observed_at": _iso(min(item.match.observed_at for item in items)),
            "last_observed_at": _iso(max(item.match.observed_at for item in items)),
        }
        for key, items in grouped.items()
    ]
    return sorted(rows, key=lambda row: (row["first_observed_at"], row["id"]))


def build_player_season_history(
    matches: Iterable[MatchRecord],
    draft_events: Iterable[PickBanEvent],
    roster: Sequence[RosterReference],
    *,
    season: int,
    cutoff: datetime,
    roster_basis: Mapping[str, Any],
    source: Mapping[str, Any],
    import_report: Mapping[str, Any],
) -> dict[str, Any]:
    """Aggregate season pick history for every reference player; inputs are not mutated."""

    require_aware(cutoff, "cutoff")
    retrieved_at = datetime.fromisoformat(str(source["retrieved_at"]))
    require_aware(retrieved_at, "source.retrieved_at")
    if retrieved_at > cutoff:
        raise ValueError("source was retrieved after the cutoff")
    if datetime.fromisoformat(str(roster_basis.get("cutoff"))) != cutoff:
        raise ValueError("cutoff must equal the reference roster basis cutoff")
    reference_patch = str(roster_basis["patch_id"])

    kept, match_exclusions = _dedupe_matches(matches, cutoff=cutoff, season=season)
    supported = {
        (ref.team_id, ref.player_id)
        for ref in roster
        if not ref.player_id.startswith(NAME_FALLBACK_PREFIX)
    }
    found, event_exclusions = _appearances(draft_events, kept, cutoff=cutoff, wanted=supported)

    players: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for ref in sorted(roster, key=lambda item: (item.team_id, item.player_id)):
        key = (ref.team_id, ref.player_id)
        if key in seen:
            continue
        seen.add(key)
        entry: dict[str, Any] = {
            "team_id": ref.team_id,
            "team_name": ref.team_name,
            "player_id": ref.player_id,
            "player_name": ref.player_name,
        }
        if key not in supported:
            players.append({**entry, "status": "UNSUPPORTED_ID", "games": 0, "roles": {}})
            continue
        appearances = _ordered(found.get(key, []))
        if not appearances:
            players.append({**entry, "status": "NOT_FOUND", "games": 0, "roles": {}})
            continue
        roles: dict[str, Any] = {}
        for role in ROLES:
            in_role = [item for item in appearances if item.role == role]
            if not in_role:
                continue
            recent = in_role[-RECENT_GAME_LIMIT:]
            patch = [item for item in in_role if item.match.patch_id == reference_patch]
            roles[role] = {
                "season": _scope(in_role, examples=True),
                "recent": _scope(recent, examples=False),
                "patch": _scope(patch, examples=False),
                "by_patch": _breakdown(in_role, "patch_id"),
                "by_league": _breakdown(in_role, "league"),
            }
        players.append({**entry, "status": "FOUND", "games": len(appearances), "roles": roles})

    season_matches = list(kept.values())
    return {
        "artifact_type": ARTIFACT_TYPE,
        "schema_version": SCHEMA_VERSION,
        "season": season,
        "cutoff": roster_basis["cutoff"],
        "reference_patch": reference_patch,
        "recent_game_limit": RECENT_GAME_LIMIT,
        "roster_basis": dict(roster_basis),
        "source": {
            "source_id": source["source_id"],
            "source_version": source["source_version"],
            "content_hash": source["content_hash"],
            "retrieved_at": retrieved_at.isoformat(),
        },
        "source_versions": [
            f"{source['source_id']}@{source['source_version']}#{source['content_hash']}"
        ],
        "import_summary": {
            "discovered_game_count": import_report.get("discovered_game_count"),
            "accepted_game_count": import_report.get("imported_game_count"),
            "rejected_game_count": import_report.get("rejected_game_count"),
            "rejected_reason_counts": dict(import_report.get("issue_counts") or {}),
            "season_accepted_game_count": len(season_matches),
            "season_first_observed_at": (
                _iso(min(m.observed_at for m in season_matches)) if season_matches else None
            ),
            "season_last_observed_at": (
                _iso(max(m.observed_at for m in season_matches)) if season_matches else None
            ),
            "excluded": {**match_exclusions, **event_exclusions},
            "note": (
                "Whole-file accepted/rejected game counts from the source adapter. They are not a "
                "per-player missing rate; rejected games are simply not counted for anyone."
            ),
        },
        "scope": {
            "identity": "exact (source team ID, player ID); no name matching or cross-team sums",
            "events": "PICK events of accepted games only; role is the role played in that game",
            "recent": f"latest {RECENT_GAME_LIMIT} unique games per player, source team and role",
            "patch": "games on the reference roster patch only",
        },
        "player_count": len(players),
        "players": players,
    }
