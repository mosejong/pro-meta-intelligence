import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.ingestion import OracleElixirDownloadIntervalError
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive

FIXTURES = Path(__file__).parent / "fixtures"


def test_cli_writes_machine_readable_json(tmp_path) -> None:
    output = tmp_path / "report.json"

    assert main(["evaluate", "--output", str(output)]) == 0

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["scenario_id"] == "synthetic-jungle-emergence-v1"
    assert len(payload["baselines"]) == 3


def test_sources_cli_reports_enabled_and_blocked_policy_state(tmp_path) -> None:
    output = tmp_path / "sources.json"

    assert main(["sources", "--output", str(output)]) == 0

    sources = {
        item["source_id"]: item
        for item in json.loads(output.read_text(encoding="utf-8"))["sources"]
    }
    assert sources["riot-data-dragon"]["status"] == "ENABLED"
    assert sources["lol-esports-schedule"]["allowed_operations"] == ["FETCH_SCHEDULE_HTML"]
    assert sources["oracles-elixir-match-data"]["allowed_operations"] == [
        "FETCH_PUBLISHED_CSV",
        "IMPORT_LOCAL_CSV",
    ]
    assert sources["riot-web-api"]["status"] == "REVIEW_REQUIRED"


def test_fetch_schedule_uses_published_snapshot_time_to_block_an_early_ci_request(
    tmp_path, capsys
) -> None:
    output = tmp_path / "schedule.json"
    changes = tmp_path / "schedule-changes.json"
    original = {
        "schema_version": "1",
        "artifact_type": "pro-schedule-snapshot",
        "retrieved_at": "2999-01-01T00:00:00+00:00",
        "content_hash": f"sha256:{'a' * 64}",
        "events": [],
    }
    output.write_text(json.dumps(original), encoding="utf-8")

    assert (
        main(
            [
                "fetch-schedule",
                "--league",
                "lck",
                "--archive-dir",
                str(tmp_path / "raw"),
                "--output",
                str(output),
                "--changes-output",
                str(changes),
                "--watch-team",
                "T1",
            ]
        )
        == 3
    )

    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "RATE_LIMITED"
    assert result["network_collection_performed"] is False
    assert result["existing_snapshot_preserved"] is True
    assert json.loads(output.read_text(encoding="utf-8")) == original
    assert not changes.exists()


def test_fetch_schedule_publishes_t1_change_log_with_the_new_snapshot(
    tmp_path, monkeypatch
) -> None:
    output = tmp_path / "schedule.json"
    changes = tmp_path / "schedule-changes.json"
    previous = {
        "schema_version": "1",
        "artifact_type": "pro-schedule-snapshot",
        "source_id": "lol-esports-schedule",
        "retrieved_at": "2026-08-25T00:00:00+00:00",
        "content_hash": f"sha256:{'a' * 64}",
        "events": [
            {
                "event_id": "lolesports:old",
                "start_at": "2026-08-29T08:00:00+00:00",
                "league": "LCK",
                "block": "Playoffs",
                "best_of": 5,
                "participants": [
                    {"name": "TBD", "code": "TBD"},
                    {"name": "T1", "code": "T1"},
                ],
            }
        ],
    }
    current = {
        **previous,
        "retrieved_at": "2026-08-25T08:00:00+00:00",
        "content_hash": f"sha256:{'b' * 64}",
        "events": [
            {
                **previous["events"][0],
                "event_id": "lolesports:new",
                "participants": [
                    {"name": "Gen.G Esports", "code": "GEN"},
                    {"name": "T1", "code": "T1"},
                ],
            }
        ],
    }
    output.write_text(json.dumps(previous), encoding="utf-8")
    retrieved_at = datetime(2026, 8, 25, 8, 0, tzinfo=UTC)

    class FakeScheduleAdapter:
        source_id = "lol-esports-schedule"

        def __init__(self, registry) -> None:
            assert registry.get(self.source_id) is not None

        def fetch(self, leagues, *, locale, last_retrieved_at=None):
            assert leagues == ["lck"]
            assert locale == "en-US"
            assert last_retrieved_at == datetime(2026, 8, 25, 0, 0, tzinfo=UTC)
            artifact = RawSourceArtifact.create(
                source_id=self.source_id,
                request_url="https://lolesports.com/en-US/leagues/lck",
                final_url="https://lolesports.com/en-US/leagues/lck",
                media_type="text/html",
                retrieved_at=retrieved_at,
                body=b"<html>normalized fixture</html>",
            )
            return SimpleNamespace(artifact=artifact, to_dict=lambda: current)

    monkeypatch.setattr(
        "pro_meta_intelligence.cli.LoLEsportsScheduleAdapter",
        FakeScheduleAdapter,
    )

    assert (
        main(
            [
                "fetch-schedule",
                "--league",
                "lck",
                "--archive-dir",
                str(tmp_path / "raw"),
                "--output",
                str(output),
                "--changes-output",
                str(changes),
            ]
        )
        == 0
    )

    assert json.loads(output.read_text(encoding="utf-8")) == current
    change_log = json.loads(changes.read_text(encoding="utf-8"))
    assert change_log["latest_run"]["status"] == "CHANGED"
    assert change_log["latest_run"]["changes"][0]["type"] == "PARTICIPANT_CONFIRMED"
    assert change_log["current_snapshot"]["content_hash"] == current["content_hash"]


