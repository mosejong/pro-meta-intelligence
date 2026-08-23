from __future__ import annotations

import argparse
import json
import platform
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from pro_meta_intelligence.backtest import (
    BacktestHarness,
    OEBlindSpotConfig,
    benchmark_oe_blind_spots,
)
from pro_meta_intelligence.creator import CreatorBriefBuilder
from pro_meta_intelligence.ingestion import load_synthetic_scenario
from pro_meta_intelligence.ingestion.ddragon import DataDragonAdapter
from pro_meta_intelligence.ingestion.oe_download import (
    OracleElixirDownloadError,
    OracleElixirDownloadIntervalError,
    OracleElixirPublishedDownloadAdapter,
)
from pro_meta_intelligence.ingestion.oracles_elixir import (
    OracleElixirCSVAdapter,
    OracleElixirImport,
)
from pro_meta_intelligence.models import BacktestWindow, DraftAction
from pro_meta_intelligence.opponent import OpponentPrepBuilder, OpponentPrepConfig
from pro_meta_intelligence.publishing import (
    FeedJobAlreadyRunning,
    FeedJobOperationResult,
    FeedJobRunner,
    SnapshotFeedPublisher,
)
from pro_meta_intelligence.quality import (
    OECoverageCriteria,
    OEHistoryCriteria,
    audit_oe_coverage,
    audit_oe_history,
)
from pro_meta_intelligence.radar import LeagueRegionMap, MetaRadar, MetaRadarConfig
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

    oe_import = subparsers.add_parser(
        "import-oe", help="validate and normalize a local Oracle's Elixir CSV snapshot"
    )
    oe_import.add_argument("--input", type=Path, required=True, help="provider-published CSV file")
    oe_import.add_argument(
        "--source-timezone",
        required=True,
        help="UTC, fixed offset, or installed IANA zone for the timezone-naive date column",
    )
    oe_import.add_argument(
        "--retrieved-at",
        help="snapshot retrieval time; defaults to current UTC time",
    )
    oe_import.add_argument(
        "--source-uri",
        help="optional durable public source URL; local absolute paths are never emitted",
    )
    oe_import.add_argument("--registry", type=Path, help="optional source registry JSON")
    oe_import.add_argument(
        "--fail-on-rejected",
        action="store_true",
        help="return exit code 2 when one or more import issues are reported",
    )
    oe_import.add_argument("--output", type=Path, help="optional JSON import report path")

    oe_fetch = subparsers.add_parser(
        "fetch-oe",
        help="download one explicitly reviewed Oracle's Elixir annual CSV",
    )
    oe_fetch.add_argument("--year", type=int, default=datetime.now(UTC).year)
    oe_fetch.add_argument("--registry", type=Path, help="optional source registry JSON")
    oe_fetch.add_argument(
        "--archive-dir",
        type=Path,
        default=Path("outputs/oracles-elixir/raw"),
        help="content-addressed raw archive root",
    )
    oe_fetch.add_argument("--output", type=Path, help="optional JSON summary path")

    oe_audit = subparsers.add_parser(
        "audit-oe-coverage",
        help="measure annual and patch coverage before Meta Radar publication",
    )
    oe_audit.add_argument("--input", type=Path, required=True)
    oe_audit.add_argument("--source-timezone", required=True)
    oe_audit.add_argument("--retrieved-at", help="snapshot retrieval time; defaults to current UTC")
    oe_audit.add_argument("--source-uri", help="optional registered provider HTTPS source URL")
    oe_audit.add_argument("--registry", type=Path, help="optional source registry JSON")
    oe_audit.add_argument("--region-map", type=Path, help="optional league-to-region JSON mapping")
    oe_audit.add_argument("--patch", help="patch to evaluate; latest observed patch if omitted")
    _add_readiness_arguments(oe_audit)
    oe_audit.add_argument("--output", type=Path, help="optional JSON coverage audit path")

    oe_history = subparsers.add_parser(
        "audit-oe-history",
        help="verify archived OE snapshots and measure historical backtest readiness",
    )
    oe_history.add_argument("--source-timezone", required=True)
    oe_history.add_argument("--registry", type=Path, help="optional source registry JSON")
    oe_history.add_argument(
        "--archive-dir",
        type=Path,
        default=Path("outputs/oracles-elixir/raw"),
    )
    oe_history.add_argument("--minimum-retrievals", type=int, default=14)
    oe_history.add_argument("--minimum-unique-states", type=int, default=3)
    oe_history.add_argument("--minimum-collection-span-days", type=int, default=14)
    oe_history.add_argument("--maximum-gap-hours", type=int, default=48)
    oe_history.add_argument("--outcome-horizon-days", type=int, default=7)
    oe_history.add_argument("--minimum-matured-cutoffs", type=int, default=2)
    oe_history.add_argument("--output", type=Path, help="optional JSON history audit path")

    blind_spot = subparsers.add_parser(
        "benchmark-oe-history",
        help="run a leakage-safe Blind Spot Benchmark over matured OE archive cutoffs",
    )
    blind_spot.add_argument("--source-timezone", required=True)
    blind_spot.add_argument("--registry", type=Path, help="optional source registry JSON")
    blind_spot.add_argument("--region-map", type=Path, help="optional league-to-region JSON")
    blind_spot.add_argument("--archive-dir", type=Path, default=Path("outputs/oracles-elixir/raw"))
    blind_spot.add_argument("--minimum-retrievals", type=int, default=14)
    blind_spot.add_argument("--minimum-unique-states", type=int, default=3)
    blind_spot.add_argument("--minimum-collection-span-days", type=int, default=14)
    blind_spot.add_argument("--maximum-gap-hours", type=int, default=48)
    blind_spot.add_argument("--outcome-horizon-days", type=int, default=7)
    blind_spot.add_argument("--minimum-matured-cutoffs", type=int, default=2)
    blind_spot.add_argument("--top-k", type=int, default=10)
    blind_spot.add_argument("--minimum-future-picks", type=int, default=2)
    blind_spot.add_argument("--minimum-future-distinct-teams", type=int, default=2)
    blind_spot.add_argument("--maximum-pre-cutoff-presence", type=float, default=0.1)
    blind_spot.add_argument(
        "--patch", help="optional fixed patch; latest at each cutoff if omitted"
    )
    blind_spot.add_argument("--recent-days", type=int, default=7)
    blind_spot.add_argument("--prior-days", type=int, default=7)
    blind_spot.add_argument("--minimum-recent-matches", type=int, default=5)
    blind_spot.add_argument("--minimum-prior-matches", type=int, default=5)
    blind_spot.add_argument("--minimum-region-matches", type=int, default=3)
    blind_spot.add_argument("--minimum-current-picks", type=int, default=2)
    blind_spot.add_argument("--output", type=Path, help="optional JSON benchmark report path")

    oe_sync = subparsers.add_parser(
        "sync-oe-feed",
        help="fetch or reuse the reviewed OE CSV and publish an audited Meta Radar feed",
    )
    oe_sync.add_argument("--year", type=int, default=datetime.now(UTC).year)
    oe_sync.add_argument("--source-timezone", required=True)
    oe_sync.add_argument("--registry", type=Path, help="optional source registry JSON")
    oe_sync.add_argument("--region-map", type=Path, help="optional league-to-region JSON mapping")
    oe_sync.add_argument("--archive-dir", type=Path, default=Path("outputs/oracles-elixir/raw"))
    oe_sync.add_argument("--feed-dir", type=Path, default=Path("web/public/feed"))
    oe_sync.add_argument("--run-dir", type=Path, default=Path("outputs/oe-feed-jobs"))
    oe_sync.add_argument("--patch", help="patch ID; latest available match patch if omitted")
    oe_sync.add_argument("--cutoff", help="analysis cutoff; defaults to source retrieval time")
    oe_sync.add_argument("--recent-days", type=int, default=7)
    oe_sync.add_argument("--prior-days", type=int, default=7)
    oe_sync.add_argument("--minimum-recent-matches", type=int, default=5)
    oe_sync.add_argument("--minimum-prior-matches", type=int, default=5)
    oe_sync.add_argument("--minimum-region-matches", type=int, default=3)
    oe_sync.add_argument("--minimum-current-picks", type=int, default=2)
    _add_readiness_arguments(oe_sync)
    oe_sync.add_argument("--creator-top-k", type=int, default=3)
    oe_sync.add_argument("--max-index-entries", type=int, default=50)
    oe_sync.add_argument("--output", type=Path, help="optional audited sync summary path")

    radar = subparsers.add_parser(
        "build-radar", help="build an explainable patch-level Meta Radar from a local OE CSV"
    )
    _add_radar_arguments(radar)
    radar.add_argument("--output", type=Path, help="optional JSON radar report path")

    benchmark = subparsers.add_parser(
        "benchmark-oe",
        help="measure the local OE import and Meta Radar pipeline without publishing raw data",
    )
    _add_radar_arguments(benchmark)
    benchmark.add_argument(
        "--radar-output", type=Path, help="optional generated Meta Radar JSON path"
    )
    benchmark.add_argument("--output", type=Path, help="optional benchmark summary path")

    creator = subparsers.add_parser(
        "build-creator-brief",
        help="turn an approved Meta Radar JSON report into a claim-locked Creator brief",
    )
    creator.add_argument("--radar", type=Path, required=True, help="Meta Radar JSON report")
    creator.add_argument("--top-k", type=int, default=3, help="maximum eligible topic candidates")
    creator.add_argument("--output", type=Path, help="optional JSON Creator brief path")

    refresh = subparsers.add_parser(
        "refresh-feed",
        help="build radar and Creator snapshots and atomically advance a local feed",
    )
    _add_radar_arguments(refresh)
    refresh.add_argument(
        "--feed-dir",
        type=Path,
        default=Path("outputs/meta-radar-feed"),
        help="snapshot feed root",
    )
    refresh.add_argument("--creator-top-k", type=int, default=3)
    refresh.add_argument("--max-index-entries", type=int, default=50)
    refresh.add_argument("--published-at", help="explicit publication timestamp; defaults to now")
    refresh.add_argument("--output", type=Path, help="optional refresh summary path")

    job = subparsers.add_parser(
        "run-feed-job",
        help="run a configured local feed refresh with a single-writer lock and audit record",
    )
    job.add_argument("--config", type=Path, required=True, help="feed job JSON config")
    job.add_argument("--output", type=Path, help="optional job audit summary path")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "evaluate":
        return _evaluate(args)
    if args.command == "sources":
        return _sources(args)
    if args.command == "fetch-ddragon":
        return _fetch_ddragon(args)
    if args.command == "import-oe":
        return _import_oe(args)
    if args.command == "fetch-oe":
        return _fetch_oe(args)
    if args.command == "audit-oe-coverage":
        return _audit_oe(args)
    if args.command == "audit-oe-history":
        return _audit_oe_history(args)
    if args.command == "benchmark-oe-history":
        return _benchmark_oe_history(args)
    if args.command == "sync-oe-feed":
        return _sync_oe_feed(args)
    if args.command == "build-radar":
        return _build_radar(args)
    if args.command == "benchmark-oe":
        return _benchmark_oe(args)
    if args.command == "build-creator-brief":
        return _build_creator_brief(args)
    if args.command == "refresh-feed":
        return _refresh_feed(args)
    if args.command == "run-feed-job":
        return _run_feed_job(args)
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


