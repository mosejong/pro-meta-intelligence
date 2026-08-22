import json

from pro_meta_intelligence.cli import main


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
    assert sources["riot-web-api"]["status"] == "REVIEW_REQUIRED"
