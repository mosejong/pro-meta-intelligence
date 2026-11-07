import csv

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.quality.team_coverage import audit_team_coverage
from pro_meta_intelligence.sources import SourceRegistry
from tests.test_opponent import FIXTURE, RETRIEVED_AT


def test_team_coverage_preserves_rejected_games_and_exposes_truncated_details(tmp_path):
    with FIXTURE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        rows = list(reader)
    rejected = [dict(row, gameid="REJECTED", datacompleteness="partial") for row in rows]
    path = tmp_path / "audit.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fields)
        writer.writeheader()
        writer.writerows(rows + rejected)
    adapter = OracleElixirCSVAdapter(SourceRegistry.load_default())
    complete = adapter.import_file(
        path, retrieved_at=RETRIEVED_AT, source_timezone="+09:00", issue_detail_limit=None
    )
    short = adapter.import_file(
        path, retrieved_at=RETRIEVED_AT, source_timezone="+09:00", issue_detail_limit=0
    )
    assert len(complete.matches) == len(short.matches) == 1
    assert complete.report.truncated_issue_count == 0
    assert short.report.truncated_issue_count == 1
    report = audit_team_coverage(path, complete, ("Blue Team", "Missing Team"))
    blue = report["teams"]["Blue Team"]
    assert blue["observed_games"] == 2
    assert blue["accepted_games"] == blue["excluded_games"] == 1
    assert blue["excluded_rate"] == 0.5
    assert blue["exclusion_reasons"] == {"INCOMPLETE_GAME": 1}
    assert report["teams"]["Missing Team"]["excluded_rate"] is None
    report = audit_team_coverage(path, short, ("Blue Team",))
    assert report["teams"]["Blue Team"]["exclusion_reasons"] == {"DETAIL_NOT_RETAINED": 1}
