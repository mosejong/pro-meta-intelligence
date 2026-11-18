import json
from datetime import UTC, datetime, timedelta

from ops.player_career_archive import build_archive_history, inspect_plan
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceAttemptLedger
from tests.test_fetch_oe_history import NOW
from tests.test_player_career import archive, rows


def test_plan_is_offline_and_does_not_claim_uncollected_years_are_complete(tmp_path):
    plan, inspection = inspect_plan(tmp_path, now=NOW)
    assert len(plan["years"]) == 13
    assert all(row["status"] == "NOT_DOWNLOADED" for row in plan["years"])
    assert not inspection.snapshots
    assert plan["next_year"] == 2015
    assert plan["can_attempt_now"]
    assert not plan["network_collection_performed"]
    assert not plan["scheduler_installed"]


def test_plan_respects_shared_failed_request_interval(tmp_path):
    ledger = SourceAttemptLedger(tmp_path)
    ledger.record("oracles-elixir-match-data", "FETCH_PUBLISHED_CSV", NOW)
    plan, _ = inspect_plan(tmp_path, now=NOW + timedelta(hours=1))
    assert not plan["can_attempt_now"]
    assert plan["next_attempt_at"] == (NOW + timedelta(days=1)).isoformat()


def test_build_uses_verified_year_identity_and_preserves_actual_retrieval_time(tmp_path):
    text, _ = archive(rows(2022, date="2022-10-22T00:00:00Z"), year=2022)
    url = "https://drive.usercontent.google.com/download?id=1EHmptHyzY8owv0BAcNKtkQpMwfkURwRy"
    SnapshotArchive(tmp_path).store(
        RawSourceArtifact.create(
            source_id="oracles-elixir-match-data",
            request_url=url,
            final_url=url,
            media_type="text/csv",
            retrieved_at=NOW,
            body=text.encode(),
        )
    )
    report = build_archive_history(
        tmp_path, player_ids=("p1",), cutoff=NOW, reference_season=2026, reference_patch="16.20"
    )
    assert report["players"][0]["games"] == 1
    assert report["players"][0]["status"] == "HISTORICAL_ONLY"
    assert report["sources"][0]["retrieved_at"] == NOW.isoformat()
    before = build_archive_history(
        tmp_path,
        player_ids=("p1",),
        cutoff=datetime(2026, 11, 17, tzinfo=UTC),
        reference_season=2026,
        reference_patch="16.20",
    )
    assert not before["players"]
    assert before["coverage"]["accepted_games"] == 0
    entry = next(e for e in before["acquisition_plan"]["years"] if e["season"] == 2022)
    assert entry["status"] == "NOT_DOWNLOADED"
    assert entry["content_hash"] is None
    assert entry["retrieved_at"] is None
    assert NOW.isoformat() not in json.dumps(before)


def test_wrapper_passes_conflicting_eligible_snapshots_instead_of_latest_wins(tmp_path):
    url = "https://drive.usercontent.google.com/download?id=1EHmptHyzY8owv0BAcNKtkQpMwfkURwRy"
    for number in range(2):
        data = rows(2022)
        if number:
            data[0]["champion"] = "different"
        text, _ = archive(data, year=2022)
        SnapshotArchive(tmp_path).store(
            RawSourceArtifact.create(
                source_id="oracles-elixir-match-data",
                request_url=url,
                final_url=url,
                media_type="text/csv",
                retrieved_at=NOW + timedelta(hours=number),
                body=text.encode(),
            )
        )
    report = build_archive_history(
        tmp_path,
        player_ids=("p1",),
        cutoff=NOW + timedelta(hours=2),
        reference_season=2026,
        reference_patch="16.20",
    )
    assert report["coverage"]["accepted_games"] == 0
    assert report["coverage"]["rejection_counts"] == {"CONFLICTING_GAME": 1}
