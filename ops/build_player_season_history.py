"""Rebuild the public player season history from an archived, approved OE CSV (no network).

The CSV must match its archive metadata (file name, byte length, SHA-256). The original
retrieval time from the metadata is kept as the availability time; it is never replaced by a new
acquisition time. The output is written to a temporary file, validated, then swapped in, so any
failure leaves the previously accepted derived file untouched.

With ``--archive-dir`` the CSV is chosen automatically: only the verified archive snapshot whose
hash, retrieval time and version exactly match the accepted feed's import report is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import SOURCE_ID, OracleElixirCSVAdapter
from pro_meta_intelligence.opponent.player_season import (
    ARTIFACT_TYPE,
    SCHEMA_VERSION,
    build_player_season_history,
    roster_basis_from_feed,
    roster_references_from_feed,
)
from pro_meta_intelligence.sources import ArchivedSnapshot, SnapshotArchive, SourceRegistry

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "outputs" / "oracles-elixir" / "raw" / SOURCE_ID
DEFAULT_HASH = "fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de"
DEFAULT_CSV = RAW_DIR / f"{DEFAULT_HASH}.csv"
DEFAULT_META = RAW_DIR / f"{DEFAULT_HASH}.20261111T021929155420Z.meta.json"
DEFAULT_FEED = ROOT / "web" / "public" / "feed" / "current.json"
DEFAULT_OUTPUT = ROOT / "web" / "public" / "history" / "player-season-2026.json"
MAX_OUTPUT_BYTES = 3 * 1024 * 1024


def _sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return f"sha256:{digest.hexdigest()}", size


def verify_archive(csv_path: Path, meta_path: Path) -> dict[str, object]:
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("source_id") != SOURCE_ID:
        raise ValueError("archive metadata is for a different source")
    if meta.get("data_file") != csv_path.name:
        raise ValueError("archive metadata does not describe this CSV file")
    content_hash, size = _sha256(csv_path)
    if meta.get("content_hash") != content_hash:
        raise ValueError("CSV hash does not match archive metadata")
    if meta.get("byte_length") != size:
        raise ValueError("CSV byte length does not match archive metadata")
    if csv_path.stem != content_hash.removeprefix("sha256:"):
        raise ValueError("CSV file name does not match its content hash")
    retrieved_at = datetime.fromisoformat(str(meta["retrieved_at"]))
    if retrieved_at.tzinfo is None:
        raise ValueError("archive retrieval time must be timezone-aware")
    return {"content_hash": content_hash, "retrieved_at": retrieved_at}


def validate_output(text: str, *, season: int, basis: dict[str, object]) -> None:
    if len(text.encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ValueError("derived history exceeds the 3MB public budget")
    value = json.loads(text)
    if value.get("artifact_type") != ARTIFACT_TYPE or value.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("derived history has an unexpected type or version")
    if value.get("season") != season or value.get("roster_basis") != basis:
        raise ValueError("derived history does not match the requested season or roster basis")
    if not value.get("players"):
        raise ValueError("derived history has no players")


def select_accepted_snapshot(
    feed: dict[str, object], archive_dir: Path, *, now: datetime | None = None
) -> ArchivedSnapshot:
    """Return exactly the verified archive snapshot the accepted feed was built from.

    Never falls back to the newest, a rejected, or a differently-timed snapshot.
    """

    report = (feed.get("input") or {}).get("import_report") or {}  # type: ignore[union-attr]
    if report.get("source_id") != SOURCE_ID:
        raise ValueError("accepted feed source is not the OE match data source")
    content_hash = report.get("content_hash")
    source_version = report.get("source_version")
    if not isinstance(content_hash, str) or not isinstance(source_version, str):
        raise ValueError("accepted feed is missing its source hash or version")
    retrieved_at = datetime.fromisoformat(str(report.get("retrieved_at")))
    if retrieved_at.tzinfo is None:
        raise ValueError("accepted feed retrieval time must be timezone-aware")
    if retrieved_at > (now or datetime.now(UTC)):
        raise ValueError("accepted feed source was retrieved in the future")
    evidence = [
        item
        for item in ((feed.get("evidence_index") or {}).get("source_versions") or [])  # type: ignore[union-attr]
        if item.get("source_id") == SOURCE_ID
    ]
    if evidence and not any(
        item.get("content_hash") == content_hash and item.get("source_version") == source_version
        for item in evidence
    ):
        raise ValueError("accepted feed evidence index does not cite its import source")
    inspection = SnapshotArchive(archive_dir).inspect(SOURCE_ID)
    if inspection.issues:
        codes = ", ".join(sorted({issue.code for issue in inspection.issues}))
        raise ValueError(f"archive integrity issues: {codes}")
    matches = [
        snapshot
        for snapshot in inspection.snapshots
        if snapshot.content_hash == content_hash and snapshot.retrieved_at == retrieved_at
    ]
    if len(matches) != 1:
        raise ValueError("accepted feed source not found exactly once in verified archive")
    return matches[0]


def ensure_not_regressing(output: Path, feed: dict[str, object], retrieved_at: datetime) -> None:
    """Automatic refresh never moves the published cutoff or source time backwards."""

    if not output.exists():
        return
    previous = json.loads(output.read_text(encoding="utf-8"))
    previous_cutoff = datetime.fromisoformat(str(previous["cutoff"]))
    previous_retrieved = datetime.fromisoformat(str(previous["source"]["retrieved_at"]))
    if datetime.fromisoformat(str(feed["cutoff"])) < previous_cutoff:
        raise ValueError("accepted feed cutoff is older than the published season history")
    if retrieved_at < previous_retrieved:
        raise ValueError("accepted feed source is older than the published season history")


def build_from_archive(
    archive_dir: Path,
    feed_path: Path,
    output: Path,
    *,
    season: int,
    now: datetime | None = None,
) -> dict[str, object]:
    feed = json.loads(feed_path.read_text(encoding="utf-8"))
    snapshot = select_accepted_snapshot(feed, archive_dir, now=now)
    ensure_not_regressing(output, feed, snapshot.retrieved_at)
    report = feed["input"]["import_report"]
    return build(
        snapshot.data_path,
        snapshot.metadata_path,
        feed_path,
        output,
        season=season,
        expected_source_version=report["source_version"],
        expected_retrieved_at=snapshot.retrieved_at,
    )


def build(
    csv_path: Path,
    meta_path: Path,
    feed_path: Path,
    output: Path,
    *,
    season: int,
    expected_source_version: str | None = None,
    expected_retrieved_at: datetime | None = None,
) -> dict[str, object]:
    archive = verify_archive(csv_path, meta_path)
    if expected_retrieved_at is not None and archive["retrieved_at"] != expected_retrieved_at:
        raise ValueError("archive retrieval time differs from the accepted feed source")
    retrieved_at = archive["retrieved_at"]
    assert isinstance(retrieved_at, datetime)
    feed = json.loads(feed_path.read_text(encoding="utf-8"))
    basis = roster_basis_from_feed(feed)
    cutoff = datetime.fromisoformat(basis["cutoff"])
    if retrieved_at > cutoff:
        raise ValueError("archived source was retrieved after the roster cutoff")
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        csv_path, retrieved_at=retrieved_at, source_timezone="UTC", issue_detail_limit=0
    )
    if imported.report.content_hash != archive["content_hash"]:
        raise ValueError("adapter hash differs from archive metadata")
    if (
        expected_source_version is not None
        and imported.report.source_version != expected_source_version
    ):
        raise ValueError("adapter source version differs from the accepted feed source")
    history = build_player_season_history(
        imported.matches,
        imported.draft_events,
        roster_references_from_feed(feed),
        season=season,
        cutoff=cutoff,
        roster_basis=basis,
        source={
            "source_id": SOURCE_ID,
            "source_version": imported.report.source_version,
            "content_hash": imported.report.content_hash,
            "retrieved_at": retrieved_at.isoformat(),
        },
        import_report=imported.report.to_dict(),
    )
    text = json.dumps(history, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    validate_output(text, season=season, basis=basis)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".player-season-", suffix=".json", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        validate_output(Path(temp_name).read_text(encoding="utf-8"), season=season, basis=basis)
        os.replace(temp_name, output)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise
    summary = history["import_summary"]
    return {
        "status": "BUILT",
        "output": str(output),
        "bytes": len(text.encode("utf-8")),
        "players": history["player_count"],
        "found": sum(1 for player in history["players"] if player["status"] == "FOUND"),
        "season_accepted_game_count": summary["season_accepted_game_count"],
        "accepted_game_count": summary["accepted_game_count"],
        "rejected_game_count": summary["rejected_game_count"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--meta", type=Path)
    parser.add_argument(
        "--archive-dir",
        type=Path,
        help="Verified SnapshotArchive root; uses exactly the accepted feed's source snapshot.",
    )
    parser.add_argument("--feed", type=Path, default=DEFAULT_FEED)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args(argv)
    if args.archive_dir is not None:
        if args.csv is not None or args.meta is not None:
            parser.error("--archive-dir cannot be combined with --csv/--meta")
        result = build_from_archive(args.archive_dir, args.feed, args.output, season=args.season)
    else:
        result = build(
            args.csv or DEFAULT_CSV,
            args.meta or DEFAULT_META,
            args.feed,
            args.output,
            season=args.season,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
