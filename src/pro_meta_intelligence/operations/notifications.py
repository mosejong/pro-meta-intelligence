"""Keep operational health separate from repeated Actions email notifications."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def is_repeated_incident(report: dict, previous_body: str) -> bool:
    """Suppress only a complete unhealthy assessment already in an open incident."""

    failed = report.get("failed_checks")
    if (
        report.get("status") != "UNHEALTHY"
        or report.get("healthy") is not False
        or not isinstance(failed, list)
        or not failed
        or not all(isinstance(item, str) and item for item in failed)
    ):
        return False
    lines = previous_body.splitlines()
    statuses = [line.removeprefix("- Status: ") for line in lines if line.startswith("- Status: ")]
    checks = [
        line.removeprefix("- Failed checks: ")
        for line in lines
        if line.startswith("- Failed checks: ")
    ]
    return (
        statuses == ["UNHEALTHY"] and len(checks) == 1 and set(checks[0].split(", ")) == set(failed)
    )


def is_source_delay_only(sync: dict, health: dict, collection: dict) -> bool:
    """The public watchdog owns source-freshness alerts after an accepted cache publish."""

    result = sync.get("result", {})
    if not isinstance(result, dict):
        return False
    acquisition = result.get("source_acquisition", {})
    return (
        sync.get("status") == "SUCCEEDED"
        and type(sync.get("exit_code")) is int
        and sync["exit_code"] == 0
        and result.get("status") == "PUBLISHED"
        and isinstance(acquisition, dict)
        and acquisition.get("status")
        in {"REUSED_CACHE_AFTER_SOURCE_ERROR", "REUSED_CACHE_DURING_SOURCE_BACKOFF"}
        and health.get("status") == "UNHEALTHY"
        and health.get("healthy") is False
        and health.get("failed_checks") == ["SOURCE_SNAPSHOT_FRESHNESS"]
        and collection.get("state") == "SOURCE_DELAYED"
    )


def _read_report(path: str) -> dict:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("notification policy requires a JSON object")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    watchdog = commands.add_parser("watchdog")
    watchdog.add_argument("report")
    watchdog.add_argument("previous_body")
    collector = commands.add_parser("collector")
    collector.add_argument("sync")
    collector.add_argument("health")
    collector.add_argument("collection")
    args = parser.parse_args()
    if args.command == "watchdog":
        quiet = is_repeated_incident(
            _read_report(args.report), Path(args.previous_body).read_text(encoding="utf-8")
        )
    else:
        quiet = is_source_delay_only(
            _read_report(args.sync), _read_report(args.health), _read_report(args.collection)
        )
    print("true" if quiet else "false")


if __name__ == "__main__":
    main()
