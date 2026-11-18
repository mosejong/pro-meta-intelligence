"""Bounded, usage-only annual CSV history; no roster or draft-event conversion.

Caller verifies the public source. Archives are (csv_text_or_utf8_bytes, metadata)
pairs. SHA256 covers exact supplied bytes (text is encoded UTF-8, including BOM);
content_hash accepts a hex digest or ``sha256:`` digest. Parsing strips a UTF-8
BOM only after hashing. Metadata requires source_id, season, retrieved_at and
content_hash. Naive CSV dates explicitly mean UTC; metadata and cutoff must be
timezone aware. CSV year, not calendar date, determines the competitive season.
Retrieval is archived availability, never a claim of historical public availability.
"""

from __future__ import annotations

import csv
import hashlib
import io
from collections import Counter, defaultdict
from datetime import UTC, datetime

CORE = (
    "gameid",
    "year",
    "league",
    "date",
    "patch",
    "participantid",
    "side",
    "position",
    "playerid",
    "playername",
    "teamid",
    "teamname",
    "champion",
    "result",
)
ROLES = {"top", "jng", "mid", "bot", "sup"}
MAX_EVIDENCE_IDS = 3


def _date(value, *, aware=False):
    result = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    if result.tzinfo is None or result.utcoffset() is None:
        if aware:
            raise ValueError("cutoff and retrieved_at must be timezone aware")
        result = result.replace(tzinfo=UTC)
    return result.astimezone(UTC)


def _stable(value):
    return bool(
        isinstance(value, str)
        and value
        and value.strip() == value
        and not value.casefold().startswith("name:")
    )


def _validate(rows, season, cutoff):
    if len(rows) != 12 or {r["participantid"] for r in rows} != {str(i) for i in range(1, 11)} | {
        "100",
        "200",
    }:
        return "INCOMPLETE_PARTICIPANTS"
    if any(r["year"] != str(season) for r in rows):
        return "SEASON_MISMATCH"
    try:
        dates = {_date(r["date"]) for r in rows}
    except (ValueError, TypeError):
        return "INVALID_DATE"
    if any(d > cutoff for d in dates):
        return "AFTER_CUTOFF"
    if len(dates) != 1 or any(
        len({r[k] for r in rows}) != 1 or not rows[0][k] for k in ("patch", "league", "gameid")
    ):
        return "INCONSISTENT_GAME"
    players = [r for r in rows if r["position"] != "team"]
    if (
        len(players) != 10
        or any(not _stable(r["playerid"]) or not _stable(r["teamid"]) for r in players)
        or any(not _stable(r["teamid"]) for r in rows)
    ):
        return "MISSING_STABLE_ID"
    if len({r["playerid"] for r in players}) != 10:
        return "DUPLICATE_PLAYER"
    if len({r["champion"].casefold() for r in players if r["champion"]}) != 10:
        return "INVALID_CHAMPIONS"
    if {r["side"] for r in rows} != {"Blue", "Red"}:
        return "INVALID_SIDES"
    teams, results = [], []
    for side, team_participant in (("Blue", "100"), ("Red", "200")):
        group = [r for r in rows if r["side"] == side]
        team_rows = [r for r in group if r["position"] == "team"]
        if (
            len(group) != 6
            or len(team_rows) != 1
            or team_rows[0]["participantid"] != team_participant
            or {r["position"] for r in group} != ROLES | {"team"}
            or len({r["teamid"] for r in group}) != 1
            or len({r["result"] for r in group}) != 1
            or group[0]["result"] not in {"0", "1"}
        ):
            return "INCONSISTENT_TEAM"
        teams.append(group[0]["teamid"])
        results.append(group[0]["result"])
    if len(set(teams)) != 2 or set(results) != {"0", "1"}:
        return "INCONSISTENT_RESULT"
    return None


