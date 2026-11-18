"""Fixed retrospective pick-recall benchmark; offline, no product/model changes.

Historical publication is simulated at game time +24h, not recovered from the archive.
Predict the last observed team-role occupant, never the future actual lineup. Same-series
history is frozen. Primary scoring does not assume Fearless rules; a separate sensitivity does.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from ops.draft_outcome_baseline import (
    APPROVED_HASH,
    APPROVED_RETRIEVED_AT,
    DEFAULT_CSV,
    DEFAULT_META,
    prepare_samples,
)
from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent, Side

ROLES = ("TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT")
LEAGUES = ("LCK", "LPL", "LEC", "LCS", "WLDs", "MSI", "FST", "EWC")
START = datetime(2026, 8, 1, tzinfo=UTC)
DELAY = timedelta(hours=24)
CONFIG = {
    "season": "2026",
    "evaluation_start": START.isoformat(),
    "leagues": list(LEAGUES),
    "top_k": 6,
    "player_weight": 0.75,
    "meta_last_patches": 2,
    "meta_scope": "same league, same role",
    "player_scope": "same stable player ID and role, including previous teams",
    "publication_delay_hours": 24,
    "series_gap_hours": 12,
    "bootstrap_draws": 1000,
    "bootstrap_seed": 20261118,
    "primary_locks": "none",
    "sensitivity_locks": "previous games' both-team picks; unverified rule assumption",
    "ban_comparison": "phase-one own-team bans: same-league meta vs season team habit vs .75 blend",
}


@dataclass(frozen=True)
class Game:
    match: MatchRecord
    picks: tuple[PickBanEvent, ...]
    bans: tuple[PickBanEvent, ...] = ()


def prepare(matches, events) -> tuple[list[Game], dict[str, int]]:
    # Reuse existing season/team/champion validation, then additionally validate role/identity.
    samples, excluded = prepare_samples(matches, events)
    counts = Counter(excluded)
    accepted = {sample.match_id for sample in samples}
    by_match: dict[str, list[PickBanEvent]] = defaultdict(list)
    bans_by_match: dict[str, list[PickBanEvent]] = defaultdict(list)
    for event in events:
        if event.action is DraftAction.PICK:
            by_match[event.match_id].append(event)
        elif event.action is DraftAction.BAN and event.sequence <= 6:
            bans_by_match[event.match_id].append(event)
    games = []
    seen = set()
    for match in matches:
        if match.match_id not in accepted or match.match_id in seen:
            continue
        seen.add(match.match_id)
        picks = by_match[match.match_id]
        reason = None
        for side in (Side.BLUE, Side.RED):
            mine = [event for event in picks if event.side is side]
            if sorted(event.role for event in mine) != sorted(ROLES):
                reason = "INVALID_ROLE_SET"
            elif any(not (event.player_id or "").strip() for event in mine):
                reason = "MISSING_PLAYER_ID"
            elif len({event.player_id for event in mine}) != 5:
                reason = "DUPLICATE_PLAYER_ID"
        if len({event.player_id for event in picks}) != 10:
            reason = reason or "PLAYER_ON_BOTH_TEAMS"
        if any(event.observed_at != match.observed_at for event in picks):
            reason = "EVENT_TIME_MISMATCH"
        if reason:
            counts[reason] += 1
        else:
            bans = bans_by_match[match.match_id]
            valid_bans = (
                len(bans) == 6
                and len({e.sequence for e in bans}) == 6
                and len({e.champion_id for e in bans}) == 6
                and all(e.champion_id.strip() and e.observed_at == match.observed_at for e in bans)
                and all(
                    len([e for e in bans if e.side is side and e.team_id == team]) == 3
                    for side, team in (
                        (Side.BLUE, match.blue_team_id),
                        (Side.RED, match.red_team_id),
                    )
                )
            )
            games.append(Game(match, tuple(picks), tuple(bans) if valid_bans else ()))
    return sorted(games, key=lambda g: (g.match.observed_at, g.match.match_id)), dict(counts)


def group_series(games: list[Game]) -> list[list[Game]]:
    groups: list[list[Game]] = []
    latest: dict[tuple[str, str], int] = {}
    for game in games:
        match = game.match
        keys = [(match.league, team) for team in (match.blue_team_id, match.red_team_id)]
        index = latest.get(keys[0])
        previous = groups[index][-1] if index is not None else None
        same = (
            previous is not None
            and latest.get(keys[1]) == index
            and {previous.match.blue_team_id, previous.match.red_team_id}
            == {match.blue_team_id, match.red_team_id}
            and match.observed_at - previous.match.observed_at <= timedelta(hours=12)
        )
        if same:
            groups[index].append(game)
        else:
            index = len(groups)
            groups.append([game])
        for key in keys:
            latest[key] = index
    return groups


def rank(player: dict[str, int], meta: dict[str, int], weight: float, locked=()) -> list[str]:
    ptotal, mtotal = sum(player.values()), sum(meta.values())
    scores = {
        champ: weight * player.get(champ, 0) / (ptotal or 1)
        + (1 - weight) * meta.get(champ, 0) / (mtotal or 1)
        for champ in player.keys() | meta.keys()
    }
    return [
        champ
        for champ in sorted(scores, key=lambda champ: (-scores[champ], champ))
        if champ not in locked and scores[champ] > 0
    ][: CONFIG["top_k"]]


def cluster_interval(rows: list[dict[str, Any]]) -> dict[str, Any]:
    clusters: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for row in rows:
        if row["common_supported"]:
            value = clusters[row["series_id"]]
            value[0] += int(row["hits"]["blend"]) - int(row["hits"]["meta"])
            value[1] += 1
    if len(clusters) < 2:
        return {"clusters": len(clusters), "lower": None, "upper": None}
    values = list(clusters.values())
    rng = random.Random(CONFIG["bootstrap_seed"])
    draws = []
    for _ in range(CONFIG["bootstrap_draws"]):
        chosen = rng.choices(values, k=len(values))
        draws.append(sum(x[0] for x in chosen) / sum(x[1] for x in chosen))
    draws.sort()
    return {"clusters": len(clusters), "lower": draws[24], "upper": draws[974]}


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    common = [row for row in rows if row["common_supported"]]
    metrics = {}
    for method in ("meta", "player", "blend"):
        supported = [row for row in rows if row["supported"][method]]
        hits = sum(row["hits"][method] for row in common)
        metrics[method] = {
            "common_hit": hits,
            "common_of": len(common),
            "common_rate": hits / len(common) if common else None,
            "supported_hit": sum(row["hits"][method] for row in supported),
            "supported_of": len(supported),
            "prediction_available_of": sum(bool(row["predictions"][method]) for row in rows),
            "common_empty_predictions": sum(not row["predictions"][method] for row in common),
            "candidate_count_mean": (
                sum(len(row["predictions"][method]) for row in common) / len(common)
                if common
                else None
            ),
        }
    delta = (
        (metrics["blend"]["common_hit"] - metrics["meta"]["common_hit"]) / len(common)
        if common
        else None
    )
    return {
        "rows": len(rows),
        "common_rows": len(common),
        "common_coverage": len(common) / len(rows) if rows else None,
        "roster_changed_rows": sum(row["roster_changed"] for row in rows),
        "roster_unknown_rows": sum(not row.get("roster_known", True) for row in rows),
        "common_prediction_rows": sum(all(row["predictions"].values()) for row in common),
        "support_boundary": (
            "Coverage refers to pre-lock history support; prediction_available_of and "
            "common_prediction_rows separately expose empty post-lock lists. "
            "Empty lists remain misses, not silently excluded."
        ),
        "metrics": metrics,
        "blend_minus_meta": delta,
        "paired_series_interval_95": cluster_interval(rows),
    }


def evaluate(games: list[Game]) -> dict[str, Any]:
    games = sorted(games, key=lambda g: (g.match.observed_at, g.match.match_id))
    series = group_series(games)
    player_history: dict[tuple[str, str], Counter] = defaultdict(Counter)
    league_history: dict[tuple[str, str, str], Counter] = defaultdict(Counter)
    patches: dict[str, list[str]] = defaultdict(list)
    latest_player: dict[tuple[str, str], str] = {}
    cursor = 0
    rows = []
    sensitivity = []
    latest_used = None
    series_log = []
    for group in series:
        cutoff = group[0].match.observed_at
        if cutoff < START or group[0].match.league not in LEAGUES:
            continue
        while cursor < len(games) and games[cursor].match.observed_at + DELAY < cutoff:
            past = games[cursor]
            match = past.match
            if match.patch_id not in patches[match.league]:
                patches[match.league].append(match.patch_id)
            for event in past.picks:
                player_history[event.player_id, event.role][event.champion_id] += 1
                league_history[match.league, match.patch_id, event.role][event.champion_id] += 1
                latest_player[event.team_id, event.role] = event.player_id
            latest_used = match.observed_at
            cursor += 1
        series_id = group[0].match.match_id
        series_log.append(
            {
                "series_id": series_id,
                "cutoff": cutoff.isoformat(),
                "latest_history_at": latest_used.isoformat() if latest_used else None,
                "history_games": cursor,
                "game_ids": [g.match.match_id for g in group],
            }
        )
        locked: set[str] = set()
        for game in group:
            for event in sorted(game.picks, key=lambda e: (e.team_id, e.role)):
                predicted_player = latest_player.get((event.team_id, event.role))
                personal = dict(player_history.get((predicted_player, event.role), {}))
                meta: Counter = Counter()
                selected_patches = patches[game.match.league][-CONFIG["meta_last_patches"] :]
                for patch in selected_patches:
                    meta.update(league_history[game.match.league, patch, event.role])
                for sensitivity_mode, output in ((False, rows), (True, sensitivity)):
                    predictions = {
                        method: rank(
                            personal, dict(meta), weight, locked if sensitivity_mode else ()
                        )
                        for method, weight in (("meta", 0), ("player", 1), ("blend", 0.75))
                    }
                    supported = {
                        "meta": bool(meta),
                        "player": bool(personal),
                        "blend": bool(meta) and bool(personal),
                    }
                    output.append(
                        {
                            "series_id": series_id,
                            "match_id": game.match.match_id,
                            "league": game.match.league,
                            "team_id": event.team_id,
                            "role": event.role,
                            "actual_champion": event.champion_id,
                            "actual_player_id": event.player_id,
                            "predicted_player_id": predicted_player,
                            "roster_known": predicted_player is not None,
                            "roster_changed": predicted_player is not None
                            and predicted_player != event.player_id,
                            "cutoff": cutoff.isoformat(),
                            "observed_at": game.match.observed_at.isoformat(),
                            "latest_history_at": latest_used.isoformat() if latest_used else None,
                            "history_games": cursor,
                            "meta_patches": selected_patches,
                            "player_counts": personal,
                            "meta_counts": dict(meta),
                            "locked": sorted(locked) if sensitivity_mode else [],
                            "supported": supported,
                            "common_supported": all(supported.values()),
                            "predictions": predictions,
                            "hits": {
                                method: event.champion_id in choices
                                for method, choices in predictions.items()
                            },
                        }
                    )
            locked.update(event.champion_id for event in game.picks)
    segments = {}
    for field in ("league", "team_id", "role"):
        buckets: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            buckets[row[field]].append(row)
        segments[field] = {key: summarize(value) for key, value in sorted(buckets.items())}
    return {
        "artifact_type": "scouting-evidence-benchmark",
        "schema_version": "1",
        "config": CONFIG,
        "config_sha256": hashlib.sha256(json.dumps(CONFIG, sort_keys=True).encode()).hexdigest(),
        "eligible_games": len(games),
        "evaluation_games": len({r["match_id"] for r in rows}),
        "series": series_log,
        "overall": summarize(rows),
        "segments": segments,
        "roster_unchanged": summarize(
            [r for r in rows if r["roster_known"] and not r["roster_changed"]]
        ),
        "roster_unknown": summarize([r for r in rows if not r["roster_known"]]),
        "roster_changed": summarize([r for r in rows if r["roster_changed"]]),
        "absent_evaluation_leagues": sorted(set(LEAGUES) - {r["league"] for r in rows}),
        "primary_rows": rows,
        "fearless_sensitivity": {"summary": summarize(sensitivity), "rows": sensitivity},
        "phase_one_bans": evaluate_bans(games),
        "boundary": (
            "Retrospective top-6 pick recall, not utility, win probability or causal effects. "
            "Publication +24h is simulated, not actual historical availability. Same-season "
            "player history can cross teams; product A/B evidence uses source-team identity. "
            "Existing evaluation data has been inspected before; not a pristine holdout. "
            "No assumed locks in primary; sensitivity is not verified tournament rules. "
            "Ban comparison predicts own-team phase-one bans, not bans received. "
            "Later/final games are not evaluated; no product scores were changed."
        ),
    }


def evaluate_bans(games: list[Game]) -> dict[str, Any]:
    """Separate descriptive own-team ban recall; no player or forced Fearless assumptions."""
    team_counts: dict[str, Counter] = defaultdict(Counter)
    meta_counts: dict[tuple[str, str], Counter] = defaultdict(Counter)
    patches: dict[str, list[str]] = defaultdict(list)
    cursor = 0
    rows = []
    missing_games = []
    for series in group_series(games):
        cutoff = series[0].match.observed_at
        if cutoff < START or series[0].match.league not in LEAGUES:
            continue
        while cursor < len(games) and games[cursor].match.observed_at + DELAY < cutoff:
            past = games[cursor]
            if past.bans:
                league, patch = past.match.league, past.match.patch_id
                if patch not in patches[league]:
                    patches[league].append(patch)
                for event in past.bans:
                    team_counts[event.team_id][event.champion_id] += 1
                    meta_counts[league, patch][event.champion_id] += 1
            cursor += 1
        for game in series:
            if not game.bans:
                missing_games.append(game.match.match_id)
                continue
            for event in game.bans:
                habit = dict(team_counts[event.team_id])
                meta: Counter = Counter()
                selected = patches[game.match.league][-2:]
                for patch in selected:
                    meta.update(meta_counts[game.match.league, patch])
                predictions = {
                    method: rank(habit, dict(meta), weight)
                    for method, weight in (("meta", 0), ("player", 1), ("blend", 0.75))
                }
                # The shared summarizer's player slot is renamed to team_habit on export.
                rows.append(
                    {
                        "series_id": series[0].match.match_id,
                        "match_id": game.match.match_id,
                        "league": game.match.league,
                        "team_id": event.team_id,
                        "cutoff": cutoff.isoformat(),
                        "observed_at": game.match.observed_at.isoformat(),
                        "actual_champion": event.champion_id,
                        "roster_changed": False,
                        "supported": {
                            "meta": bool(meta),
                            "player": bool(habit),
                            "blend": bool(meta) and bool(habit),
                        },
                        "common_supported": bool(meta) and bool(habit),
                        "predictions": predictions,
                        "hits": {
                            method: event.champion_id in choices
                            for method, choices in predictions.items()
                        },
                        "team_counts": habit,
                        "meta_counts": dict(meta),
                        "meta_patches": selected,
                    }
                )
    summary = summarize(rows)
    summary["metrics"]["team_habit"] = summary["metrics"].pop("player")
    segments = {}
    for league in sorted({r["league"] for r in rows}):
        value = summarize([r for r in rows if r["league"] == league])
        value["metrics"]["team_habit"] = value["metrics"].pop("player")
        segments[league] = value
    for row in rows:
        for field in ("predictions", "hits", "supported"):
            row[field]["team_habit"] = row[field].pop("player")
    return {
        "summary": summary,
        "by_league": segments,
        "rows": rows,
        "missing_phase_one_bans_games": missing_games,
        "boundary": "Own-team bans only. Top-6, common supported rows. No Fearless assumption. "
        "Requires six validated phase-one bans and the pick benchmark's complete-ID game cohort.",
    }


def run_archive(csv_path: Path = DEFAULT_CSV, meta_path: Path = DEFAULT_META):
    from ops.build_player_season_history import verify_archive
    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    archive = verify_archive(csv_path, meta_path)
    if archive["content_hash"] != f"sha256:{APPROVED_HASH}":
        raise ValueError("not the approved snapshot")
    if archive["retrieved_at"] != APPROVED_RETRIEVED_AT:
        raise ValueError("not the approved retrieval time")
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        csv_path, retrieved_at=archive["retrieved_at"], source_timezone="UTC", issue_detail_limit=0
    )
    if imported.report.content_hash != archive["content_hash"]:
        raise ValueError("adapter hash mismatch")
    games, exclusions = prepare(imported.matches, imported.draft_events)
    report = evaluate(games)
    report["source"] = {
        "content_hash": archive["content_hash"],
        "retrieved_at": archive["retrieved_at"].isoformat(),
        "adapter_imported_games": len(imported.matches),
        "adapter_rejected_games": imported.report.rejected_game_count,
        "adapter_issue_counts": dict(imported.report.issue_counts),
        "last_eligible_game": games[-1].match.observed_at.isoformat() if games else None,
    }
    report["exclusions"] = exclusions
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("refusing to overwrite existing report")
    report = run_archive()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({"output": str(args.output), "overall": report["overall"]}, indent=2))


if __name__ == "__main__":
    main()
