"""Reproducible local missing-game audit; writes no raw CSV to a public feed."""

import argparse
import json
from datetime import datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.quality.team_coverage import audit_team_coverage
from pro_meta_intelligence.sources import SourceRegistry

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        args.input,
        retrieved_at=datetime.fromisoformat(args.retrieved_at),
        source_timezone="UTC",
        issue_detail_limit=None,
    )
    report = audit_team_coverage(
        args.input,
        imported,
        (
            "T1",
            "Karmine Corp",
            "Top Esports",
            "Invictus Gaming",
            "Gen.G",
            "LYON",
            "Dplus Kia",
            "Bilibili Gaming",
        ),
    )
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for name, team in report["teams"].items():
        print(name, team["observed_games"], team["accepted_games"], team["exclusion_reasons"])
