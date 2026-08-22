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


def test_oe_coverage_reports_explicit_patch_measurements() -> None:
    audit = audit_oe_coverage(
        _import_fixture(),
        LeagueRegionMap.load_default(),
        OECoverageCriteria(minimum_matches=1, minimum_distinct_teams=2, minimum_regions=1),
    ).to_dict()

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