def _import_oe(args: argparse.Namespace) -> int:
    retrieved_at = parse_datetime(args.retrieved_at) if args.retrieved_at else datetime.now(UTC)
    imported = OracleElixirCSVAdapter(_load_registry(args.registry)).import_file(
        args.input,
        retrieved_at=retrieved_at,
        source_timezone=args.source_timezone,
        source_uri=args.source_uri,
    )
    observed = [match.observed_at for match in imported.matches]
    payload = {
        "schema_version": "1",
        "input_authenticity": "UNVERIFIED_CALLER_SUPPLIED_FILE",
        "network_collection_performed": False,
        "normalization": {
            "match_count": len(imported.matches),
            "pick_event_count": sum(
                event.action is DraftAction.PICK for event in imported.draft_events
            ),
            "ban_event_count": sum(
                event.action is DraftAction.BAN for event in imported.draft_events
            ),
            "league_counts": dict(
                sorted(Counter(match.league for match in imported.matches).items())
            ),
            "patch_counts": dict(
                sorted(Counter(match.patch_id for match in imported.matches).items())
            ),
            "first_observed_at": min(observed).isoformat() if observed else None,
            "last_observed_at": max(observed).isoformat() if observed else None,
            "available_at": retrieved_at.isoformat(),
        },
        "import_report": imported.report.to_dict(),
        "limitations": [
            "current annual snapshots are unavailable to historical cutoffs before retrieved_at",
            (
                "series_id is a game-scoped placeholder because the CSV has no stable "
                "series identifier"
            ),
            "ban events are not normalized because bans do not have reliable role assignments",
        ],
    }
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    if args.fail_on_rejected and imported.report.issue_counts:
        return 2
    return 0


