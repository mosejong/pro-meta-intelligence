import csv
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.quality import OECoverageCriteria, audit_oe_coverage
from pro_meta_intelligence.radar import LeagueRegionMap
from pro_meta_intelligence.sources import SourceRegistry

FIXTURES = Path(__file__).parent / "fixtures"


def _import_fixture():
    return OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        FIXTURES / "oracles_elixir_game.csv",
        retrieved_at=datetime(2026, 8, 22, 3, 0, tzinfo=UTC),
        source_timezone="UTC",
    )


def _import_games(tmp_path, games):
    path = tmp_path / "games.csv"
    fieldnames = list(games[0][0])
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for rows in games:
            writer.writerows(rows)
    return OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        path,
        retrieved_at=datetime(2026, 8, 22, 3, 0, tzinfo=UTC),
        source_timezone="UTC",
    )


def _game_rows(*, game_id, patch, date="2026-08-20 10:00:00"):
    rows = list(
        csv.DictReader((FIXTURES / "oracles_elixir_game.csv").open(encoding="utf-8", newline=""))
    )
    for row in rows:
        row["gameid"] = game_id
        row["patch"] = patch
        row["date"] = date
    return rows


def test_oe_coverage_reports_explicit_patch_measurements() -> None:
    audit = audit_oe_coverage(
        _import_fixture(),
        LeagueRegionMap.load_default(),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

    assert audit["schema_version"] == "2"
    assert audit["ready_for_radar"] is True
    assert audit["blocking_reasons"] == []
    assert audit["selected_patch_id"] == "16.15"
    assert audit["annual_coverage"]["imported_game_count"] == 1
    assert audit["selected_patch"]["match_count"] == 1
    assert audit["selected_patch"]["pick_event_count"] == 10
    assert audit["selected_patch"]["distinct_team_count"] == 2
    assert audit["selected_patch"]["regions"] == ["KOREA"]


def test_oe_coverage_exposes_every_failed_gate_without_a_score() -> None:
    audit = audit_oe_coverage(
        _import_fixture(),
        LeagueRegionMap.load_default(),
        OECoverageCriteria(),
    ).to_dict()

    assert audit["ready_for_radar"] is False
    assert audit["blocking_reasons"] == [
        "PATCH_MATCH_COUNT_BELOW_MINIMUM",
        "PATCH_DISTINCT_TEAM_COUNT_BELOW_MINIMUM",
        "PATCH_REGION_COUNT_BELOW_MINIMUM",
    ]
    assert "score" not in audit


def test_oe_coverage_rejects_a_requested_patch_that_is_absent() -> None:
    audit = audit_oe_coverage(
        _import_fixture(),
        LeagueRegionMap.load_default(),
        OECoverageCriteria(
            minimum_matches=1,
            minimum_distinct_teams=1,
            minimum_regions=1,
            patch_id="99.99",
        ),
    ).to_dict()

    assert audit["selected_patch"] is None
    assert audit["blocking_reasons"] == ["SELECTED_PATCH_NOT_FOUND"]


def test_oe_coverage_blocks_unmapped_leagues_explicitly() -> None:
    audit = audit_oe_coverage(
        _import_fixture(),
        LeagueRegionMap(()),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

    assert audit["selected_patch"]["unknown_leagues"] == ["LCK"]
    assert audit["blocking_reasons"] == [
        "PATCH_REGION_COUNT_BELOW_MINIMUM",
        "PATCH_HAS_UNKNOWN_LEAGUES",
    ]


def test_oe_coverage_allows_known_selected_patch_exclusions_when_coverage_remains(
    tmp_path,
) -> None:
    valid = _game_rows(game_id="VALID", patch="16.16")
    incomplete = _game_rows(game_id="INCOMPLETE", patch="16.16")
    incomplete[0]["datacompleteness"] = "partial"
    imported = _import_games(tmp_path, [valid, incomplete])

    audit = audit_oe_coverage(
        imported,
        LeagueRegionMap.load_default(),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

    assert audit["ready_for_radar"] is True
    assert audit["blocking_reasons"] == []
    assert audit["warnings"] == ["PATCH_HAS_KNOWN_IMPORT_EXCLUSIONS"]
    assert audit["selected_patch_import_quality"] == {
        "patch_id": "16.16",
        "imported_game_count": 1,
        "known_exclusion_game_count": 1,
        "blocking_issue_game_count": 0,
        "discovered_game_count": 2,
        "issue_counts": {"INCOMPLETE_GAME": 1},
        "issue_context": [
            {
                "patch_id": "16.16",
                "league": "LCK",
                "code": "INCOMPLETE_GAME",
                "count": 1,
                "disposition": "KNOWN_EXCLUSION",
            }
        ],
    }


def test_oe_coverage_blocks_selected_patch_contract_issues(tmp_path) -> None:
    valid = _game_rows(game_id="VALID", patch="16.16")
    invalid = _game_rows(game_id="INVALID", patch="16.16")
    invalid[11]["firstPick"] = "1"
    imported = _import_games(tmp_path, [valid, invalid])

    audit = audit_oe_coverage(
        imported,
        LeagueRegionMap.load_default(),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

    assert audit["ready_for_radar"] is False
    assert audit["blocking_reasons"] == ["PATCH_HAS_BLOCKING_IMPORT_ISSUES"]
    assert audit["selected_patch_import_quality"]["blocking_issue_game_count"] == 1
    assert audit["selected_patch_import_quality"]["issue_counts"] == {"INVALID_FIRST_PICK": 1}


def test_oe_coverage_treats_fully_missing_first_pick_as_a_known_exclusion(tmp_path) -> None:
    valid = _game_rows(game_id="VALID", patch="16.16")
    missing = _game_rows(game_id="MISSING", patch="16.16")
    missing[10]["firstPick"] = ""
    missing[11]["firstPick"] = ""
    imported = _import_games(tmp_path, [valid, missing])

    audit = audit_oe_coverage(
        imported,
        LeagueRegionMap.load_default(),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

    assert audit["ready_for_radar"] is True
    assert audit["blocking_reasons"] == []
    assert audit["warnings"] == ["PATCH_HAS_KNOWN_IMPORT_EXCLUSIONS"]
    assert audit["selected_patch_import_quality"]["known_exclusion_game_count"] == 1
    assert audit["selected_patch_import_quality"]["blocking_issue_game_count"] == 0
    assert audit["selected_patch_import_quality"]["issue_counts"] == {"MISSING_FIRST_PICK": 1}


def test_oe_coverage_warns_without_blocking_for_past_patch_contract_issues(tmp_path) -> None:
    current = _game_rows(game_id="CURRENT", patch="16.16", date="2026-08-20 10:00:00")
    past = _game_rows(game_id="PAST", patch="16.15", date="2026-08-19 10:00:00")
    past[11]["firstPick"] = "1"
    imported = _import_games(tmp_path, [past, current])

    audit = audit_oe_coverage(
        imported,
        LeagueRegionMap.load_default(),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

    assert audit["ready_for_radar"] is True
    assert audit["blocking_reasons"] == []
    assert audit["warnings"] == ["ANNUAL_BLOCKING_IMPORT_ISSUES_OUTSIDE_SELECTED_PATCH"]


def test_default_region_map_covers_reviewed_current_publication_leagues() -> None:
    mapping = LeagueRegionMap.load_default()
    expected = {
        "AL": "EMEA",
        "CD": "BRAZIL",
        "EBL": "EMEA",
        "HLL": "EMEA",
        "HM": "EMEA",
        "KeSPA Cup": "KOREA",
        "LCKC": "KOREA",
        "LES": "EMEA",
        "LFL": "EMEA",
        "LIT": "EMEA",
        "LPLOL": "EMEA",
        "LRN": "LATIN_AMERICA",
        "LRS": "LATIN_AMERICA",
        "NACL": "NORTH_AMERICA",
        "NL": "EMEA",
        "NLC": "EMEA",
        "PRM": "EMEA",
        "RL": "EMEA",
        "ROL": "EMEA",
        "TCL": "EMEA",
    }

    assert {league: mapping.region_for(league) for league in expected} == expected
