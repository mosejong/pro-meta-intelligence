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
