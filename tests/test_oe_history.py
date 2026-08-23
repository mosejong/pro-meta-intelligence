from datetime import UTC, datetime, timedelta
from pathlib import Path

from pro_meta_intelligence.quality import OEHistoryCriteria, audit_oe_history
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceRegistry

FIXTURES = Path(__file__).parent / "fixtures"
SOURCE_ID = "oracles-elixir-match-data"
SOURCE_URL = "https://drive.usercontent.google.com/download?id=reviewed"
START = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)


def _build_history(tmp_path) -> SnapshotArchive:
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    rows = base.splitlines(keepends=True)
    header, game = rows[0], b"".join(rows[1:])
    second_game = game.replace(b"GAME001", b"GAME002").replace(
        b"2026-08-20 10:00:00", b"2026-08-25 10:00:00"
    )
    third_game = game.replace(b"GAME001", b"GAME003").replace(
        b"2026-08-20 10:00:00", b"2026-09-01 10:00:00"
    )
    versions = (
        base,
        header + game + second_game,
        header + game + second_game + third_game,
    )
    archive = SnapshotArchive(tmp_path)
    for index, body in enumerate(versions):
        archive.store(
            RawSourceArtifact.create(
                source_id=SOURCE_ID,
                request_url=SOURCE_URL,
                final_url=SOURCE_URL,
                media_type="text/csv",
                retrieved_at=START + timedelta(days=index * 7),
                body=body,
            )
        )
    return archive


def test_oe_history_audit_deep_validates_and_matures_cutoffs(tmp_path) -> None:
    archive = _build_history(tmp_path)
    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(
            minimum_retrievals=3,
            minimum_unique_states=3,
            minimum_collection_span_days=14,
            maximum_gap_hours=168,
            outcome_horizon_days=7,
            minimum_matured_cutoffs=2,
        ),
    ).to_dict()

    assert audit["ready_for_historical_backtest"] is True
    assert audit["blocking_reasons"] == []
    assert audit["collection"] == {
        "retrieval_count": 3,
        "retrieval_timestamp_count": 3,
        "unique_content_count": 3,
        "validated_content_count": 3,
        "unique_normalized_state_count": 3,
        "unchanged_retrieval_count": 0,
        "first_retrieved_at": START.isoformat(),
        "last_retrieved_at": (START + timedelta(days=14)).isoformat(),
        "collection_span_hours": 336.0,
        "matured_cutoff_count": 2,
    }
    assert [item["imported_game_count"] for item in audit["content_snapshots"]] == [1, 2, 3]
    assert audit["archive_integrity_issues"] == []
    assert audit["snapshot_import_issues"] == []
    assert [item["added_match_count"] for item in audit["revision_ledger"]] == [1, 1]
    assert all(item["removed_match_count"] == 0 for item in audit["revision_ledger"])
    assert all(item["revised_match_count"] == 0 for item in audit["revision_ledger"])
    assert audit["warnings"] == []


def test_oe_history_audit_exposes_continuity_failures_without_a_score(tmp_path) -> None:
    archive = _build_history(tmp_path)
    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(),
    ).to_dict()

    assert audit["ready_for_historical_backtest"] is False
    assert audit["blocking_reasons"] == [
        "RETRIEVAL_COUNT_BELOW_MINIMUM",
        "COLLECTION_GAP_ABOVE_MAXIMUM",
    ]
    assert len(audit["gaps_above_maximum"]) == 2
    assert "score" not in audit


def test_oe_history_audit_rejects_an_empty_archive() -> None:
    audit = audit_oe_history(
        SnapshotArchive(Path("missing-history-root")).inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(),
    ).to_dict()

    assert audit["blocking_reasons"] == ["NO_ARCHIVED_RETRIEVALS"]


def test_oe_history_distinguishes_valid_raw_bytes_from_invalid_csv(tmp_path) -> None:
    archive = SnapshotArchive(tmp_path)
    archive.store(
        RawSourceArtifact.create(
            source_id=SOURCE_ID,
            request_url=SOURCE_URL,
            final_url=SOURCE_URL,
            media_type="text/csv",
            retrieved_at=START,
            body=b"not,the,provider,schema\n",
        )
    )

    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(),
    ).to_dict()

    assert audit["archive_integrity_issues"] == []
    assert audit["snapshot_import_issues"][0]["code"] == "IMPORT_VALIDATION_FAILED"
    assert "SNAPSHOT_IMPORT_ISSUES_PRESENT" in audit["blocking_reasons"]
    assert audit["collection"]["validated_content_count"] == 0


