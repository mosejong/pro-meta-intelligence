"""Offline admission audit of locally archived annual career files (no fetch, no writes to archive).

Each requested year is audited independently through the existing verified archive inspection,
reviewed annual manifest, policy gate and ``build_player_career_history``. Every eligible
snapshot version of a year is passed together so the builder's conflict poisoning applies.
The report is a local diagnostic only: it is not complete whole-year coverage, not a public
artifact and not publication permission. Unseen or unsupported player IDs stay unknown.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oe_download import (
    OracleElixirPublishedDownloadAdapter,
    archive_for_year,
)
from pro_meta_intelligence.opponent.player_career import build_player_career_history
from pro_meta_intelligence.sources import (
    ArchivedSnapshot,
    ArchiveInspection,
    PolicyGate,
    SnapshotArchive,
    SourceRegistry,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "outputs/oracles-elixir/raw"
SOURCE_ID = "oracles-elixir-match-data"
OPERATION = "IMPORT_LOCAL_CSV"
FIRST_SEASON = 2014
PATCH = re.compile(r"\d{1,2}\.\d{1,2}")
# Builder rejection codes that exclude a whole snapshot rather than one logical game.
SNAPSHOT_INTEGRITY_CODES = frozenset({"HASH_MISMATCH", "RETRIEVED_AFTER_CUTOFF"})
SNAPSHOT_INVALID_CODES = frozenset({"MISSING_CORE_COLUMNS", "INVALID_ARCHIVE"})
STATUSES = (
    "NOT_DOWNLOADED",
    "NOT_AVAILABLE_AT_CUTOFF",
    "BLOCKED_POLICY",
    "BLOCKED_INTEGRITY",
    "INVALID_ARCHIVE",
    "NO_ACCEPTED_GAMES",
    "USABLE_WITH_REJECTIONS",
    "USABLE",
)
USABLE = frozenset({"USABLE", "USABLE_WITH_REJECTIONS"})
BOUNDARIES = (
    "LOCAL_DIAGNOSTIC_ONLY",
    "NOT_A_PUBLIC_ARTIFACT",
    "NOT_PUBLICATION_PERMISSION",
    "USABLE_IS_NOT_COMPLETE_YEAR_COVERAGE",
    "RETRIEVAL_IS_ARCHIVED_AVAILABILITY",
    "NOT_OBSERVED_IS_UNKNOWN",
    "UNSUPPORTED_ID_IS_UNKNOWN",
    "NO_RETIREMENT_OR_SKILL_INFERENCE",
    "NO_NAME_JOINS",
    "NO_RAW_ROWS",
)


def _issue_years(archive_dir: Path, inspection: ArchiveInspection, years) -> tuple[dict, list]:
    """Attribute archive integrity issues to annual files via the reviewed manifest rule.

    An issue is attributable only when its metadata is readable JSON with a final_url that the
    existing ``archive_for_year`` rule maps to a manifest year. Anything else (orphan data,
    malformed metadata, unknown URL) is unattributable and blocks every year (fail closed).
    """
    per_year: dict[int, list[dict]] = {}
    unattributable: list[dict] = []
    source_dir = Path(archive_dir) / SOURCE_ID
    for issue in sorted(inspection.issues, key=lambda i: (i.code, i.metadata_file or "", i.detail)):
        record = {"code": issue.code, "metadata_file": issue.metadata_file}
        final_url = None
        if issue.metadata_file:
            try:
                payload = json.loads((source_dir / issue.metadata_file).read_text("utf-8"))
                final_url = payload.get("final_url") if isinstance(payload, dict) else None
            except (OSError, UnicodeDecodeError, ValueError):
                final_url = None
        matched = []
        if isinstance(final_url, str) and final_url:
            probe = ArchivedSnapshot(
                data_path=source_dir,
                metadata_path=source_dir,
                retrieved_at=datetime.min.replace(tzinfo=UTC),
                content_hash="",
                final_url=final_url,
                byte_length=0,
            )
            probe_inspection = ArchiveInspection(SOURCE_ID, (probe,), ())
            matched = [y for y in years if archive_for_year(probe_inspection, y).snapshots]
        if len(matched) == 1:
            per_year.setdefault(matched[0], []).append(record)
        else:
            unattributable.append(record)
    return per_year, unattributable


def _policy_codes(gate: PolicyGate, times) -> list[str]:
    codes = set()
    for at in times:
        decision = gate.evaluate(SOURCE_ID, OPERATION, at)
        if not decision.allowed:
            codes.add(decision.reason_code)
    return sorted(codes)


def _player_entries(report: dict | None, year: int, player_ids, year_status: str) -> list[dict]:
    profiles = {
        p["player_id"]: p
        for p in (report or {}).get("players", ())
        if p.get("source_id") == SOURCE_ID
    }
    entries = []
    for player in player_ids:
        profile = profiles.get(player)
        if year_status not in USABLE:
            entries.append(
                {"player_id": player, "status": "UNKNOWN_YEAR_NOT_USABLE", "games": None}
            )
            continue
        if profile is None or profile["status"] == "UNSUPPORTED_ID":
            entries.append({"player_id": player, "status": "UNKNOWN_UNSUPPORTED_ID", "games": None})
            continue
        season = next((s for s in profile["seasons"] if s["season"] == year), None)
        if season is None or season["status"] != "OBSERVED":
            entries.append({"player_id": player, "status": "NOT_OBSERVED_UNKNOWN", "games": 0})
            continue
        entries.append(
            {
                "player_id": player,
                "status": "OBSERVED",
                "games": season["games"],
                "chapters": [
                    {"team_id": c["team_id"], "role": c["role"], "games": c["games"]}
                    for c in season["chapters"]
                ],
            }
        )
    return entries


def audit_year(
    year: int,
    *,
    inspection: ArchiveInspection,
    gate: PolicyGate,
    cutoff: datetime,
    player_ids: tuple[str, ...],
    reference_season: int,
    reference_patch: str,
    integrity_issues: list[dict],
    global_policy_codes: list[str],
    filename: str,
) -> dict:
    entry: dict = {
        "season": year,
        "filename": filename,
        "status": None,
        "reasons": [],
        "archived_versions": 0,
        "eligible_versions": 0,
        "sources": [],
        "coverage": None,
    }
    report = None

    def done(status: str, reasons=()):
        entry["status"] = status
        entry["reasons"] = sorted(set(reasons))
        entry["players"] = _player_entries(report, year, player_ids, status)
        return entry

    snapshots = archive_for_year(inspection, year).snapshots
    entry["archived_versions"] = len(snapshots)
    if integrity_issues:
        entry["integrity_issues"] = integrity_issues
        return done("BLOCKED_INTEGRITY", (i["code"] for i in integrity_issues))
    if not snapshots:
        return done("NOT_DOWNLOADED")
    eligible = [s for s in snapshots if s.retrieved_at <= cutoff]
    entry["eligible_versions"] = len(eligible)
    if not eligible:
        # Do not reveal future hashes/retrieval times in a point-in-time audit.
        return done("NOT_AVAILABLE_AT_CUTOFF")
    policy = sorted(
        set(global_policy_codes) | set(_policy_codes(gate, [s.retrieved_at for s in eligible]))
    )
    if policy:
        return done("BLOCKED_POLICY", policy)
    payloads = []
    for snapshot in eligible:
        try:
            body = snapshot.data_path.read_bytes()
        except OSError:
            return done("BLOCKED_INTEGRITY", ("DATA_FILE_UNREADABLE",))
        payloads.append(
            (
                body,
                {
                    "source_id": SOURCE_ID,
                    "season": year,
                    "content_hash": snapshot.content_hash,
                    "retrieved_at": snapshot.retrieved_at.isoformat(),
                },
            )
        )
    report = build_player_career_history(
        payloads,
        player_ids=player_ids,
        cutoff=cutoff,
        reference_season=reference_season,
        reference_patch=reference_patch,
    )
    coverage = report["coverage"]
    entry["coverage"] = coverage
    entry["sources"] = report["sources"]
    rejections = coverage["rejection_counts"]
    # Builder provenance records the bare hex digest it recomputed from the exact bytes.
    expected = sorted(
        (s.content_hash.removeprefix("sha256:"), s.retrieved_at.astimezone(UTC).isoformat())
        for s in eligible
    )
    validated = sorted(
        (s["content_hash"].removeprefix("sha256:"), s["retrieved_at"])
        for s in report["sources"]
        if s["source_id"] == SOURCE_ID and s["season"] == year
    )
    integrity = sorted(SNAPSHOT_INTEGRITY_CODES & set(rejections))
    if integrity:
        return done("BLOCKED_INTEGRITY", integrity)
    invalid = sorted(SNAPSHOT_INVALID_CODES & set(rejections))
    if invalid or validated != expected:
        # A version silently excluded must not let the remaining versions look usable.
        return done("INVALID_ARCHIVE", invalid or ("PROVENANCE_INCOMPLETE",))
    if coverage["accepted_games"] == 0:
        return done("NO_ACCEPTED_GAMES", rejections)
    if coverage["rejected_logical_games"]:
        return done("USABLE_WITH_REJECTIONS", rejections)
    return done("USABLE")


def audit_archive(
    archive_dir: Path,
    *,
    cutoff: datetime,
    years: tuple[int, ...] | None = None,
    player_ids: tuple[str, ...] = (),
    reference_season: int | None = None,
    reference_patch: str = "16.20",
) -> dict:
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        raise ValueError("cutoff must be timezone aware")
    cutoff = cutoff.astimezone(UTC)
    reference_season = cutoff.year if reference_season is None else reference_season
    if not isinstance(reference_patch, str) or not PATCH.fullmatch(reference_patch):
        raise ValueError("reference patch must be a literal like 16.20")
    if any(not isinstance(p, str) for p in player_ids):
        raise ValueError("requested player IDs must be strings")
    # Reuse the builder's own season/patch validation before touching the archive.
    build_player_career_history(
        [],
        player_ids=(),
        cutoff=cutoff,
        reference_season=reference_season,
        reference_patch=reference_patch,
    )
    registry = SourceRegistry.load_default()
    adapter = OracleElixirPublishedDownloadAdapter(registry)
    registered = sorted(y for y in adapter.files if FIRST_SEASON <= y <= reference_season)
    requested = tuple(sorted(set(registered if years is None else years)))
    unsupported = [y for y in requested if y not in registered]
    if unsupported or not requested:
        raise ValueError(f"unsupported or unregistered years: {unsupported or 'none requested'}")
    player_ids = tuple(sorted(set(player_ids)))
    gate = PolicyGate(registry)
    inspection = SnapshotArchive(Path(archive_dir)).inspect(SOURCE_ID)
    per_year, unattributable = _issue_years(archive_dir, inspection, sorted(adapter.files))
    global_policy = _policy_codes(gate, [cutoff])
    results = [
        audit_year(
            year,
            inspection=inspection,
            gate=gate,
            cutoff=cutoff,
            player_ids=player_ids,
            reference_season=reference_season,
            reference_patch=reference_patch,
            integrity_issues=sorted(
                per_year.get(year, []) + unattributable,
                key=lambda i: (i["code"], i["metadata_file"] or ""),
            ),
            global_policy_codes=global_policy,
            filename=adapter.files[year].filename,
        )
        for year in requested
    ]
    counts = Counter(r["status"] for r in results)
    return {
        "artifact_type": "player-career-archive-admission-audit",
        "local_diagnostic": True,
        "cutoff": cutoff.isoformat(),
        "reference_season": reference_season,
        "reference_patch": reference_patch,
        "source_id": SOURCE_ID,
        "requested_years": list(requested),
        "requested_player_ids": list(player_ids),
        "archive_integrity": {
            "issue_count": len(inspection.issues),
            "unattributable_issues": unattributable,
        },
        "policy_at_cutoff": global_policy or ["ALLOWED"],
        "status_counts": {s: counts[s] for s in STATUSES if counts[s]},
        "years": results,
        "network_collection_performed": False,
        "archive_modified": False,
        "publication_permitted": False,
        "complete_coverage_claimed": False,
        "boundaries": list(BOUNDARIES),
    }


def _canonical(path: Path) -> str:
    # resolve() normalizes ".." and follows symlinks/junctions of existing components;
    # normcase makes the comparison case-insensitive where the platform is (Windows).
    return os.path.normcase(str(Path(os.path.abspath(path)).resolve(strict=False)))


def output_inside_archive(output: Path, archive_dir: Path) -> bool:
    """True when the report path (or its resolved target) is the archive root or below it."""

    def forms(path: Path) -> set[str]:
        return {_canonical(path), os.path.normcase(os.path.abspath(path))}

    for root in forms(archive_dir):
        for candidate in forms(output):
            try:
                if os.path.commonpath([root, candidate]) == root:
                    return True
            except ValueError:  # different drives
                continue
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--archive-dir", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--cutoff", help="Aware ISO timestamp; defaults to current UTC")
    parser.add_argument("--year", type=int, action="append")
    parser.add_argument("--player-id", action="append", default=[], help="Exact source ID")
    parser.add_argument("--reference-season", type=int)
    parser.add_argument("--reference-patch", default="16.20")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.cutoff:
        try:
            cutoff = datetime.fromisoformat(args.cutoff)
        except ValueError:
            parser.error("cutoff must be an ISO timestamp")
        if cutoff.tzinfo is None or cutoff.utcoffset() is None:
            parser.error("cutoff must be timezone aware")
    else:
        cutoff = datetime.now(UTC)
    if args.output:
        if output_inside_archive(args.output, args.archive_dir):
            parser.error("refusing to write report inside the archive directory")
        if args.output.exists() or args.output.is_symlink():
            parser.error("refusing to overwrite existing report")
    try:
        report = audit_archive(
            args.archive_dir,
            cutoff=cutoff,
            years=tuple(args.year) if args.year else None,
            player_ids=tuple(args.player_id),
            reference_season=args.reference_season,
            reference_patch=args.reference_patch,
        )
    except ValueError as error:
        parser.error(str(error))
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        # Re-check immediately before creating anything: the boundary may have changed.
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
        print(json.dumps({"output": str(args.output), "network_collection_performed": False}))
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
