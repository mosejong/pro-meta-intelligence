"""Offline audit of which pre-game observations a later simulation model could use (no fetch).

Admission (registered year, archive integrity, cutoff, policy, hash, provenance, conflict
poisoning) is delegated unchanged to ``ops.audit_player_career_archive.audit_archive``. Only
years it marks usable are aggregated, and only from logical games the career builder would
accept; the accepted/rejected counts must match the builder exactly or the year fails closed.

The report holds aggregates and source hashes only. It does not estimate player strength,
effects, win rates or scores, and it is not a feature store. Game outcome and same-game
statistics (KDA, gold, damage, ...) are an explicit forbidden list for pre-game features and
are never read into aggregates; fields the admitted path does not validate are reported as
MISSING/UNSUPPORTED, never zero-filled. Archived availability (actual local retrieval time) is
kept separate from a simulated publication delay used only for replay experiments.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from dataclasses import fields
from datetime import UTC, datetime, timedelta
from pathlib import Path

from ops.audit_player_career_archive import (
    DEFAULT_ARCHIVE,
    SOURCE_ID,
    USABLE,
    audit_archive,
    output_inside_archive,
)
from pro_meta_intelligence.ingestion.oe_download import archive_for_year
from pro_meta_intelligence.models import MatchRecord
from pro_meta_intelligence.opponent.player_career import CORE, _date, _validate
from pro_meta_intelligence.sources import SnapshotArchive

ARTIFACT_TYPE = "simulation-feature-availability-audit"
DEFAULT_SIMULATED_DELAY = timedelta(hours=24)
# Only these columns of accepted prior games feed aggregates.
FEATURE_COLUMNS = ("league", "date", "patch", "position", "playerid", "teamid", "champion")
# Outcome or same-game performance: never a pre-game feature of that game.
FORBIDDEN_PRE_GAME_FIELDS = (
    "result",
    "kills",
    "deaths",
    "assists",
    "teamkills",
    "teamdeaths",
    "firstblood",
    "totalgold",
    "earnedgold",
    "goldat10",
    "goldat15",
    "golddiffat10",
    "golddiffat15",
    "damagetochampions",
    "dpm",
    "damageshare",
    "visionscore",
    "total cs",
    "cspm",
    "csdiffat10",
    "xpdiffat10",
    "gamelength",
    "towers",
    "dragons",
    "barons",
)
if set(FEATURE_COLUMNS) & set(FORBIDDEN_PRE_GAME_FIELDS):  # pragma: no cover - static guard
    raise RuntimeError("a forbidden same-game field is configured as a feature column")
# Observation groups a richer model might want; none is admitted by the validated path.
OBSERVATION_GROUPS = {
    "kda": ("kills", "deaths", "assists"),
    "gold": ("totalgold", "earnedgold", "goldat10", "golddiffat10"),
    "damage": ("damagetochampions", "dpm"),
    "vision": ("visionscore",),
    "cs": ("total cs", "cspm"),
    "game_length": ("gamelength",),
}
MATCH_RECORD_FIELDS = tuple(f.name for f in fields(MatchRecord))
BOUNDARIES = (
    "LOCAL_DIAGNOSTIC_ONLY",
    "AGGREGATES_AND_SOURCE_HASHES_ONLY",
    "NO_RAW_ROWS_NAMES_OR_PATHS",
    "USAGE_COUNTS_ARE_NOT_SKILL_OR_EFFECT",
    "NO_WIN_RATE_SCORE_OR_CAUSAL_CLAIM",
    "ASSUMPTION_MANAGER_V1_EFFECTS_REMAIN_ABSTRACT",
    "OUTCOME_AND_SAME_GAME_STATS_FORBIDDEN_AS_PRE_GAME_FEATURES",
    "MISSING_IS_NOT_ZERO",
    "ARCHIVED_AVAILABILITY_IS_NOT_HISTORICAL_PUBLICATION",
    "SIMULATED_DELAY_IS_AN_EXPERIMENT_ASSUMPTION",
    "USABLE_IS_NOT_COMPLETE_YEAR_COVERAGE",
    "NO_ALL_YEARS_COLLECTED_CLAIM",
)


def _accepted_games(snapshots) -> tuple[dict, int, dict[str, int]]:
    """Mirror the builder's grouping/fingerprint/poisoning over exact, re-hashed bytes.

    Returns (unpoisoned candidates -> (rows, archived_available_at), conflict count, headers);
    the caller still applies the builder's per-game validation.
    Raises ValueError when bytes no longer match the admitted hash (fail closed).
    """
    versions: dict = defaultdict(dict)
    headers: Counter = Counter()
    for snapshot in snapshots:
        raw = snapshot.data_path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != snapshot.content_hash.removeprefix("sha256:"):
            raise ValueError("CONTENT_CHANGED_AFTER_ADMISSION")
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        headers.update(set(reader.fieldnames or ()))
        grouped = defaultdict(list)
        for row in reader:
            grouped[(row.get("league") or "", row.get("gameid") or "")].append(
                {k: row.get(k) or "" for k in CORE}
            )
        for key, rows in grouped.items():
            core = tuple(sorted(tuple(r[k] for k in CORE) for r in rows))
            fingerprint = hashlib.sha256(repr(core).encode("utf-8")).hexdigest()
            previous = versions[key].get(fingerprint)
            at = snapshot.retrieved_at.astimezone(UTC)
            versions[key][fingerprint] = (rows, at if previous is None else min(previous[1], at))
    accepted, poisoned = {}, 0
    for key, variants in versions.items():
        if len(variants) != 1:
            poisoned += 1
            continue
        accepted[key] = next(iter(variants.values()))
    return accepted, poisoned, dict(headers)


def _field_status(headers: dict[str, int], versions: int) -> dict:
    groups = {}
    for name, columns in OBSERVATION_GROUPS.items():
        present = [c for c in columns if headers.get(c)]
        groups[name] = {
            "status": "UNSUPPORTED" if present else "MISSING",
            "raw_columns_present": present,
            "in_match_record": False,
            "aggregated": False,
            "values_emitted": None,
            "reason": (
                "present in raw file but not validated by the admitted path"
                if present
                else "column not present in admitted snapshot(s)"
            ),
        }
    return {"eligible_versions_inspected": versions, "groups": groups}


def _aggregate(accepted: dict, *, cutoff: datetime, delay: timedelta, include_usage: bool):
    leagues, patches, teams = Counter(), Counter(), Counter()
    usage, player_roles, players = Counter(), set(), set()
    before_available = sim_ready = 0
    observed = []
    for (_league, _gameid), (rows, available_at) in sorted(accepted.items()):
        first = rows[0]
        leagues[first["league"]] += 1
        patches[first["patch"]] += 1
        when = _date(first["date"])
        observed.append(when)
        if when < available_at:
            before_available += 1
        if when + delay <= cutoff:
            sim_ready += 1
        for team in sorted({r["teamid"] for r in rows}):
            teams[team] += 1
        for r in rows:
            if r["position"] == "team":
                continue
            players.add(r["playerid"])
            player_roles.add((r["playerid"], r["position"]))
            usage[(r["playerid"], r["position"], r["champion"])] += 1
    thresholds = {f"ge_{n}": sum(v >= n for v in usage.values()) for n in (1, 3, 5, 10)}
    result = {
        "accepted_games": len(accepted),
        "observed_range": (
            {"first": min(observed).isoformat(), "last": max(observed).isoformat()}
            if observed
            else None
        ),
        "league_games": dict(sorted(leagues.items())),
        "patch_games": dict(sorted(patches.items())),
        "team_games": dict(sorted(teams.items())),
        "player_champion_role_usage": {
            "distinct_players": len(players),
            "distinct_player_roles": len(player_roles),
            "distinct_player_champion_roles": len(usage),
            "triples_by_min_games": thresholds,
            "entries": (
                [
                    {"player_id": p, "role": r, "champion": c, "games": n}
                    for (p, r, c), n in sorted(usage.items())
                ]
                if include_usage
                else None
            ),
        },
        "timing": {
            "archived_availability": {
                "basis": "LOCAL_SNAPSHOT_RETRIEVED_AT",
                "games_observed_before_archived_availability": before_available,
                "historically_point_in_time_replayable": before_available == 0,
            },
            "simulated_publication": {
                "basis": "OBSERVED_AT_PLUS_ASSUMED_DELAY",
                "delay_hours": delay.total_seconds() / 3600,
                "games_label_ready_by_cutoff": sim_ready,
                "games_label_pending_at_cutoff": len(accepted) - sim_ready,
                "is_real_availability": False,
            },
        },
    }
    return result


def prior_usage(accepted: dict, *, target_observed_at: datetime, decision_at: datetime) -> Counter:
    """Usage counts a pre-game feature for a target game may see.

    Only strictly earlier games whose archived availability is at or before the decision time;
    the target game itself and same-timestamp games are excluded, and no outcome is read.
    """
    usage: Counter = Counter()
    for rows, available_at in accepted.values():
        when = _date(rows[0]["date"])
        if when >= target_observed_at or available_at > decision_at:
            continue
        for r in rows:
            if r["position"] != "team":
                usage[(r["playerid"], r["position"], r["champion"])] += 1
    return usage


def audit_features(
    archive_dir: Path,
    *,
    cutoff: datetime,
    years: tuple[int, ...],
    simulated_delay: timedelta = DEFAULT_SIMULATED_DELAY,
    include_usage: bool = False,
) -> dict:
    if simulated_delay < timedelta(0):
        raise ValueError("simulated publication delay must be non-negative")
    admission = audit_archive(archive_dir, cutoff=cutoff, years=years)
    cutoff = datetime.fromisoformat(admission["cutoff"])
    inspection = SnapshotArchive(Path(archive_dir)).inspect(SOURCE_ID)
    out_years = []
    for entry in admission["years"]:
        year = entry["season"]
        admitted = {k: v for k, v in entry.items() if k != "players"}
        record = {"season": year, "admission": admitted, "features": None, "fields": None}
        out_years.append(record)
        if entry["status"] not in USABLE:
            record["feature_status"] = "NOT_AGGREGATED_" + entry["status"]
            continue
        snapshots = archive_for_year(inspection, year).snapshots
        eligible = [s for s in snapshots if s.retrieved_at <= cutoff]
        expected = sorted((s["content_hash"], s["retrieved_at"]) for s in entry["sources"])
        actual = sorted(
            (s.content_hash.removeprefix("sha256:"), s.retrieved_at.astimezone(UTC).isoformat())
            for s in eligible
        )
        try:
            if actual != expected:
                raise ValueError("SNAPSHOT_SET_CHANGED_AFTER_ADMISSION")
            candidates, poisoned, headers = _accepted_games(eligible)
        except (OSError, UnicodeError, csv.Error, ValueError) as error:
            record["feature_status"] = "FAILED_CLOSED"
            record["reasons"] = [str(error) if isinstance(error, ValueError) else "UNREADABLE"]
            continue
        accepted, rejected = {}, poisoned
        for key, (rows, at) in candidates.items():
            if _validate(rows, year, cutoff):
                rejected += 1
            else:
                accepted[key] = (rows, at)
        coverage = entry["coverage"]
        if (
            len(accepted) != coverage["accepted_games"]
            or rejected != coverage["rejected_logical_games"]
        ):
            record["feature_status"] = "FAILED_CLOSED"
            record["reasons"] = ["BUILDER_COUNT_MISMATCH"]
            continue
        record["feature_status"] = "AGGREGATED"
        record["features"] = _aggregate(
            accepted, cutoff=cutoff, delay=simulated_delay, include_usage=include_usage
        )
        record["fields"] = _field_status(headers, len(eligible))
    return {
        "artifact_type": ARTIFACT_TYPE,
        "local_diagnostic": True,
        "cutoff": cutoff.isoformat(),
        "source_id": SOURCE_ID,
        "requested_years": admission["requested_years"],
        "admission_status_counts": admission["status_counts"],
        "archive_integrity": admission["archive_integrity"],
        "policy_at_cutoff": admission["policy_at_cutoff"],
        "feature_columns": list(FEATURE_COLUMNS),
        "forbidden_pre_game_fields": list(FORBIDDEN_PRE_GAME_FIELDS),
        "pre_game_rule": (
            "prior games only: observed_at < target observed_at and archived available_at "
            "<= decision time; outcome and same-game statistics are never features"
        ),
        "match_record_fields": list(MATCH_RECORD_FIELDS),
        "years": out_years,
        "network_collection_performed": False,
        "archive_modified": False,
        "publication_permitted": False,
        "complete_coverage_claimed": False,
        "player_strength_claimed": False,
        "boundaries": list(BOUNDARIES),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--archive-dir", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--cutoff", required=True, help="Aware ISO timestamp")
    parser.add_argument("--year", type=int, action="append", required=True)
    parser.add_argument("--simulated-delay-hours", type=float, default=24.0)
    parser.add_argument("--include-player-usage", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        cutoff = datetime.fromisoformat(args.cutoff)
    except ValueError:
        parser.error("cutoff must be an ISO timestamp")
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        parser.error("cutoff must be timezone aware")
    if args.output and output_inside_archive(args.output, args.archive_dir):
        parser.error("refusing to write report inside the archive directory")
    if args.output and (args.output.exists() or args.output.is_symlink()):
        parser.error("refusing to overwrite existing report")
    try:
        report = audit_features(
            args.archive_dir,
            cutoff=cutoff,
            years=tuple(args.year),
            simulated_delay=timedelta(hours=args.simulated_delay_hours),
            include_usage=args.include_player_usage,
        )
    except ValueError as error:
        parser.error(str(error))
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if not args.output:
        print(text, end="")
        return 0
    if output_inside_archive(args.output, args.archive_dir):
        parser.error("refusing to write report inside the archive directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if output_inside_archive(args.output, args.archive_dir):
        parser.error("refusing to write report inside the archive directory")
    try:
        with args.output.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    except FileExistsError:
        parser.error("refusing to overwrite existing report")
    print(json.dumps({"written": True, "network_collection_performed": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
