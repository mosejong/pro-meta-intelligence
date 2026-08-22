import json
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.cli import main

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
    assert sources["oracles-elixir-match-data"]["allowed_operations"] == ["IMPORT_LOCAL_CSV"]
    assert sources["riot-web-api"]["status"] == "REVIEW_REQUIRED"


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
    assert payload["import_report"]["rejected_game_count"] == 0


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
    assert payload["input"]["network_collection_performed"] is False
    assert payload["input"]["import_report"]["imported_game_count"] == 1


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

    assert main(command) == 0
    second = json.loads(summary.read_text(encoding="utf-8"))
    assert second["snapshot_id"] == first["snapshot_id"]
    assert second["created"] is False
