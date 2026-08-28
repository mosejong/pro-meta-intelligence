import csv
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pro_meta_intelligence.ingestion.oracles_elixir import (
    OracleElixirCSVAdapter,
    OracleElixirSchemaError,
)
from pro_meta_intelligence.leakage import filter_available
from pro_meta_intelligence.models import DraftAction, Side
from pro_meta_intelligence.sources import SourcePolicyError, SourceRegistry, SourceStatus

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
RETRIEVED_AT = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)


def import_fixture(path: Path = FIXTURE):
    return OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        path,
        retrieved_at=RETRIEVED_AT,
        source_timezone="+09:00",
        source_uri="https://drive.google.com/example",
    )


def test_import_normalizes_complete_game_and_global_draft_sequences() -> None:
    imported = import_fixture()

    assert len(imported.matches) == 1
    assert len(imported.draft_events) == 20
    match = imported.matches[0]
    assert match.match_id == "oe:LCK:GAME001"
    assert match.winner_team_id == "oe:team:red"
    assert match.observed_at.isoformat() == "2026-08-20T10:00:00+09:00"
    assert match.available_at == RETRIEVED_AT
    assert match.provenance.source_uri == "https://drive.google.com/example"
    assert match.provenance.content_hash.startswith("sha256:")
    assert match.blue_team_name == "Blue Team"
    assert match.red_team_name == "Red Team"

    picks = tuple(event for event in imported.draft_events if event.action is DraftAction.PICK)
    bans = tuple(event for event in imported.draft_events if event.action is DraftAction.BAN)
    assert [event.sequence for event in picks] == list(range(1, 11))
    assert picks[0].champion_id == "Xin Zhao"
    assert picks[0].role == "JUNGLE"
    assert picks[0].side is Side.BLUE
    assert picks[1].champion_id == "Zaahen"
    assert [event.sequence for event in bans] == list(range(1, 11))
    assert bans[0].champion_id == "Yone"
    assert bans[0].role == "UNKNOWN"
    assert bans[1].champion_id == "Aurora"
    assert imported.report.rejected_game_count == 0


def test_import_preserves_match_when_optional_ban_value_is_missing(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    rows[10]["ban5"] = ""
    path = tmp_path / "missing-ban.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert len(imported.matches) == 1
    assert len(imported.draft_events) == 19
    assert len([event for event in imported.draft_events if event.action is DraftAction.BAN]) == 9


def test_current_snapshot_cannot_enter_an_earlier_historical_cutoff() -> None:
    imported = import_fixture()

    assert (
        filter_available(
            imported.matches,
            datetime(2026, 8, 21, 23, 59, tzinfo=UTC),
        )
        == ()
    )


def test_import_rejects_incomplete_game_without_partial_records(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    rows[0]["datacompleteness"] = "partial"
    path = tmp_path / "partial.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert imported.matches == ()
    assert imported.draft_events == ()
    assert imported.report.rejected_game_count == 1
    assert dict(imported.report.issue_counts) == {"INCOMPLETE_GAME": 1}
    assert imported.report.issue_context_counts == (("16.15", "LCK", "INCOMPLETE_GAME", 1),)
    assert imported.report.issues[0].to_dict() == {
        "game_key": "LCK:GAME001",
        "league": "LCK",
        "patch_id": "16.15",
        "code": "INCOMPLETE_GAME",
        "detail": "datacompleteness is not complete",
    }


def test_import_accepts_a_consistently_blank_optional_split(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    for row in rows:
        row["split"] = ""
    path = tmp_path / "blank-split.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert imported.report.rejected_game_count == 0
    assert imported.matches[0].tournament == "2026 LCK"


def test_import_rejects_an_inconsistent_optional_split(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    rows[0]["split"] = ""
    path = tmp_path / "inconsistent-split.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert imported.matches == ()
    assert dict(imported.report.issue_counts) == {"INCONSISTENT_GAME_FIELD": 1}


def test_import_rejects_team_pick_list_that_does_not_match_players(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    rows[10]["pick5"] = rows[10]["pick4"]
    path = tmp_path / "duplicate-pick.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert imported.matches == ()
    assert dict(imported.report.issue_counts) == {"PICK_SET_MISMATCH": 1}


def test_import_distinguishes_missing_first_pick_from_a_broken_value(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    rows[10]["firstPick"] = ""
    rows[11]["firstPick"] = ""
    path = tmp_path / "missing-first-pick.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert imported.matches == ()
    assert dict(imported.report.issue_counts) == {"MISSING_FIRST_PICK": 1}
    assert imported.report.issues[0].detail == "firstPick is missing for both teams"


def test_import_keeps_conflicting_first_pick_values_blocking(tmp_path) -> None:
    rows = list(csv.DictReader(FIXTURE.open(encoding="utf-8", newline="")))
    rows[11]["firstPick"] = "1"
    path = tmp_path / "conflicting-first-pick.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)

    imported = import_fixture(path)

    assert imported.matches == ()
    assert dict(imported.report.issue_counts) == {"INVALID_FIRST_PICK": 1}


def test_import_rejects_file_level_schema_drift(tmp_path) -> None:
    path = tmp_path / "missing-columns.csv"
    path.write_text("gameid,league\nGAME001,LCK\n", encoding="utf-8")

    with pytest.raises(OracleElixirSchemaError, match="required columns"):
        import_fixture(path)


def test_import_never_emits_local_absolute_path() -> None:
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        FIXTURE,
        retrieved_at=RETRIEVED_AT,
        source_timezone="UTC",
    )

    assert imported.matches[0].provenance.source_uri == "local-file:oracles_elixir_game.csv"


def test_import_rejects_unregistered_provenance_url() -> None:
    with pytest.raises(ValueError, match="registered provider"):
        OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
            FIXTURE,
            retrieved_at=RETRIEVED_AT,
            source_timezone="UTC",
            source_uri="https://example.com/untrusted.csv",
        )


def test_policy_gate_blocks_local_import_when_source_is_not_enabled() -> None:
    registry = SourceRegistry.load_default()
    registration = registry.get("oracles-elixir-match-data")
    blocked = SourceRegistry((replace(registration, status=SourceStatus.REVIEW_REQUIRED),))
    adapter = OracleElixirCSVAdapter(blocked)

    with pytest.raises(SourcePolicyError, match="SOURCE_NOT_ENABLED"):
        adapter.import_file(
            FIXTURE,
            retrieved_at=RETRIEVED_AT,
            source_timezone="UTC",
        )
