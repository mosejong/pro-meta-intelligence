import json

from pro_meta_intelligence.cli import main


def test_cli_writes_machine_readable_json(tmp_path) -> None:
    output = tmp_path / "report.json"

    assert main(["evaluate", "--output", str(output)]) == 0

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["scenario_id"] == "synthetic-jungle-emergence-v1"
    assert len(payload["baselines"]) == 3