def build_player_career_history(
    archives: list[tuple[str | bytes, dict]],
    *,
    player_ids: tuple[str, ...],
    cutoff: datetime,
    reference_season: int,
    reference_patch: str,
) -> dict:
    """Aggregate exact (source_id, player_id) identities, retaining team/role chapters.

    Bad metadata/hash/schema excludes that snapshot; malformed games exclude the
    logical game. Conflicts poison a key across eligible snapshots, including an
    invalid version. Identical core rows deduplicate irrespective of row order or
    unused stats. Coverage counts snapshot candidates and unique logical games
    separately. Output contains no raw rows, win rates, skill/era adjustment,
    retirement inference, current-roster joins, or fabricated pick sequencing.
    """
    cutoff = _date(cutoff, aware=True)
    if (
        type(reference_season) is not int
        or not 2014 <= reference_season <= cutoff.year + 1
        or not reference_patch
    ):
        raise ValueError("reference season and literal patch are required")
    if any(not isinstance(player, str) for player in player_ids):
        raise ValueError("requested player IDs must be strings")
    rejected = Counter()
    games, poisoned = {}, set()
    versions = defaultdict(dict)
    loaded = defaultdict(set)
    sources = set()
    provenance = set()
    candidates = duplicates = 0
    for payload, meta in archives:
        try:
            source, season = meta["source_id"], meta["season"]
            if (
                not _stable(source)
                or type(season) is not int
                or not 2014 <= season <= reference_season
            ):
                raise ValueError("invalid source/season")
            sources.add(source)
            retrieved = _date(meta["retrieved_at"], aware=True)
            raw = payload.encode("utf-8") if isinstance(payload, str) else payload
            digest = hashlib.sha256(raw).hexdigest()
            if meta["content_hash"] not in {digest, "sha256:" + digest}:
                rejected["HASH_MISMATCH"] += 1
                continue
            if retrieved > cutoff:
                rejected["RETRIEVED_AFTER_CUTOFF"] += 1
                continue
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
            if not reader.fieldnames or not set(CORE) <= set(reader.fieldnames):
                rejected["MISSING_CORE_COLUMNS"] += 1
                continue
            grouped = defaultdict(list)
            for row in reader:
                grouped[(row.get("league") or "", row.get("gameid") or "")].append(
                    {k: row.get(k) or "" for k in CORE}
                )
        except (KeyError, TypeError, ValueError, UnicodeError, csv.Error):
            rejected["INVALID_ARCHIVE"] += 1
            continue
        loaded[source].add(season)
        provenance.add((source, season, digest, retrieved.isoformat()))
        for (league, gameid), rows in grouped.items():
            candidates += 1
            key = (source, season, league, gameid)
            # Retain only the requested appearances, not entire multi-year raw datasets.
            # Hash all validated core rows so conflicting snapshots still poison the game.
            core = tuple(sorted(tuple(r[k] for k in CORE) for r in rows))
            fingerprint = hashlib.sha256(repr(core).encode("utf-8")).hexdigest()
            if fingerprint in versions[key]:
                duplicates += 1
            versions[key][fingerprint] = (
                _validate(rows, season, cutoff),
                [r for r in rows if r["position"] != "team" and r["playerid"] in player_ids],
            )
    for key, variants in sorted(versions.items()):
        if len(variants) != 1:
            rejected["CONFLICTING_GAME"] += 1
            poisoned.add(key)
            continue
        fingerprint, (reason, rows) = next(iter(variants.items()))
        if reason:
            rejected[reason] += 1
            poisoned.add(key)
        else:
            games[key] = (fingerprint, rows)
    profiles = []
    for source in sorted(sources):
        for player in sorted(set(player_ids)):
            supported = _stable(player)
            appearances = []
            for key, (_, rows) in sorted(games.items()):
                if key[0] == source and supported:
                    appearances.extend(
                        (key, r)
                        for r in rows
                        if r["position"] != "team" and r["playerid"] == player
                    )
            seasons = []
            start = 2014
            for season in range(start, max(loaded[source] | {reference_season}) + 1):
                selected = [(k, r) for k, r in appearances if k[1] == season]
                chapters = defaultdict(list)
                for key, row in selected:
                    chapters[(row["teamid"], row["position"])].append((key, row))
                chapter_output = []
                for (team, role), entries in sorted(chapters.items()):
                    dates = [_date(r["date"]) for _, r in entries]
                    champion_counts = Counter(r["champion"] for _, r in entries)
                    patches = defaultdict(Counter)
                    for _, row in entries:
                        patches[row["patch"]][row["champion"]] += 1
                    chapter_output.append(
                        {
                            "team_id": team,
                            "role": role,
                            "games": len(entries),
                            "team_names": sorted({r["teamname"] for _, r in entries}),
                            "champion_counts": dict(sorted(champion_counts.items())),
                            "patches": {
                                p: dict(sorted(c.items())) for p, c in sorted(patches.items())
                            },
                            "first_observed_at": min(dates).isoformat(),
                            "last_observed_at": max(dates).isoformat(),
                            "reference_patch_games": sum(
                                r["patch"] == reference_patch for _, r in entries
                            ),
                            "evidence_game_ids": [list(k) for k, _ in entries[:MAX_EVIDENCE_IDS]],
                        }
                    )
                seasons.append(
                    {
                        "season": season,
                        "status": (
                            "NOT_LOADED"
                            if season not in loaded[source]
                            else "OBSERVED"
                            if selected
                            else "NOT_OBSERVED"
                        ),
                        "games": len(selected),
                        "chapters": chapter_output,
                    }
                )
            last = max((_date(r["date"]) for _, r in appearances), default=None)
            profiles.append(
                {
                    "source_id": source,
                    "player_id": player,
                    "observed_names": sorted({r["playername"] for _, r in appearances}),
                    "status": "UNSUPPORTED_ID"
                    if not supported
                    else (
                        "CURRENT_SEASON_OBSERVED"
                        if any(k[1] == reference_season for k, _ in appearances)
                        else "HISTORICAL_ONLY"
                        if appearances
                        else "NOT_OBSERVED"
                    ),
                    "games": len(appearances),
                    "seasons": seasons,
                    "last_observed_at": last.isoformat() if last else None,
                    "observation_gap": {"kind": "OBSERVATION_GAP", "age_days": (cutoff - last).days}
                    if last
                    else None,
                }
            )
    return {
        "artifact_type": "player-career-history",
        "schema_version": 1,
        "cutoff": cutoff.isoformat(),
        "reference_season": reference_season,
        "reference_patch": reference_patch,
        "coverage_start_season": 2014,
        "coverage_notice": (
            "2014년 이후 자료를 순차 확보 중이며, 연도·대회별 수집 범위와 누락이 있을 수 있습니다."
        ),
        "boundaries": [
            "USAGE_ONLY",
            "NO_SKILL_OR_ERA_ADJUSTMENT",
            "NO_DRAFT_SEQUENCING",
            "NO_ROSTER_OR_RETIREMENT_INFERENCE",
            "PATCH_COUNTS_ARE_LITERAL",
            "RETRIEVAL_IS_ARCHIVED_AVAILABILITY",
            "NOT_OBSERVED_IS_UNKNOWN",
        ],
        "sources": [
            dict(zip(("source_id", "season", "content_hash", "retrieved_at"), p, strict=True))
            for p in sorted(provenance)
        ],
        "coverage": {
            "snapshot_game_candidates": candidates,
            "accepted_games": len(games),
            "identical_duplicates": duplicates,
            "rejected_logical_games": len(poisoned),
            "rejection_counts": dict(sorted(rejected.items())),
        },
        "players": profiles,
    }