def test_oe_history_allows_known_exclusions_but_keeps_their_counts(tmp_path) -> None:
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    rows = base.splitlines(keepends=True)
    incomplete = (
        b"".join(rows[1:]).replace(b"GAME001", b"GAME002").replace(b",complete,", b",partial,")
    )
    archive = SnapshotArchive(tmp_path)
    archive.store(
        RawSourceArtifact.create(
            source_id=SOURCE_ID,
            request_url=SOURCE_URL,
            final_url=SOURCE_URL,
            media_type="text/csv",
            retrieved_at=START,
            body=rows[0] + b"".join(rows[1:]) + incomplete,
        )
    )

    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(),
    ).to_dict()

    snapshot = audit["content_snapshots"][0]
    assert snapshot["imported_game_count"] == 1
    assert snapshot["rejected_game_count"] == 1
    assert snapshot["known_exclusion_game_count"] == 1
    assert snapshot["blocking_issue_game_count"] == 0
    assert snapshot["issue_counts"] == {"INCOMPLETE_GAME": 1}
    assert audit["snapshot_import_issues"] == []
    assert "SNAPSHOT_IMPORT_ISSUES_PRESENT" not in audit["blocking_reasons"]
    assert audit["warnings"] == ["KNOWN_IMPORT_EXCLUSIONS_PRESENT"]


def test_oe_history_defers_unknown_game_issues_to_the_benchmark_patch(tmp_path) -> None:
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    invalid = base.replace(
        b",100,Blue,team,Blue Team,oe:team:blue,1,,0,",
        b",100,Blue,team,Blue Team,oe:team:blue,0,,0,",
    )
    archive = SnapshotArchive(tmp_path)
    archive.store(
        RawSourceArtifact.create(
            source_id=SOURCE_ID,
            request_url=SOURCE_URL,
            final_url=SOURCE_URL,
            media_type="text/csv",
            retrieved_at=START,
            body=invalid,
        )
    )

    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(),
    ).to_dict()

    assert audit["content_snapshots"][0]["blocking_issue_game_count"] == 1
    assert audit["snapshot_import_issues"] == []
    assert "SNAPSHOT_IMPORT_ISSUES_PRESENT" not in audit["blocking_reasons"]
    assert audit["warnings"] == ["BLOCKING_GAME_IMPORT_ISSUES_PRESENT"]


def test_oe_history_does_not_count_cosmetic_file_changes_as_new_states(tmp_path) -> None:
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    archive = SnapshotArchive(tmp_path)
    for index, body in enumerate((base, base.replace(b"Blue Team", b"Renamed Blue Team"))):
        archive.store(
            RawSourceArtifact.create(
                source_id=SOURCE_ID,
                request_url=SOURCE_URL,
                final_url=SOURCE_URL,
                media_type="text/csv",
                retrieved_at=START + timedelta(days=index * 7),
                body=body,
            )
        )

    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(
            minimum_retrievals=2,
            minimum_unique_states=2,
            minimum_collection_span_days=7,
            maximum_gap_hours=168,
            outcome_horizon_days=7,
            minimum_matured_cutoffs=1,
        ),
    ).to_dict()

    assert audit["collection"]["unique_content_count"] == 2
    assert audit["collection"]["unique_normalized_state_count"] == 1
    assert audit["blocking_reasons"] == [
        "NORMALIZED_STATE_COUNT_BELOW_MINIMUM",
        "MATURED_CUTOFF_COUNT_BELOW_MINIMUM",
    ]
    assert audit["revision_ledger"] == []


def test_oe_history_surfaces_retroactive_match_revisions_as_warnings(tmp_path) -> None:
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    archive = SnapshotArchive(tmp_path)
    for index, body in enumerate((base, base.replace(b"Gnar", b"Sion"))):
        archive.store(
            RawSourceArtifact.create(
                source_id=SOURCE_ID,
                request_url=SOURCE_URL,
                final_url=SOURCE_URL,
                media_type="text/csv",
                retrieved_at=START + timedelta(days=index * 7),
                body=body,
            )
        )

    audit = audit_oe_history(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        criteria=OEHistoryCriteria(
            minimum_retrievals=2,
            minimum_unique_states=2,
            minimum_collection_span_days=7,
            maximum_gap_hours=168,
            outcome_horizon_days=7,
            minimum_matured_cutoffs=1,
        ),
    ).to_dict()

    assert audit["ready_for_historical_backtest"] is False
    assert audit["blocking_reasons"] == ["MATURED_CUTOFF_COUNT_BELOW_MINIMUM"]
    assert audit["warnings"] == ["HISTORICAL_MATCH_REVISIONS_OBSERVED"]
    assert audit["revision_ledger"][0]["added_match_count"] == 0
    assert audit["revision_ledger"][0]["removed_match_count"] == 0
    assert audit["revision_ledger"][0]["revised_match_count"] == 1
