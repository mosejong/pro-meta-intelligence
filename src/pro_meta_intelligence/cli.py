from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.backtest import BacktestHarness
from pro_meta_intelligence.ingestion import load_synthetic_scenario
from pro_meta_intelligence.ingestion.ddragon import DataDragonAdapter
from pro_meta_intelligence.models import BacktestWindow
from pro_meta_intelligence.sources import SnapshotArchive, SourceRegistry
from pro_meta_intelligence.temporal import parse_datetime


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pro-meta")
    subparsers = parser.add_subparsers(dest="command", required=True)
    evaluate = subparsers.add_parser("evaluate", help="run the deterministic fixture backtest")
    evaluate.add_argument("--cutoff", help="ISO-8601 cutoff; fixture default if omitted")
    evaluate.add_argument("--evaluation-start", help="ISO-8601 outcome window start")
    evaluate.add_argument("--evaluation-end", help="ISO-8601 outcome window end")
    evaluate.add_argument("--top-k", type=int, help="candidate review budget")
    evaluate.add_argument("--output", type=Path, help="optional JSON output path")

    sources = subparsers.add_parser("sources", help="show external-source policy status")
    sources.add_argument("--registry", type=Path, help="optional source registry JSON")
    sources.add_argument("--output", type=Path, help="optional JSON output path")

    ddragon = subparsers.add_parser(
        "fetch-ddragon", help="fetch and archive a policy-approved Data Dragon catalog"
    )
    ddragon.add_argument("--version", default="latest", help="Data Dragon version or latest")
    ddragon.add_argument("--locale", default="en_US", help="Data Dragon locale")
    ddragon.add_argument(
        "--release-at",
        help="optional verified patch release timestamp used to normalize the raw catalog",
    )
    ddragon.add_argument("--registry", type=Path, help="optional source registry JSON")
    ddragon.add_argument(
        "--archive-dir", type=Path, default=Path("outputs/ddragon"), help="raw archive root"
    )
    ddragon.add_argument("--output", type=Path, help="optional JSON summary path")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "evaluate":
        return _evaluate(args)
    if args.command == "sources":
        return _sources(args)
    if args.command == "fetch-ddragon":
        return _fetch_ddragon(args)
    raise AssertionError("unreachable command")


def _evaluate(args: argparse.Namespace) -> int:
    scenario = load_synthetic_scenario()
    default = scenario.window
    window = BacktestWindow(
        cutoff=parse_datetime(args.cutoff) if args.cutoff else default.cutoff,
        evaluation_start=(
            parse_datetime(args.evaluation_start)
            if args.evaluation_start
            else default.evaluation_start
        ),
        evaluation_end=(
            parse_datetime(args.evaluation_end) if args.evaluation_end else default.evaluation_end
        ),
        top_k=args.top_k if args.top_k is not None else default.top_k,
    )
    _emit(BacktestHarness().run(scenario, window).to_json(), args.output)
    return 0


def _sources(args: argparse.Namespace) -> int:
    registry = _load_registry(args.registry)
    now = datetime.now(UTC)
    payload = {
        "schema_version": "1",
        "evaluated_at": now.isoformat(),
        "sources": [registration.to_dict(now) for registration in registry.registrations()],
    }
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    return 0


def _fetch_ddragon(args: argparse.Namespace) -> int:
    registry = _load_registry(args.registry)
    adapter = DataDragonAdapter(registry)
    archive = SnapshotArchive(args.archive_dir)
    version_artifact = None
    version = args.version
    if version == "latest":
        versions = adapter.fetch_versions()
        version = versions.versions[0]
        version_artifact = archive.store(versions.artifact)
    catalog = adapter.fetch_champion_catalog(version, args.locale)
    catalog_artifact = archive.store(catalog.artifact)
    payload: dict[str, object] = {
        "schema_version": "1",
        "source_id": adapter.source_id,
        "version": version,
        "locale": args.locale,
        "champion_count": len(catalog.champions),
        "raw_content_hash": catalog.artifact.content_hash,
        "raw_data_path": str(catalog_artifact.data_path),
        "raw_metadata_path": str(catalog_artifact.metadata_path),
        "normalized": False,
    }
    if version_artifact is not None:
        payload["version_index_content_hash"] = version_artifact.content_hash
    if args.release_at:
        snapshot = catalog.to_snapshot(release_at=parse_datetime(args.release_at))
        payload.update(
            {
                "normalized": True,
                "observed_at": snapshot.observed_at.isoformat(),
                "available_at": snapshot.available_at.isoformat(),
                "provenance_source_id": snapshot.provenance.source_id,
            }
        )
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    return 0


def _load_registry(path: Path | None) -> SourceRegistry:
    return SourceRegistry.from_json(path) if path else SourceRegistry.load_default()


def _emit(output: str, destination: Path | None) -> None:
    if destination:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
