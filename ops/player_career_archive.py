"""Plan reviewed annual acquisitions or build usage-only career evidence from local archives.

No background scheduler is installed. --fetch-next attempts at most one reviewed annual file,
using the same provider-wide archive and persisted 24h attempt interval as current-season sync.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pro_meta_intelligence.ingestion.oe_download import (
    OracleElixirPublishedDownloadAdapter,
    archive_for_year,
)
from pro_meta_intelligence.opponent.player_career import build_player_career_history
from pro_meta_intelligence.sources import (
    PolicyGate,
    SnapshotArchive,
    SnapshotArchiveIntegrityError,
    SourceAttemptLedger,
    SourceRegistry,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "outputs/oracles-elixir/raw"
SOURCE_ID = "oracles-elixir-match-data"
NOTICE = "2014년 이후 자료를 순차 확보 중이며, 연도·대회별 수집 범위와 누락이 있을 수 있습니다."


def inspect_plan(archive_dir: Path, *, now: datetime | None = None):
    now = now or datetime.now(UTC)
    registry = SourceRegistry.load_default()
    adapter = OracleElixirPublishedDownloadAdapter(registry)
    inspection = SnapshotArchive(archive_dir).inspect(SOURCE_ID)
    if inspection.issues:
        raise SnapshotArchiveIntegrityError("historical plan requires a verified archive")
    years = []
    for year in sorted(adapter.files):
        if year < 2014 or year > now.year:
            continue
        snapshots = tuple(
            snapshot
            for snapshot in archive_for_year(inspection, year).snapshots
            if snapshot.retrieved_at <= now
        )
        latest = snapshots[-1] if snapshots else None
        years.append(
            {
                "season": year,
                "status": "ARCHIVED" if latest else "NOT_DOWNLOADED",
                "filename": adapter.files[year].filename,
                "content_hash": latest.content_hash if latest else None,
                "retrieved_at": latest.retrieved_at.isoformat() if latest else None,
            }
        )
    missing = {entry["season"] for entry in years if entry["status"] == "NOT_DOWNLOADED"}
    priority = list(dict.fromkeys([2015, 2020, 2021, *sorted(missing, reverse=True)]))
    next_year = next((year for year in priority if year in missing), None)
    attempted = SourceAttemptLedger(archive_dir).latest_attempted_at(
        SOURCE_ID, "FETCH_PUBLISHED_CSV"
    )
    attempted = attempted if attempted is None or attempted <= now else None
    eligible_times = [s.retrieved_at for s in inspection.snapshots if s.retrieved_at <= now]
    latest_time = max(eligible_times) if eligible_times else None
    previous = [value for value in (attempted, latest_time) if value is not None]
    registration = registry.get(SOURCE_ID)
    assert registration is not None
    retry = (
        max(previous) + timedelta(seconds=registration.minimum_interval_seconds)
        if previous
        else now
    )
    return {
        "artifact_type": "player-career-acquisition-plan",
        "schema_version": 1,
        "checked_at": now.isoformat(),
        "coverage_notice": NOTICE,
        "years": years,
        "next_year": next_year,
        "next_attempt_at": retry.isoformat() if next_year else None,
        "can_attempt_now": next_year is not None and now >= retry,
        "network_collection_performed": False,
        "scheduler_installed": False,
        "boundary": "Archived is not complete coverage or validated player history. "
        "One attempt per source-wide interval. Current-year sync uses the same budget.",
    }, inspection


def build_archive_history(
    archive_dir: Path,
    *,
    player_ids: tuple[str, ...],
    cutoff: datetime,
    reference_season: int,
    reference_patch: str,
):
    plan, inspection = inspect_plan(archive_dir, now=cutoff)
    registry = SourceRegistry.load_default()
    gate = PolicyGate(registry)

    def payloads():
        for entry in plan["years"]:
            candidates = archive_for_year(inspection, entry["season"]).snapshots
            eligible = [snapshot for snapshot in candidates if snapshot.retrieved_at <= cutoff]
            if not eligible:
                continue
            for snapshot in eligible:
                gate.require(SOURCE_ID, "IMPORT_LOCAL_CSV", snapshot.retrieved_at)
                # Pass all eligible versions: newer conflicts must not silently win.
                yield (
                    snapshot.data_path.read_bytes(),
                    {
                        "source_id": SOURCE_ID,
                        "season": entry["season"],
                        "content_hash": snapshot.content_hash,
                        "retrieved_at": snapshot.retrieved_at.isoformat(),
                    },
                )

    report = build_player_career_history(
        payloads(),
        player_ids=player_ids,
        cutoff=cutoff,
        reference_season=reference_season,
        reference_patch=reference_patch,
    )
    report["acquisition_plan"] = plan
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--archive-dir", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--player-id", action="append", default=[])
    parser.add_argument("--reference-season", type=int, default=datetime.now(UTC).year)
    parser.add_argument("--reference-patch", default="16.20")
    parser.add_argument("--cutoff", help="Aware timestamp; defaults to current UTC")
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--fetch-next", action="store_true", help="Attempt one file via policy-gated CLI"
    )
    args = parser.parse_args()
    now = datetime.fromisoformat(args.cutoff) if args.cutoff else datetime.now(UTC)
    if now.tzinfo is None or now.utcoffset() is None:
        parser.error("cutoff must be timezone aware")
    if args.fetch_next:
        if args.cutoff:
            parser.error("fetch uses real time; --cutoff is only for offline builds")
        from pro_meta_intelligence.cli import main as cli

        plan, _ = inspect_plan(args.archive_dir, now=now)
        if plan["next_year"] is None or not plan["can_attempt_now"]:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0 if plan["next_year"] is None else 3
        command = [
            "fetch-oe",
            "--year",
            str(plan["next_year"]),
            "--archive-dir",
            str(args.archive_dir),
        ]
        command.append("--historical-usage-only")
        if args.output:
            if args.output.exists():
                parser.error("refusing to overwrite existing report")
            command.extend(["--output", str(args.output)])
        return cli(command)
    if args.output and args.output.exists():
        parser.error("refusing to overwrite existing report")
    if args.player_id:
        report = build_archive_history(
            args.archive_dir,
            player_ids=tuple(args.player_id),
            cutoff=now,
            reference_season=args.reference_season,
            reference_patch=args.reference_patch,
        )
    else:
        report, _ = inspect_plan(args.archive_dir, now=now)
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        print(json.dumps({"output": str(args.output), "network_collection_performed": False}))
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