def _fetch_oe(args: argparse.Namespace) -> int:
    archive = SnapshotArchive(args.archive_dir)
    adapter = OracleElixirPublishedDownloadAdapter(_load_registry(args.registry))
    last_retrieved_at = archive.latest_retrieved_at(adapter.source_id)
    try:
        downloaded = adapter.fetch_year(args.year, last_retrieved_at=last_retrieved_at)
    except OracleElixirDownloadIntervalError as error:
        payload = {
            "schema_version": "1",
            "status": "RATE_LIMITED",
            "network_collection_performed": False,
            "retry_at": error.retry_at.isoformat(),
        }
        _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
        return 3
    except OracleElixirDownloadError as error:
        payload = {
            "schema_version": "1",
            "status": "SOURCE_UNAVAILABLE",
            "network_collection_performed": True,
            "error": str(error),
        }
        _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
        return 4
    archived = archive.store(downloaded.artifact)
    payload = {
        "schema_version": "1",
        "status": "DOWNLOADED",
        "source_id": adapter.source_id,
        "year": downloaded.file.year,
        "filename": downloaded.file.filename,
        "network_collection_performed": True,
        "retrieved_at": downloaded.artifact.retrieved_at.isoformat(),
        "content_hash": downloaded.artifact.content_hash,
        "byte_length": len(downloaded.artifact.body),
        "raw_data_path": str(archived.data_path),
        "raw_metadata_path": str(archived.metadata_path),
        "raw_redistribution_allowed": False,
    }
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    return 0