def test_import_oe_cli_writes_qa_and_normalization_summary(tmp_path) -> None:
    output = tmp_path / "oe-import.json"

    assert (
        main(
            [
                "import-oe",
                "--input",
                str(FIXTURES / "oracles_elixir_game.csv"),
                "--source-timezone",
                "UTC",
                "--retrieved-at",
                datetime(2026, 8, 22, 3, 0, tzinfo=UTC).isoformat(),
                "--output",
                str(output),
            ]
        )
        == 0
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["input_authenticity"] == "UNVERIFIED_CALLER_SUPPLIED_FILE"
    assert payload["network_collection_performed"] is False
    assert payload["normalization"]["match_count"] == 1
    assert payload["normalization"]["pick_event_count"] == 10
    assert payload["normalization"]["ban_event_count"] == 10
    assert payload["import_report"]["rejected_game_count"] == 0


def test_audit_oe_coverage_cli_writes_machine_readable_readiness(tmp_path) -> None:
    output = tmp_path / "oe-coverage.json"

    assert (
        main(
            [
                "audit-oe-coverage",
                "--input",
                str(FIXTURES / "oracles_elixir_game.csv"),
                "--source-timezone",
                "UTC",
                "--retrieved-at",
                "2026-08-22T03:00:00Z",
                "--readiness-minimum-matches",
                "1",
                "--readiness-minimum-teams",
                "2",
                "--readiness-minimum-regions",
                "1",
                "--output",
                str(output),
            ]
        )
        == 0
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["ready_for_radar"] is True
    assert payload["selected_patch_id"] == "16.15"


def test_benchmark_oe_cli_emits_bounded_pipeline_measurements(tmp_path) -> None:
    output = tmp_path / "oe-benchmark.json"
    radar_output = tmp_path / "radar.json"

    assert (
        main(
            [
                "benchmark-oe",
                "--input",
                str(FIXTURES / "oracles_elixir_game.csv"),
                "--source-timezone",
                "UTC",
                "--retrieved-at",
                "2026-08-22T03:00:00Z",
                "--radar-output",
                str(radar_output),
                "--output",
                str(output),
            ]
        )
        == 0
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    radar = json.loads(radar_output.read_text(encoding="utf-8"))
    assert payload["benchmark_kind"] == "LOCAL_OE_META_RADAR_PIPELINE"
    assert payload["input"]["row_count"] == 12
    assert payload["input"]["imported_game_count"] == 1
    assert payload["input"]["raw_dataset_embedded"] is False
    assert payload["timings_seconds"]["total"] >= 0
    assert payload["throughput"]["rows_per_import_second"] > 0
    assert payload["radar_output"]["json_byte_length"] == len(radar_output.read_bytes())
    assert payload["radar_output"]["written"] is True
    assert radar["patch_id"] == "16.15"


def test_audit_oe_history_cli_fails_closed_for_an_empty_archive(tmp_path) -> None:
    output = tmp_path / "oe-history.json"

    assert (
        main(
            [
                "audit-oe-history",
                "--source-timezone",
                "UTC",
                "--archive-dir",
                str(tmp_path / "raw"),
                "--output",
                str(output),
            ]
        )
        == 2
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["ready_for_historical_backtest"] is False
    assert payload["blocking_reasons"] == ["NO_ARCHIVED_RETRIEVALS"]


def test_audit_oe_history_cli_accepts_matured_normalized_states(tmp_path) -> None:
    source_id = "oracles-elixir-match-data"
    source_url = "https://drive.usercontent.google.com/download?id=reviewed"
    retrieved_at = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    rows = base.splitlines(keepends=True)
    next_game = (
        b"".join(rows[1:])
        .replace(b"GAME001", b"GAME002")
        .replace(b"2026-08-20 10:00:00", b"2026-08-25 10:00:00")
    )
    archive_dir = tmp_path / "raw"
    archive = SnapshotArchive(archive_dir)
    for index, body in enumerate((base, base + next_game)):
        archive.store(
            RawSourceArtifact.create(
                source_id=source_id,
                request_url=source_url,
                final_url=source_url,
                media_type="text/csv",
                retrieved_at=retrieved_at + timedelta(days=index * 7),
                body=body,
            )
        )
    output = tmp_path / "oe-history.json"

    assert (
        main(
            [
                "audit-oe-history",
                "--source-timezone",
                "UTC",
                "--archive-dir",
                str(archive_dir),
                "--minimum-retrievals",
                "2",
                "--minimum-unique-states",
                "2",
                "--minimum-collection-span-days",
                "7",
                "--maximum-gap-hours",
                "168",
                "--outcome-horizon-days",
                "7",
                "--minimum-matured-cutoffs",
                "1",
                "--output",
                str(output),
            ]
        )
        == 0
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["ready_for_historical_backtest"] is True
    assert payload["collection"]["unique_normalized_state_count"] == 2
    assert payload["revision_ledger"][0]["added_match_count"] == 1


def test_build_radar_cli_reuses_validated_oe_import(tmp_path) -> None:
    output = tmp_path / "radar.json"

    assert (
        main(
            [
                "build-radar",
                "--input",
                str(FIXTURES / "oracles_elixir_game.csv"),
                "--source-timezone",
                "UTC",
                "--retrieved-at",
                "2026-08-22T03:00:00Z",
                "--cutoff",
                "2026-08-22T03:00:00Z",
                "--minimum-recent-matches",
                "1",
                "--minimum-prior-matches",
                "1",
                "--minimum-region-matches",
                "1",
                "--minimum-current-picks",
                "1",
                "--output",
                str(output),
            ]
        )
        == 0
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["patch_id"] == "16.15"
    assert payload["windows"]["recent"]["match_count"] == 1
    assert "network_collection_performed" not in payload["input"]
    assert payload["input"]["import_report"]["imported_game_count"] == 1
    assert payload["opponent_prep"]["team_count"] == 2
    assert payload["opponent_prep"]["teams"][0]["frequent_bans"]


def test_build_creator_brief_cli_consumes_radar_json(tmp_path) -> None:
    radar = tmp_path / "radar.json"
    creator = tmp_path / "creator.json"
    common = [
        "--input",
        str(FIXTURES / "oracles_elixir_game.csv"),
        "--source-timezone",
        "UTC",
        "--retrieved-at",
        "2026-08-22T03:00:00Z",
        "--cutoff",
        "2026-08-22T03:00:00Z",
        "--minimum-recent-matches",
        "1",
        "--minimum-prior-matches",
        "1",
        "--minimum-region-matches",
        "1",
        "--minimum-current-picks",
        "1",
    ]

    assert main(["build-radar", *common, "--output", str(radar)]) == 0
    assert (
        main(
            [
                "build-creator-brief",
                "--radar",
                str(radar),
                "--output",
                str(creator),
            ]
        )
        == 0
    )

    payload = json.loads(creator.read_text(encoding="utf-8"))
    assert payload["publication_ready"] is False
    assert payload["human_review_required"] is True
    assert payload["topic_candidates"] == []
    assert payload["warnings"] == ["NO_ELIGIBLE_CANDIDATES"]


def test_refresh_feed_cli_is_idempotent_and_performs_no_network_collection(tmp_path) -> None:
    feed = tmp_path / "feed"
    summary = tmp_path / "refresh.json"
    command = [
        "refresh-feed",
        "--input",
        str(FIXTURES / "oracles_elixir_game.csv"),
        "--source-timezone",
        "UTC",
        "--retrieved-at",
        "2026-08-22T03:00:00Z",
        "--cutoff",
        "2026-08-22T03:00:00Z",
        "--published-at",
        "2026-08-22T03:05:00Z",
        "--minimum-recent-matches",
        "1",
        "--minimum-prior-matches",
        "1",
        "--minimum-region-matches",
        "1",
        "--minimum-current-picks",
        "1",
        "--feed-dir",
        str(feed),
        "--output",
        str(summary),
    ]

    assert main(command) == 0
    first = json.loads(summary.read_text(encoding="utf-8"))
    assert first["status"] == "PUBLISHED"
    assert first["created"] is True
    assert first["network_collection_performed"] is False
    assert (feed / "current.json").is_file()
    assert (feed / "current-creator.json").is_file()
    current = json.loads((feed / "current.json").read_text(encoding="utf-8"))
    assert current["opponent_prep"]["artifact_type"] == "opponent-prep-pack"

    assert main(command) == 0
    second = json.loads(summary.read_text(encoding="utf-8"))
    assert second["snapshot_id"] == first["snapshot_id"]
    assert second["created"] is False


def test_run_feed_job_cli_publishes_with_lock_and_audit(tmp_path) -> None:
    feed = tmp_path / "feed"
    run_dir = tmp_path / "runs"
    config = tmp_path / "feed-job.json"
    output = tmp_path / "job-result.json"
    config.write_text(
        json.dumps(
            {
                "schema_version": "1",
                "input": str(FIXTURES / "oracles_elixir_game.csv"),
                "source_timezone": "UTC",
                "retrieved_at": "2026-08-22T03:00:00Z",
                "cutoff": "2026-08-22T03:00:00Z",
                "published_at": "2026-08-22T03:05:00Z",
                "feed_dir": str(feed),
                "run_dir": str(run_dir),
                "radar": {
                    "minimum_recent_matches": 1,
                    "minimum_prior_matches": 1,
                    "minimum_region_matches": 1,
                    "minimum_current_picks": 1,
                },
                "policy": {"fail_on_import_issues": True},
            }
        ),
        encoding="utf-8",
    )

    assert main(["run-feed-job", "--config", str(config), "--output", str(output)]) == 0

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["status"] == "SUCCEEDED"
    assert payload["result"]["status"] == "PUBLISHED"
    assert payload["result"]["network_collection_performed"] is False
    assert (feed / "current.json").is_file()
    assert (run_dir / "latest.json").is_file()
    assert not (run_dir / "feed-job.lock.json").exists()


def test_run_feed_job_cli_refuses_existing_lock(tmp_path) -> None:
    run_dir = tmp_path / "runs"
    run_dir.mkdir()
    (run_dir / "feed-job.lock.json").write_text('{"run_id":"active"}', encoding="utf-8")
    config = tmp_path / "feed-job.json"
    config.write_text(
        json.dumps(
            {
                "schema_version": "1",
                "input": str(FIXTURES / "oracles_elixir_game.csv"),
                "source_timezone": "UTC",
                "feed_dir": str(tmp_path / "feed"),
                "run_dir": str(run_dir),
            }
        ),
        encoding="utf-8",
    )

    assert main(["run-feed-job", "--config", str(config)]) == 3
    assert json.loads((run_dir / "feed-job.lock.json").read_text(encoding="utf-8")) == {
        "run_id": "active"
    }


def test_check_oe_feed_health_cli_returns_scheduler_friendly_exit_codes(tmp_path) -> None:
    run_dir = tmp_path / "runs"
    feed_dir = tmp_path / "feed"
    run_dir.mkdir()
    feed_dir.mkdir()
    (run_dir / "latest.json").write_text(
        json.dumps(
            {
                "status": "SUCCEEDED",
                "exit_code": 0,
                "finished_at": "2026-08-24T11:55:00+00:00",
            }
        ),
        encoding="utf-8",
    )
    (feed_dir / "current.json").write_text(
        json.dumps(
            {
                "schema_version": "1",
                "fixture_only": False,
                "patch_id": "16.16",
                "publication_readiness": {"ready_for_radar": True},
                "entries": [{"champion_id": "RekSai"}],
            }
        ),
        encoding="utf-8",
    )
    (feed_dir / "history-status.json").write_text(
        json.dumps(
            {
                "schema_version": "1",
                "artifact_type": "oe-history-status",
                "as_of": "2026-08-24T11:30:00+00:00",
                "status": "HISTORY_NOT_READY",
                "history_ready": False,
                "benchmark_ready": False,
                "gates": [
                    {
                        "id": gate_id,
                        "current": 1,
                        "required": 2,
                        "unit": "items",
                        "passed": False,
                    }
                    for gate_id in (
                        "RETRIEVALS",
                        "UNIQUE_STATES",
                        "COLLECTION_SPAN",
                        "MATURED_CUTOFFS",
                    )
                ],
                "next_action": "KEEP_DAILY_COLLECTION",
            }
        ),
        encoding="utf-8",
    )
    (feed_dir / "decision-outcomes.json").write_text(
        json.dumps(
            {
                "schema_version": "1",
                "artifact_type": "team-decision-outcomes",
                "as_of": "2026-08-24T11:30:00+00:00",
                "status": "HISTORY_NOT_READY",
                "benchmark_ready": False,
                "summary": {
                    "evaluated_cutoff_count": 0,
                    "selected_candidate_count": 0,
                    "hit_count": 0,
                    "false_alert_count": 0,
                    "missed_adoption_count": 0,
                },
                "evaluations": [],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "health.json"
    command = [
        "check-oe-feed-health",
        "--run-dir",
        str(run_dir),
        "--feed-dir",
        str(feed_dir),
        "--now",
        "2026-08-24T12:00:00Z",
        "--output",
        str(output),
    ]

    assert main(command) == 0
    assert json.loads(output.read_text(encoding="utf-8"))["status"] == "HEALTHY"

    (run_dir / "latest.json").unlink()
    assert main(command) == 2
    failed = json.loads(output.read_text(encoding="utf-8"))
    assert failed["next_action"] == "INSPECT_LAST_JOB"

    (run_dir / "latest.json").write_bytes(b"\xff")
    assert main(command) == 2


def test_sync_oe_feed_downloads_validates_and_publishes_under_one_lock(
    tmp_path, monkeypatch
) -> None:
    retrieved_at = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
    source_body = (FIXTURES / "oracles_elixir_game.csv").read_bytes()

    class FakeDownloadAdapter:
        source_id = "oracles-elixir-match-data"

        def __init__(self, registry) -> None:
            assert registry.get(self.source_id) is not None

        def fetch_year(self, year, *, last_retrieved_at=None):
            assert year == 2026
            if last_retrieved_at is not None:
                raise OracleElixirDownloadIntervalError(last_retrieved_at + timedelta(days=1))
            url = "https://drive.usercontent.google.com/download?id=reviewed"
            return SimpleNamespace(
                file=SimpleNamespace(year=year, filename="2026_test.csv"),
                artifact=RawSourceArtifact.create(
                    source_id=self.source_id,
                    request_url=url,
                    final_url=url,
                    media_type="text/csv",
                    retrieved_at=retrieved_at,
                    body=source_body,
                ),
            )

    monkeypatch.setattr(
        "pro_meta_intelligence.cli.OracleElixirPublishedDownloadAdapter",
        FakeDownloadAdapter,
    )
    output = tmp_path / "sync.json"
    feed = tmp_path / "feed"
    command = [
        "sync-oe-feed",
        "--year",
        "2026",
        "--source-timezone",
        "UTC",
        "--archive-dir",
        str(tmp_path / "raw"),
        "--feed-dir",
        str(feed),
        "--run-dir",
        str(tmp_path / "jobs"),
        "--readiness-minimum-matches",
        "1",
        "--readiness-minimum-teams",
        "2",
        "--readiness-minimum-regions",
        "1",
        "--minimum-recent-matches",
        "1",
        "--minimum-prior-matches",
        "1",
        "--minimum-region-matches",
        "1",
        "--minimum-current-picks",
        "1",
        "--output",
        str(output),
    ]

    assert main(command) == 0

    audit = json.loads(output.read_text(encoding="utf-8"))
    current = json.loads((feed / "current.json").read_text(encoding="utf-8"))
    assert audit["status"] == "SUCCEEDED"
    assert audit["result"]["source_acquisition"]["status"] == "DOWNLOADED"
    assert audit["result"]["network_collection_performed"] is True
    assert audit["result"]["readiness_audit"]["ready_for_radar"] is True
    assert current["fixture_only"] is False
    assert current["input"]["authenticity"] == "REVIEWED_PROVIDER_PUBLISHED_DOWNLOAD"
    assert "network_collection_performed" not in current["input"]
    assert current["history_status"]["artifact_type"] == "oe-history-status"
    assert current["history_status"]["next_action"] == "KEEP_DAILY_COLLECTION"
    assert (
        json.loads((feed / "history-status.json").read_text(encoding="utf-8"))
        == current["history_status"]
    )
    outcomes = json.loads((feed / "decision-outcomes.json").read_text(encoding="utf-8"))
    assert outcomes["artifact_type"] == "team-decision-outcomes"
    assert outcomes["as_of"] == current["history_status"]["as_of"]
    assert outcomes["benchmark_ready"] is False
    assert outcomes["evaluations"] == []

    current_before_cache_reuse = (feed / "current.json").read_bytes()
    assert main(command) == 0
    reused = json.loads(output.read_text(encoding="utf-8"))
    assert reused["result"]["source_acquisition"]["status"] == "REUSED_DAILY_CACHE"
    assert reused["result"]["network_collection_performed"] is False
    assert reused["result"]["created"] is False
    assert (feed / "current.json").read_bytes() == current_before_cache_reuse


def test_sync_oe_feed_publishes_with_audited_known_exclusions(tmp_path, monkeypatch) -> None:
    retrieved_at = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    rows = base.splitlines(keepends=True)
    incomplete = b"".join(rows[1:]).replace(b"GAME001", b"GAME002")
    incomplete = incomplete.replace(b"complete", b"partial", 1)
    source_body = base + incomplete

    class FakeDownloadAdapter:
        source_id = "oracles-elixir-match-data"

        def __init__(self, registry) -> None:
            assert registry.get(self.source_id) is not None

        def fetch_year(self, year, *, last_retrieved_at=None):
            url = "https://drive.usercontent.google.com/download?id=reviewed"
            return SimpleNamespace(
                file=SimpleNamespace(year=year, filename="2026_test.csv"),
                artifact=RawSourceArtifact.create(
                    source_id=self.source_id,
                    request_url=url,
                    final_url=url,
                    media_type="text/csv",
                    retrieved_at=retrieved_at,
                    body=source_body,
                ),
            )

    monkeypatch.setattr(
        "pro_meta_intelligence.cli.OracleElixirPublishedDownloadAdapter",
        FakeDownloadAdapter,
    )
    output = tmp_path / "sync.json"
    feed = tmp_path / "feed"

    assert (
        main(
            [
                "sync-oe-feed",
                "--year",
                "2026",
                "--source-timezone",
                "UTC",
                "--archive-dir",
                str(tmp_path / "raw"),
                "--feed-dir",
                str(feed),
                "--run-dir",
                str(tmp_path / "jobs"),
                "--readiness-minimum-matches",
                "1",
                "--readiness-minimum-teams",
                "2",
                "--readiness-minimum-regions",
                "1",
                "--minimum-recent-matches",
                "1",
                "--minimum-prior-matches",
                "1",
                "--minimum-region-matches",
                "1",
                "--minimum-current-picks",
                "1",
                "--output",
                str(output),
            ]
        )
        == 0
    )

    audit = json.loads(output.read_text(encoding="utf-8"))
    readiness = audit["result"]["readiness_audit"]
    current = json.loads((feed / "current.json").read_text(encoding="utf-8"))
    assert audit["result"]["status"] == "PUBLISHED"
    assert readiness["ready_for_radar"] is True
    assert readiness["blocking_reasons"] == []
    assert readiness["warnings"] == ["PATCH_HAS_KNOWN_IMPORT_EXCLUSIONS"]
    assert readiness["selected_patch_import_quality"]["known_exclusion_game_count"] == 1
    assert current["publication_readiness"] == readiness
    assert current["input"]["import_report"]["rejected_game_count"] == 1


def test_sync_oe_feed_leaves_publication_unchanged_when_readiness_fails(
    tmp_path, monkeypatch
) -> None:
    retrieved_at = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
    source_body = (FIXTURES / "oracles_elixir_game.csv").read_bytes()

    class FakeDownloadAdapter:
        source_id = "oracles-elixir-match-data"

        def __init__(self, registry) -> None:
            assert registry.get(self.source_id) is not None

        def fetch_year(self, year, *, last_retrieved_at=None):
            url = "https://drive.usercontent.google.com/download?id=reviewed"
            return SimpleNamespace(
                file=SimpleNamespace(year=year, filename="2026_test.csv"),
                artifact=RawSourceArtifact.create(
                    source_id=self.source_id,
                    request_url=url,
                    final_url=url,
                    media_type="text/csv",
                    retrieved_at=retrieved_at,
                    body=source_body,
                ),
            )

    monkeypatch.setattr(
        "pro_meta_intelligence.cli.OracleElixirPublishedDownloadAdapter",
        FakeDownloadAdapter,
    )
    output = tmp_path / "sync.json"
    feed = tmp_path / "feed"

    assert (
        main(
            [
                "sync-oe-feed",
                "--year",
                "2026",
                "--source-timezone",
                "UTC",
                "--archive-dir",
                str(tmp_path / "raw"),
                "--feed-dir",
                str(feed),
                "--run-dir",
                str(tmp_path / "jobs"),
                "--output",
                str(output),
            ]
        )
        == 2
    )

    audit = json.loads(output.read_text(encoding="utf-8"))
    assert audit["status"] == "REJECTED"
    assert audit["result"]["status"] == "REJECTED_READINESS"
    assert audit["result"]["published"] is False
    assert audit["result"]["readiness_audit"]["blocking_reasons"] == [
        "PATCH_MATCH_COUNT_BELOW_MINIMUM",
        "PATCH_DISTINCT_TEAM_COUNT_BELOW_MINIMUM",
        "PATCH_REGION_COUNT_BELOW_MINIMUM",
    ]
    assert not (feed / "current.json").exists()
