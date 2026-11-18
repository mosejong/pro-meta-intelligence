"""Plan reviewed annual acquisitions or build usage-only career evidence from local archives.

No background scheduler is installed. --fetch-next attempts at most one reviewed annual file,
using the same provider-wide archive and persisted 24h attempt interval as current-season sync.
Live planning/--fetch-next also cross-checks the published feed and collection status as a
conservative lower bound (fail-closed); this is not a distributed lock or server ledger.
Explicit --cutoff plans/builds stay local and point-in-time and never touch the network.
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
DEFAULT_PUBLIC_FEED = ROOT / "web/public/feed/current.json"
DEFAULT_PUBLIC_STATUS = ROOT / "web/public/feed/collection-status.json"
PUBLIC_BUDGET_BOUNDARY = (
    "Conservative cross-check against published feed/collection-status records only. "
    "It is not a distributed lock or a replacement for the server attempt ledger."
)
_MISSING = object()


def read_public_json(path: Path):
    """Return (document, issue_code). A missing or unreadable record is never 'no attempt'."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None, "PUBLIC_RECORD_MISSING"
    except (OSError, UnicodeDecodeError):
        return None, "PUBLIC_RECORD_UNREADABLE"
    try:
        return json.loads(text), None
    except (json.JSONDecodeError, ValueError):
        return None, "PUBLIC_RECORD_INVALID_JSON"


def _aware_time(value, *, now: datetime, label: str, issues: list[str]):
    if not isinstance(value, str):
        issues.append(f"{label}_NOT_TIMESTAMP")
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        issues.append(f"{label}_INVALID_TIMESTAMP")
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        issues.append(f"{label}_NAIVE_TIMESTAMP")
        return None
    if parsed > now:
        issues.append(f"{label}_IN_FUTURE")
        return None
    return parsed


def public_budget_floor(
    feed=_MISSING,
    status=_MISSING,
    *,
    now: datetime,
    source_id: str = SOURCE_ID,
    feed_issue: str | None = None,
    status_issue: str | None = None,
):
    """Pure: derive the latest provider-budget time visible in published records.

    Returns {"floor": datetime | None, "issues": [...], "evidence": [...]}. Any issue means
    the live acquisition path must fail closed. Cache reuse (network_request_performed is
    exactly False) does not extend the budget; True or unknown (absent/null) does.
    """
    issues: list[str] = []
    evidence: list[dict] = []
    times: list[datetime] = []
    not_before: datetime | None = None

    if feed_issue:
        issues.append(f"FEED_{feed_issue}")
    elif feed is _MISSING or not isinstance(feed, dict):
        issues.append("FEED_INVALID_SHAPE")
    else:
        feed_input = feed.get("input")
        report = feed_input.get("import_report") if isinstance(feed_input, dict) else None
        if not isinstance(report, dict):
            issues.append("FEED_IMPORT_REPORT_MISSING")
        elif report.get("source_id") != source_id:
            issues.append("FEED_SOURCE_MISMATCH")
        else:
            retrieved = _aware_time(
                report.get("retrieved_at"), now=now, label="FEED_RETRIEVED_AT", issues=issues
            )
            if retrieved is not None:
                times.append(retrieved)
                evidence.append(
                    {"record": "feed.import_report.retrieved_at", "at": retrieved.isoformat()}
                )

    if status_issue:
        issues.append(f"STATUS_{status_issue}")
    elif status is _MISSING or not isinstance(status, dict):
        issues.append("STATUS_INVALID_SHAPE")
    elif status.get("artifact_type") != "oe-collection-status":
        issues.append("STATUS_ARTIFACT_MISMATCH")
    else:
        source = status.get("source")
        if not isinstance(source, dict) or source.get("source_id") != source_id:
            issues.append("STATUS_SOURCE_MISMATCH")
        attempt = status.get("last_attempt")
        if not isinstance(attempt, dict):
            issues.append("STATUS_LAST_ATTEMPT_MISSING")
        else:
            network = attempt.get("network_request_performed")
            if network is not None and not isinstance(network, bool):
                issues.append("STATUS_NETWORK_FLAG_NOT_BOOLEAN")
            started = _aware_time(
                attempt.get("started_at"), now=now, label="STATUS_STARTED_AT", issues=issues
            )
            finished = _aware_time(
                attempt.get("finished_at"), now=now, label="STATUS_FINISHED_AT", issues=issues
            )
            if started is not None and finished is not None and finished < started:
                issues.append("STATUS_FINISHED_BEFORE_STARTED")
            elif network is not False and finished is not None:
                times.append(finished)
                evidence.append(
                    {
                        "record": "collection_status.last_attempt.finished_at",
                        "at": finished.isoformat(),
                        "network_request_performed": network,
                    }
                )
        if isinstance(source, dict) and source.get("next_attempt_at") is not None:
            value = source["next_attempt_at"]
            try:
                parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
            except ValueError:
                parsed = None
            if parsed is None or parsed.tzinfo is None or parsed.utcoffset() is None:
                issues.append("STATUS_NEXT_ATTEMPT_INVALID_TIMESTAMP")
            else:
                # A published future retry time is a legitimate "not before" constraint.
                not_before = parsed
                evidence.append(
                    {
                        "record": "collection_status.source.next_attempt_at",
                        "not_before": parsed.isoformat(),
                    }
                )

    return {
        "floor": max(times) if times else None,
        "not_before": not_before,
        "issues": issues,
        "evidence": evidence,
    }


