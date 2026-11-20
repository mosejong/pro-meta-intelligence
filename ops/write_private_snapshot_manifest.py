"""Export only the approved three-field snapshot manifest from a private restore report.

Approved scope (2026-11-20): each exported entry carries exactly ``content_hash``,
``retrieved_at`` and ``byte_length``. Nothing else from the report ever leaves through this
file: no outer report fields, raw rows, player data, secrets, provider URLs, local paths or
request-ledger contents. Standard library only; no network access and no data fetching.

Usage:
    python ops/write_private_snapshot_manifest.py --report <restore-report.json> \
        --output <snapshot-manifest.json>

Any malformed or missing metadata fails closed with exit code 1, prints no report values, and
leaves an existing output file unchanged.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

APPROVED_FIELDS = ("content_hash", "retrieved_at", "byte_length")
CONTENT_HASH_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
MAX_REPORT_BYTES = 16 * 1024 * 1024
MAX_ENTRIES = 4096


class ManifestError(ValueError):
    """Raised when report metadata cannot be exported safely. Messages never carry values."""


def build_manifest(report: Any) -> list[dict[str, Any]]:
    """Validate a parsed restore report and return the sorted three-field entries."""

    if not isinstance(report, dict):
        raise ManifestError("report must be a JSON object")
    if "snapshots" not in report:
        raise ManifestError("report has no snapshots list")
    snapshots = report["snapshots"]
    if not isinstance(snapshots, list):
        raise ManifestError("report snapshots must be a list")
    if not snapshots:
        raise ManifestError("report snapshots list is empty")
    if len(snapshots) > MAX_ENTRIES:
        raise ManifestError("report snapshots list exceeds the bounded entry limit")

    entries: list[tuple[datetime, str, int]] = []
    for index, entry in enumerate(snapshots):
        entries.append(_validated_entry(index, entry))

    receipts: set[tuple[datetime, str]] = set()
    lengths: dict[str, int] = {}
    for retrieved_at, content_hash, byte_length in entries:
        receipt = (retrieved_at, content_hash)
        if receipt in receipts:
            raise ManifestError("report repeats one retrieval receipt")
        receipts.add(receipt)
        if lengths.setdefault(content_hash, byte_length) != byte_length:
            raise ManifestError("report gives one content hash two byte lengths")

    # The outer counts are only cross-checked here; they are never exported.
    _require_count(report, "snapshot_count", len(entries))
    _require_count(report, "unique_content_count", len(lengths))

    entries.sort(key=lambda item: (item[0], item[1]))
    return [
        {
            "content_hash": content_hash,
            "retrieved_at": retrieved_at.isoformat(),
            "byte_length": byte_length,
        }
        for retrieved_at, content_hash, byte_length in entries
    ]


def _validated_entry(index: int, entry: Any) -> tuple[datetime, str, int]:
    if not isinstance(entry, dict):
        raise ManifestError(f"snapshot entry {index} must be an object")
    if set(entry) != set(APPROVED_FIELDS):
        raise ManifestError(f"snapshot entry {index} must have exactly the approved fields")

    content_hash = entry["content_hash"]
    if not isinstance(content_hash, str) or not CONTENT_HASH_PATTERN.fullmatch(content_hash):
        raise ManifestError(f"snapshot entry {index} has an invalid content_hash")

    raw_time = entry["retrieved_at"]
    if not isinstance(raw_time, str):
        raise ManifestError(f"snapshot entry {index} has an invalid retrieved_at")
    try:
        retrieved_at = datetime.fromisoformat(raw_time)
    except ValueError:
        raise ManifestError(f"snapshot entry {index} has an invalid retrieved_at") from None
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() != timedelta(0):
        raise ManifestError(f"snapshot entry {index} retrieved_at must be timezone-aware UTC")
    retrieved_at = retrieved_at.astimezone(UTC)

    byte_length = entry["byte_length"]
    if type(byte_length) is not int or byte_length < 0:
        raise ManifestError(f"snapshot entry {index} has an invalid byte_length")
    return retrieved_at, content_hash, byte_length


def _require_count(report: dict[str, Any], field: str, actual: int) -> None:
    if field not in report:
        return
    expected = report[field]
    if type(expected) is not int or expected != actual:
        raise ManifestError(f"report {field} does not match the snapshots list")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ManifestError("report contains a duplicated JSON key")
        result[key] = value
    return result


def _reject_constant(_name: str) -> Any:
    raise ManifestError("report contains a non-standard JSON constant")


def load_report(path: Path) -> Any:
    if not path.is_file():
        raise ManifestError("report file is missing")
    if path.stat().st_size > MAX_REPORT_BYTES:
        raise ManifestError("report file exceeds the bounded size limit")
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ManifestError("report is not valid UTF-8 JSON") from None


def write_manifest(report_path: Path, output_path: Path) -> list[dict[str, Any]]:
    """Validate first, then atomically replace the output. Failures leave it untouched."""

    if output_path.resolve() == report_path.resolve():
        raise ManifestError("output must not be the input report")
    if output_path.exists() and report_path.exists() and output_path.samefile(report_path):
        raise ManifestError("output must not be the input report")
    manifest = build_manifest(load_report(report_path))
    payload = (json.dumps(manifest, ensure_ascii=True, indent=2) + "\n").encode("ascii")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.", dir=output_path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)
    return manifest


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export only content_hash, retrieved_at and byte_length per snapshot."
    )
    parser.add_argument("--report", type=Path, required=True, help="existing restore report")
    parser.add_argument("--output", type=Path, required=True, help="three-field manifest path")
    args = parser.parse_args(argv)
    try:
        manifest = write_manifest(args.report, args.output)
    except (ManifestError, OSError) as error:
        # ManifestError messages never contain report values; OSError is reduced to its type.
        reason = str(error) if isinstance(error, ManifestError) else type(error).__name__
        print(f"snapshot manifest rejected: {reason}", file=sys.stderr)
        return 1
    print(f"snapshot manifest written: {len(manifest)} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
