"""Hosted history-only acquisition: at most one reviewed past annual file per manual dispatch.

This wrapper never downloads anything itself. After fail-closed preconditions it delegates to
the existing ``ops/player_career_archive.py --fetch-next`` path, which applies the shared public
budget preflight, the persisted source-wide attempt ledger, the 24h provider interval and the
source policy review. The wrapper only classifies the delegated outcome truthfully and writes a
bounded report. It is not a scheduler, a distributed lock, or a publication step.

Exit codes: 0 = ACQUIRED, NOTHING_MISSING or DEFERRED (no provider request was due);
1 = any precondition failure, blocked public records, source failure or unexpected error.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ops import player_career_archive  # noqa: E402
from pro_meta_intelligence.sources import (  # noqa: E402
    PolicyGate,
    SnapshotArchive,
    SourceAttemptLedger,
    SourceRegistry,
)

SOURCE_ID = player_career_archive.SOURCE_ID
OPERATION = "FETCH_PUBLISHED_CSV"
SUCCESS_OUTCOMES = frozenset({"ACQUIRED", "NOTHING_MISSING", "DEFERRED"})
BOUNDARY = (
    "History-only acquisition stores at most one reviewed past annual file in the private "
    "archive. An archived file is not validated player history, complete coverage or a public "
    "publication. No feed, Pages artifact or Git push is produced by this mode."
)
_UNREAD = object()
_REPORTED_FIELDS = (
    "status",
    "year",
    "filename",
    "content_hash",
    "retrieved_at",
    "byte_length",
    "retry_at",
    "error",
    "network_collection_performed",
)


def _latest_attempt(archive_dir: Path):
    return SourceAttemptLedger(archive_dir).latest_attempted_at(SOURCE_ID, OPERATION)


def check_preconditions(
    archive_dir: Path, restore_report: Path, *, now: datetime, registry=None
) -> list[str]:
    """Offline checks that must all pass before any delegated provider request is possible."""
    issues: list[str] = []
    report = _UNREAD
    try:
        report = json.loads(Path(restore_report).read_text(encoding="utf-8"))
    except FileNotFoundError:
        issues.append("RESTORE_REPORT_MISSING")
    except (OSError, UnicodeDecodeError, ValueError):
        issues.append("RESTORE_REPORT_UNREADABLE")
    if report is not _UNREAD:
        # Any decoded value, including JSON null, must positively prove authentication.
        if not isinstance(report, dict):
            issues.append("RESTORE_REPORT_INVALID_SHAPE")
        elif (
            report.get("artifact_type") != "restored-private-oe-archive"
            or report.get("source_id") != SOURCE_ID
            or report.get("authenticated") is not True
        ):
            issues.append("RESTORE_NOT_AUTHENTICATED")
    if not Path(archive_dir).is_dir():
        issues.append("ARCHIVE_DIR_MISSING")
    else:
        inspection = SnapshotArchive(archive_dir).inspect(SOURCE_ID)
        if inspection.issues:
            issues.append("ARCHIVE_INTEGRITY_FAILED")
        elif not inspection.snapshots:
            # A restored hosted state always carries current-season snapshots; an empty
            # archive means continuity was lost and must not be silently restarted here.
            issues.append("ARCHIVE_EMPTY")
        try:
            _latest_attempt(archive_dir)
        except Exception:  # noqa: BLE001 - any ledger defect must fail closed
            issues.append("ATTEMPT_LEDGER_INVALID")
    registry = registry or SourceRegistry.load_default()
    decision = PolicyGate(registry).evaluate(SOURCE_ID, OPERATION, now)
    if not decision.allowed:
        issues.append(f"SOURCE_POLICY_{decision.reason_code}")
    return issues


def _parse_json(text: str):
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def classify(exit_code, attempt: dict | None, plan: dict | None, *, attempt_recorded: bool):
    """Pure: map the delegated result to an outcome. Deferral is never reported as success."""
    status = attempt.get("status") if attempt else None
    if exit_code == 0 and status == "DOWNLOADED":
        return "ACQUIRED"
    if exit_code == 0 and attempt is None and plan is not None and plan.get("next_year") is None:
        return "NOTHING_MISSING"
    if exit_code == 3 and not attempt_recorded:
        if status == "RATE_LIMITED":
            return "DEFERRED"
        if attempt is None and plan is not None:
            check = plan.get("public_budget_check") or {}
            if check.get("status") == "BLOCKED":
                return "BLOCKED_PUBLIC_RECORDS"
            return "DEFERRED"
    if exit_code == 4 and status == "SOURCE_UNAVAILABLE":
        return "SOURCE_UNAVAILABLE"
    return "FAILED"


def run(
    *,
    archive_dir: Path,
    restore_report: Path,
    attempt_output: Path,
    public_feed: Path,
    public_collection_status: Path,
    now: datetime | None = None,
    fetch_next=None,
):
    """Return (report, exit_code). ``fetch_next(argv) -> int`` is injectable for offline tests."""
    now = now or datetime.now(UTC)
    report = {
        "artifact_type": "hosted-history-acquisition",
        "schema_version": 1,
        "checked_at": now.isoformat(),
        "mode": "HISTORY_ONLY",
        "source_id": SOURCE_ID,
        "maximum_annual_files": 1,
        "publication_performed": False,
        "boundary": BOUNDARY,
    }
    issues = check_preconditions(archive_dir, restore_report, now=now)
    if issues:
        report.update(
            outcome="BLOCKED_PRECONDITION",
            issues=issues,
            delegated=False,
            request_attempt_recorded=False,
        )
        return report, 1

    before = _latest_attempt(archive_dir)
    fetch_next = fetch_next or player_career_archive.main
    argv = [
        "--fetch-next",
        "--archive-dir",
        str(archive_dir),
        "--public-feed",
        str(public_feed),
        "--public-collection-status",
        str(public_collection_status),
        "--output",
        str(attempt_output),
    ]
    captured = io.StringIO()
    error = None
    try:
        with redirect_stdout(captured):
            exit_code = fetch_next(argv)
    except SystemExit as stop:
        exit_code = stop.code if isinstance(stop.code, int) else 1
    except Exception as exc:  # noqa: BLE001 - reported, then propagated as failure
        exit_code = None
        error = f"{type(exc).__name__}: {exc}"
    try:
        after = _latest_attempt(archive_dir)
        recorded = after is not None and (before is None or after > before)
    except Exception:  # noqa: BLE001
        recorded = None
    attempt = None
    if Path(attempt_output).is_file():
        attempt = _parse_json(Path(attempt_output).read_text(encoding="utf-8"))
    plan = _parse_json(captured.getvalue()) if attempt is None else None
    outcome = classify(exit_code, attempt, plan, attempt_recorded=bool(recorded))
    report.update(
        outcome=outcome,
        delegated=True,
        delegated_exit_code=exit_code,
        request_attempt_recorded=recorded,
        attempt={key: attempt[key] for key in _REPORTED_FIELDS if key in attempt}
        if attempt
        else None,
    )
    if plan is not None:
        report["plan"] = {
            key: plan.get(key)
            for key in ("next_year", "next_attempt_at", "can_attempt_now", "public_budget_check")
        }
    if error:
        report["error"] = error
    return report, 0 if outcome in SUCCESS_OUTCOMES else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--archive-dir", type=Path, required=True)
    parser.add_argument("--restore-report", type=Path, required=True)
    parser.add_argument("--attempt-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--public-feed", type=Path, default=player_career_archive.DEFAULT_PUBLIC_FEED
    )
    parser.add_argument(
        "--public-collection-status",
        type=Path,
        default=player_career_archive.DEFAULT_PUBLIC_STATUS,
    )
    args = parser.parse_args(argv)
    for path in (args.report, args.attempt_output):
        if path.exists():
            parser.error(f"refusing to overwrite existing {path}")
    report, code = run(
        archive_dir=args.archive_dir,
        restore_report=args.restore_report,
        attempt_output=args.attempt_output,
        public_feed=args.public_feed,
        public_collection_status=args.public_collection_status,
    )
    text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print(text, end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