def load_public_budget(
    feed_path: Path, status_path: Path, *, now: datetime, source_id: str = SOURCE_ID
):
    feed, feed_issue = read_public_json(feed_path)
    status, status_issue = read_public_json(status_path)
    return public_budget_floor(
        feed if feed_issue is None else _MISSING,
        status if status_issue is None else _MISSING,
        now=now,
        source_id=source_id,
        feed_issue=feed_issue,
        status_issue=status_issue,
    )


def inspect_plan(
    archive_dir: Path, *, now: datetime | None = None, external_budget: dict | None = None
):
    """Local/point-in-time plan. external_budget (from load_public_budget) is only for live use."""
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
    blocked = False
    if external_budget is not None:
        blocked = bool(external_budget.get("issues"))
        if external_budget.get("floor") is not None:
            previous.append(external_budget["floor"])
    retry = (
        max(previous) + timedelta(seconds=registration.minimum_interval_seconds)
        if previous
        else now
    )
    if external_budget is not None and external_budget.get("not_before") is not None:
        retry = max(retry, external_budget["not_before"])
    plan = {
        "artifact_type": "player-career-acquisition-plan",
        "schema_version": 1,
        "checked_at": now.isoformat(),
        "coverage_notice": NOTICE,
        "years": years,
        "next_year": next_year,
        "next_attempt_at": retry.isoformat() if next_year and not blocked else None,
        "can_attempt_now": next_year is not None and not blocked and now >= retry,
        "network_collection_performed": False,
        "scheduler_installed": False,
        "boundary": "Archived is not complete coverage or validated player history. "
        "One attempt per source-wide interval. Current-year sync uses the same budget.",
    }
    if external_budget is not None:
        floor = external_budget.get("floor")
        plan["public_budget_check"] = {
            "status": "BLOCKED" if blocked else "CHECKED",
            "issues": list(external_budget.get("issues", ())),
            "floor": floor.isoformat() if floor else None,
            "evidence": list(external_budget.get("evidence", ())),
            "boundary": PUBLIC_BUDGET_BOUNDARY,
        }
    return plan, inspection


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


def main(argv: list[str] | None = None):
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
    parser.add_argument("--public-feed", type=Path, default=DEFAULT_PUBLIC_FEED)
    parser.add_argument("--public-collection-status", type=Path, default=DEFAULT_PUBLIC_STATUS)
    args = parser.parse_args(argv)
    now = datetime.fromisoformat(args.cutoff) if args.cutoff else datetime.now(UTC)
    if now.tzinfo is None or now.utcoffset() is None:
        parser.error("cutoff must be timezone aware")

    def live_plan():
        # Re-read real time and published records on every call; never reuse a stale check.
        at = datetime.now(UTC)
        budget = load_public_budget(args.public_feed, args.public_collection_status, now=at)
        return inspect_plan(args.archive_dir, now=at, external_budget=budget)[0]

    if args.fetch_next:
        if args.cutoff:
            parser.error("fetch uses real time; --cutoff is only for offline builds")
        if args.output and args.output.exists():
            parser.error("refusing to overwrite existing report")
        plan = live_plan()
        if plan["next_year"] is None or not plan["can_attempt_now"]:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0 if plan["next_year"] is None else 3
        from pro_meta_intelligence.cli import main as cli

        recheck = live_plan()
        if not recheck["can_attempt_now"] or recheck["next_year"] != plan["next_year"]:
            print(json.dumps(recheck, ensure_ascii=False, indent=2))
            return 3
        command = [
            "fetch-oe",
            "--year",
            str(plan["next_year"]),
            "--archive-dir",
            str(args.archive_dir),
        ]
        command.append("--historical-usage-only")
        if args.output:
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
    elif args.cutoff:
        report, _ = inspect_plan(args.archive_dir, now=now)
    else:
        report = live_plan()
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