def _audit_oe(args: argparse.Namespace) -> int:
    imported = _load_oe_import(args)
    audit = audit_oe_coverage(
        imported,
        _load_league_regions(args.region_map),
        _readiness_criteria(args),
    )
    _emit(
        json.dumps(audit.to_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        args.output,
    )
    return 0 if audit.ready_for_radar else 2


def _audit_oe_history(args: argparse.Namespace) -> int:
    archive = SnapshotArchive(args.archive_dir)
    source_id = OracleElixirPublishedDownloadAdapter.source_id
    audit = audit_oe_history(
        archive.inspect(source_id),
        _load_registry(args.registry),
        source_timezone=args.source_timezone,
        criteria=OEHistoryCriteria(
            minimum_retrievals=args.minimum_retrievals,
            minimum_unique_states=args.minimum_unique_states,
            minimum_collection_span_days=args.minimum_collection_span_days,
            maximum_gap_hours=args.maximum_gap_hours,
            outcome_horizon_days=args.outcome_horizon_days,
            minimum_matured_cutoffs=args.minimum_matured_cutoffs,
        ),
    )
    _emit(
        json.dumps(audit.to_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        args.output,
    )
    return 0 if audit.ready_for_historical_backtest else 2


def _benchmark_oe_history(args: argparse.Namespace) -> int:
    archive = SnapshotArchive(args.archive_dir)
    source_id = OracleElixirPublishedDownloadAdapter.source_id
    report = benchmark_oe_blind_spots(
        archive.inspect(source_id),
        _load_registry(args.registry),
        source_timezone=args.source_timezone,
        history_criteria=OEHistoryCriteria(
            minimum_retrievals=args.minimum_retrievals,
            minimum_unique_states=args.minimum_unique_states,
            minimum_collection_span_days=args.minimum_collection_span_days,
            maximum_gap_hours=args.maximum_gap_hours,
            outcome_horizon_days=args.outcome_horizon_days,
            minimum_matured_cutoffs=args.minimum_matured_cutoffs,
        ),
        config=OEBlindSpotConfig(
            top_k=args.top_k,
            minimum_future_picks=args.minimum_future_picks,
            minimum_future_distinct_teams=args.minimum_future_distinct_teams,
            maximum_pre_cutoff_presence=args.maximum_pre_cutoff_presence,
            patch_id=args.patch,
            recent_window_days=args.recent_days,
            prior_window_days=args.prior_days,
            minimum_recent_matches=args.minimum_recent_matches,
            minimum_prior_matches=args.minimum_prior_matches,
            minimum_region_matches=args.minimum_region_matches,
            minimum_current_picks=args.minimum_current_picks,
        ),
        league_regions=_load_league_regions(args.region_map),
    )
    _emit(report.to_json(), args.output)
    return 0 if report.benchmark_ready else 2


def _sync_oe_feed(args: argparse.Namespace) -> int:
    runner = FeedJobRunner(args.run_dir)

    def operation() -> FeedJobOperationResult:
        archive = SnapshotArchive(args.archive_dir)
        adapter = OracleElixirPublishedDownloadAdapter(_load_registry(args.registry))
        latest = archive.latest(adapter.source_id)
        network_attempted = False
        acquisition_status: str
        acquisition_error: str | None = None
        try:
            downloaded = adapter.fetch_year(
                args.year,
                last_retrieved_at=latest.retrieved_at if latest else None,
            )
            network_attempted = True
            archived = archive.store(downloaded.artifact)
            latest = archive.latest(adapter.source_id)
            if latest is None:  # pragma: no cover - archive.store guarantees metadata
                raise AssertionError("downloaded source did not enter the archive")
            acquisition_status = "DOWNLOADED"
            assert archived.data_path == latest.data_path
        except OracleElixirDownloadIntervalError:
            acquisition_status = "REUSED_DAILY_CACHE"
        except OracleElixirDownloadError as error:
            network_attempted = True
            acquisition_status = (
                "REUSED_CACHE_AFTER_SOURCE_ERROR" if latest else "SOURCE_ERROR_NO_CACHE"
            )
            acquisition_error = str(error)

        if latest is None:
            payload = {
                "schema_version": "1",
                "status": "SOURCE_UNAVAILABLE_NO_CACHE",
                "published": False,
                "network_collection_performed": network_attempted,
                "source_acquisition": {
                    "status": acquisition_status,
                    "error": acquisition_error,
                },
            }
            return FeedJobOperationResult(exit_code=4, payload=payload)

        refresh_args = argparse.Namespace(
            input=latest.data_path,
            source_timezone=args.source_timezone,
            retrieved_at=latest.retrieved_at.isoformat(),
            source_uri=latest.final_url,
            registry=args.registry,
            region_map=args.region_map,
            cutoff=args.cutoff,
            patch=args.patch,
            recent_days=args.recent_days,
            prior_days=args.prior_days,
            minimum_recent_matches=args.minimum_recent_matches,
            minimum_prior_matches=args.minimum_prior_matches,
            minimum_region_matches=args.minimum_region_matches,
            minimum_current_picks=args.minimum_current_picks,
            fail_on_import_issues=False,
            feed_dir=args.feed_dir,
            creator_top_k=args.creator_top_k,
            max_index_entries=args.max_index_entries,
            published_at=None,
            output=None,
            input_authenticity="REVIEWED_PROVIDER_PUBLISHED_DOWNLOAD",
            source_network_collection_performed=network_attempted,
        )
        imported = _load_oe_import(refresh_args)
        coverage = audit_oe_coverage(
            imported,
            _load_league_regions(args.region_map),
            _readiness_criteria(args),
        )
        if not coverage.ready_for_radar:
            exit_code = 2
            payload = {
                "schema_version": "1",
                "status": "REJECTED_READINESS",
                "published": False,
                "readiness_audit": coverage.to_dict(),
            }
        else:
            exit_code, payload = _refresh_feed_payload(
                refresh_args,
                imported=imported,
                publication_readiness=coverage.to_dict(),
            )
            payload["readiness_audit"] = coverage.to_dict()
        payload["network_collection_performed"] = network_attempted
        payload["source_acquisition"] = {
            "status": acquisition_status,
            "error": acquisition_error,
            "retrieved_at": latest.retrieved_at.isoformat(),
            "content_hash": latest.content_hash,
        }
        return FeedJobOperationResult(exit_code=exit_code, payload=payload)

    try:
        result = runner.run(
            operation,
            config_path=Path("configs/oe-sync.runtime.json"),
        )
        payload = result.audit
        exit_code = result.exit_code
    except FeedJobAlreadyRunning as error:
        payload = {
            "schema_version": "1",
            "status": "ALREADY_RUNNING",
            "exit_code": 3,
            "error": str(error),
        }
        exit_code = 3
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    return exit_code


def _build_radar(args: argparse.Namespace) -> int:
    payload, has_import_issues = _radar_payload(args)
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    if args.fail_on_import_issues and has_import_issues:
        return 2
    return 0


def _benchmark_oe(args: argparse.Namespace) -> int:
    """Measure the real local pipeline while emitting only bounded aggregate evidence."""

    total_started = perf_counter()
    retrieved_at = parse_datetime(args.retrieved_at) if args.retrieved_at else datetime.now(UTC)

    import_started = perf_counter()
    imported = _load_oe_import(args, retrieved_at=retrieved_at)
    import_seconds = perf_counter() - import_started

    radar_started = perf_counter()
    league_regions = _load_league_regions(args.region_map)
    radar = MetaRadar().build(
        imported.matches,
        imported.draft_events,
        _meta_radar_config(args, retrieved_at),
        league_regions,
    )
    radar_seconds = perf_counter() - radar_started
    radar_payload = dict(radar.to_dict())
    radar_payload["input"] = {
        "authenticity": "UNVERIFIED_CALLER_SUPPLIED_FILE",
        "network_collection_performed": False,
        "import_report": imported.report.to_dict(),
    }

    serialization_started = perf_counter()
    radar_json = json.dumps(radar_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    serialization_seconds = perf_counter() - serialization_started

    output_write_seconds = 0.0
    if args.radar_output:
        write_started = perf_counter()
        _emit(radar_json, args.radar_output)
        output_write_seconds = perf_counter() - write_started

    total_seconds = perf_counter() - total_started
    report = imported.report
    windows = radar_payload["windows"]
    entries = radar_payload["entries"]
    quality = radar_payload["quality"]
    benchmark = {
        "schema_version": "1",
        "benchmark_kind": "LOCAL_OE_META_RADAR_PIPELINE",
        "environment": {
            "python_version": platform.python_version(),
            "platform": platform.platform(),
        },
        "input": {
            "source_id": "oracles-elixir-match-data",
            "source_version": report.source_version,
            "retrieved_at": report.retrieved_at.isoformat(),
            "byte_length": report.byte_length,
            "row_count": report.row_count,
            "discovered_game_count": report.discovered_game_count,
            "imported_game_count": report.imported_game_count,
            "rejected_game_count": report.rejected_game_count,
            "issue_counts": dict(report.issue_counts),
            "raw_dataset_embedded": False,
        },
        "timings_seconds": {
            "total": round(total_seconds, 6),
            "import": round(import_seconds, 6),
            "radar_build": round(radar_seconds, 6),
            "serialization": round(serialization_seconds, 6),
            "radar_output_write": round(output_write_seconds, 6),
        },
        "throughput": {
            "rows_per_import_second": _rate(report.row_count, import_seconds),
            "games_per_import_second": _rate(report.discovered_game_count, import_seconds),
        },
        "radar_output": {
            "patch_id": radar_payload["patch_id"],
            "entry_count": len(entries),
            "eligible_entry_count": sum(1 for entry in entries if entry["eligible_for_review"]),
            "recent_match_count": windows["recent"]["match_count"],
            "prior_match_count": windows["prior"]["match_count"],
            "unknown_league_count": len(quality["unknown_leagues"]),
            "json_byte_length": len(radar_json.encode("utf-8")),
            "written": args.radar_output is not None,
        },
        "limitations": [
            "timings are workstation-specific and must not be compared across unlike hosts",
            "the benchmark does not redistribute or embed the provider's raw dataset",
            "a current annual snapshot cannot reconstruct availability before retrieved_at",
            "import rejection and unknown-league counts remain explicit quality evidence",
        ],
    }
    _emit(json.dumps(benchmark, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    if args.fail_on_import_issues and report.issue_counts:
        return 2
    return 0


def _radar_payload(
    args: argparse.Namespace,
    *,
    imported: OracleElixirImport | None = None,
) -> tuple[dict[str, object], bool]:
    retrieved_at = parse_datetime(args.retrieved_at) if args.retrieved_at else datetime.now(UTC)
    imported = imported or _load_oe_import(args, retrieved_at=retrieved_at)
    config = _meta_radar_config(args, retrieved_at)
    league_regions = _load_league_regions(args.region_map)
    radar = MetaRadar().build(imported.matches, imported.draft_events, config, league_regions)
    payload = dict(radar.to_dict())
    payload["opponent_prep"] = (
        OpponentPrepBuilder()
        .build(
            imported.matches,
            imported.draft_events,
            OpponentPrepConfig(
                cutoff=config.cutoff,
                patch_id=str(payload["patch_id"]),
            ),
        )
        .to_dict()
    )
    payload["input"] = {
        "authenticity": getattr(args, "input_authenticity", "UNVERIFIED_CALLER_SUPPLIED_FILE"),
        "network_collection_performed": getattr(args, "source_network_collection_performed", False),
        "import_report": imported.report.to_dict(),
    }
    return payload, bool(imported.report.issue_counts)


def _meta_radar_config(args: argparse.Namespace, retrieved_at: datetime) -> MetaRadarConfig:
    cutoff = parse_datetime(args.cutoff) if args.cutoff else retrieved_at
    return MetaRadarConfig(
        cutoff=cutoff,
        patch_id=args.patch,
        recent_window_days=args.recent_days,
        prior_window_days=args.prior_days,
        minimum_recent_matches=args.minimum_recent_matches,
        minimum_prior_matches=args.minimum_prior_matches,
        minimum_region_matches=args.minimum_region_matches,
        minimum_current_picks=args.minimum_current_picks,
    )


def _rate(count: int, seconds: float) -> float:
    return round(count / seconds, 3) if seconds > 0 else 0.0


def _build_creator_brief(args: argparse.Namespace) -> int:
    report = json.loads(args.radar.read_text(encoding="utf-8"))
    brief = CreatorBriefBuilder().build(report, top_k=args.top_k)
    _emit(brief.to_json(), args.output)
    return 0


def _refresh_feed(args: argparse.Namespace) -> int:
    exit_code, payload = _refresh_feed_payload(args)
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    return exit_code


def _refresh_feed_payload(
    args: argparse.Namespace,
    *,
    imported: OracleElixirImport | None = None,
    publication_readiness: dict[str, object] | None = None,
) -> tuple[int, dict[str, object]]:
    radar, has_import_issues = _radar_payload(args, imported=imported)
    if args.fail_on_import_issues and has_import_issues:
        payload = {
            "schema_version": "1",
            "status": "REJECTED_IMPORT_ISSUES",
            "published": False,
            "import_report": radar["input"]["import_report"],
        }
        return 2, payload

    if publication_readiness is not None:
        radar["publication_readiness"] = publication_readiness

    creator = CreatorBriefBuilder().build(radar, top_k=args.creator_top_k)
    published_at = parse_datetime(args.published_at) if args.published_at else datetime.now(UTC)
    publisher = SnapshotFeedPublisher(
        args.feed_dir,
        max_index_entries=args.max_index_entries,
    )
    result = publisher.publish(radar, creator.to_dict(), published_at=published_at)
    payload = result.to_dict(args.feed_dir)
    payload.update(
        {
            "status": "PUBLISHED",
            "network_collection_performed": False,
            "creator_topic_count": len(creator.to_dict()["topic_candidates"]),
        }
    )
    return 0, payload


def _run_feed_job(args: argparse.Namespace) -> int:
    config = _load_feed_job_config(args.config)
    refresh_args = _feed_job_refresh_args(args.config, config)
    runner = FeedJobRunner(_resolve_config_path(args.config, config["run_dir"]))

    def operation() -> FeedJobOperationResult:
        exit_code, payload = _refresh_feed_payload(refresh_args)
        return FeedJobOperationResult(exit_code=exit_code, payload=payload)

    try:
        result = runner.run(operation, config_path=args.config)
        payload = result.audit
        exit_code = result.exit_code
    except FeedJobAlreadyRunning as error:
        payload = {
            "schema_version": "1",
            "status": "ALREADY_RUNNING",
            "exit_code": 3,
            "error": str(error),
        }
        exit_code = 3
    _emit(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", args.output)
    return exit_code


def _load_feed_job_config(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != "1":
        raise ValueError("feed job config requires schema_version 1")
    for key in ("input", "source_timezone", "feed_dir", "run_dir"):
        if not isinstance(payload.get(key), str) or not payload[key]:
            raise ValueError(f"feed job config requires non-empty {key}")
    for section in ("radar", "creator", "policy"):
        value = payload.get(section, {})
        if not isinstance(value, dict):
            raise ValueError(f"feed job config {section} must be an object")
    return payload


def _feed_job_refresh_args(config_path: Path, config: dict[str, object]) -> argparse.Namespace:
    radar = config.get("radar", {})
    creator = config.get("creator", {})
    policy = config.get("policy", {})
    assert isinstance(radar, dict)
    assert isinstance(creator, dict)
    assert isinstance(policy, dict)

    def optional_path(key: str) -> Path | None:
        value = config.get(key)
        return _resolve_config_path(config_path, value) if isinstance(value, str) else None

    return argparse.Namespace(
        input=_resolve_config_path(config_path, config["input"]),
        source_timezone=config["source_timezone"],
        retrieved_at=config.get("retrieved_at"),
        source_uri=config.get("source_uri"),
        registry=optional_path("registry"),
        region_map=optional_path("region_map"),
        cutoff=config.get("cutoff"),
        patch=radar.get("patch"),
        recent_days=int(radar.get("recent_days", 7)),
        prior_days=int(radar.get("prior_days", 7)),
        minimum_recent_matches=int(radar.get("minimum_recent_matches", 5)),
        minimum_prior_matches=int(radar.get("minimum_prior_matches", 5)),
        minimum_region_matches=int(radar.get("minimum_region_matches", 3)),
        minimum_current_picks=int(radar.get("minimum_current_picks", 2)),
        fail_on_import_issues=bool(policy.get("fail_on_import_issues", True)),
        feed_dir=_resolve_config_path(config_path, config["feed_dir"]),
        creator_top_k=int(creator.get("top_k", 3)),
        max_index_entries=int(config.get("max_index_entries", 50)),
        published_at=config.get("published_at"),
        output=None,
    )


def _resolve_config_path(config_path: Path, value: object) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError("feed job path must be a non-empty string")
    path = Path(value)
    return path if path.is_absolute() else config_path.resolve().parent / path


def _add_radar_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input", type=Path, required=True, help="provider-published CSV file")
    parser.add_argument(
        "--source-timezone", required=True, help="UTC, offset, or installed IANA zone"
    )
    parser.add_argument("--retrieved-at", help="snapshot retrieval time; defaults to current UTC")
    parser.add_argument("--source-uri", help="optional registered provider HTTPS source URL")
    parser.add_argument("--registry", type=Path, help="optional source registry JSON")
    parser.add_argument("--region-map", type=Path, help="optional league-to-region JSON mapping")
    parser.add_argument("--cutoff", help="analysis cutoff; defaults to retrieved-at")
    parser.add_argument("--patch", help="patch ID; latest available match patch if omitted")
    parser.add_argument("--recent-days", type=int, default=7)
    parser.add_argument("--prior-days", type=int, default=7)
    parser.add_argument("--minimum-recent-matches", type=int, default=5)
    parser.add_argument("--minimum-prior-matches", type=int, default=5)
    parser.add_argument("--minimum-region-matches", type=int, default=3)
    parser.add_argument("--minimum-current-picks", type=int, default=2)
    parser.add_argument(
        "--fail-on-import-issues",
        action="store_true",
        help="return exit code 2 when the OE importer reports rejected games",
    )


def _add_readiness_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--readiness-minimum-matches", type=int, default=20)
    parser.add_argument("--readiness-minimum-teams", type=int, default=8)
    parser.add_argument("--readiness-minimum-regions", type=int, default=2)


def _readiness_criteria(args: argparse.Namespace) -> OECoverageCriteria:
    return OECoverageCriteria(
        minimum_matches=args.readiness_minimum_matches,
        minimum_distinct_teams=args.readiness_minimum_teams,
        minimum_regions=args.readiness_minimum_regions,
        patch_id=args.patch,
    )


def _load_oe_import(
    args: argparse.Namespace,
    *,
    retrieved_at: datetime | None = None,
) -> OracleElixirImport:
    retrieved_at = retrieved_at or (
        parse_datetime(args.retrieved_at) if args.retrieved_at else datetime.now(UTC)
    )
    return OracleElixirCSVAdapter(_load_registry(args.registry)).import_file(
        args.input,
        retrieved_at=retrieved_at,
        source_timezone=args.source_timezone,
        source_uri=args.source_uri,
    )


def _load_league_regions(path: Path | None) -> LeagueRegionMap:
    return LeagueRegionMap.from_json(path) if path else LeagueRegionMap.load_default()


def _load_registry(path: Path | None) -> SourceRegistry:
    return SourceRegistry.from_json(path) if path else SourceRegistry.load_default()


def _emit(output: str, destination: Path | None) -> None:
    if destination:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(output, encoding="utf-8", newline="\n")
    else:
        print(output, end="")
