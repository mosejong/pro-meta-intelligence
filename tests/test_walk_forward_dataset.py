from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.backtest.walk_forward_dataset import (
    AVAILABILITY_LAG,
    inspected_window_of,
    prepare_walk_forward,
    split_of,
    week_start,
)
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
CAPTURED = datetime(2026, 11, 18, 1, 35, tzinfo=UTC)


def game_rows(
    game_id: str, played: str, *, patch: str = "16.15", game: str = "1", year: str = "2026"
) -> bytes:
    rows = FIXTURE.read_bytes().splitlines(keepends=True)[1:]
    body = b"".join(rows)
    return (
        body.replace(b"GAME001", game_id.encode())
        .replace(b"2026-08-20 10:00:00", played.encode())
        .replace(b",1,16.15,", f",{game},{patch},".encode())
        .replace(b",LCK,2026,", f",LCK,{year},".encode())
    )


def season_csv(games) -> bytes:
    header = FIXTURE.read_bytes().splitlines(keepends=True)[0]
    return header + b"".join(
        game_rows(*game[:2], **game[2]) if len(game) > 2 else game_rows(*game) for game in games
    )


def store(root: Path, body: bytes, retrieved_at: datetime) -> str:
    artifact = RawSourceArtifact.create(
        source_id="oracles-elixir-match-data",
        request_url="https://drive.usercontent.google.com/download?id=reviewed",
        final_url="https://drive.usercontent.google.com/download?id=reviewed",
        media_type="text/csv",
        retrieved_at=retrieved_at,
        body=body,
    )
    SnapshotArchive(root).store(artifact)
    return artifact.content_hash


# Week of Mon 2026-08-17 holds G1; G2 is in the next week; G3 is played within 24h after the
# Monday cutoff of its week; G4 is a second set; G5 is a later patch with no earlier evidence.
SEASON = [
    ("G1", "2026-08-20 10:00:00"),
    ("G2", "2026-08-26 10:00:00"),
    ("G3", "2026-09-07 05:00:00"),
    ("G4", "2026-08-27 10:00:00", {"game": "2"}),
    ("G5", "2026-08-28 10:00:00", {"patch": "16.16"}),
    ("G6", "2025-12-30 10:00:00", {"year": "2025", "patch": "15.24"}),
]


def test_week_split_and_window_helpers():
    assert week_start(datetime(2026, 8, 26, 10, tzinfo=UTC)) == datetime(2026, 8, 24, tzinfo=UTC)
    assert week_start(datetime(2026, 8, 24, 0, tzinfo=UTC)) == datetime(2026, 8, 24, tzinfo=UTC)
    assert split_of(datetime(2026, 6, 30, 23, tzinfo=UTC)) == "DEV"
    assert split_of(datetime(2026, 7, 1, tzinfo=UTC)) == "VALIDATION"
    assert split_of(datetime(2026, 9, 1, tzinfo=UTC)) == "HOLDOUT"
    assert split_of(datetime(2025, 12, 31, tzinfo=UTC)) is None
    assert inspected_window_of(datetime(2026, 9, 10, tzinfo=UTC)) == "SEPTEMBER_2026_V2_REPLAY"
    assert (
        inspected_window_of(datetime(2026, 11, 5, tzinfo=UTC))
        == "NOVEMBER_2026_SOLO_RULE_DIAGNOSTIC"
    )
    assert inspected_window_of(datetime(2026, 10, 5, tzinfo=UTC)) is None


def test_walk_forward_uses_only_rows_played_before_the_week_cutoff(tmp_path):
    outcome = store(tmp_path, season_csv(SEASON), CAPTURED)
    result = prepare_walk_forward(tmp_path)
    assert result["outcome_source"]["content_hash"] == outcome
    assert result["availability"]["mode"] == "SIMULATED_FROM_PLAYED_TIME"
    assert "SIMULATED_AVAILABILITY_NOT_LIVE_HISTORY" in result["claims"]
    eligible = {match["match_id"]: match for match in result["matches"]}
    # G1 has no earlier same-patch evidence; G2 learns from G1 (G4, a second set, is later).
    assert sorted(eligible) == ["oe:LCK:G2", "oe:LCK:G3"]
    g2 = eligible["oe:LCK:G2"]
    assert g2["split"] == "VALIDATION" and g2["inspected_window"] is None
    assert len(g2["selections"]) == 20
    snapshots = {snapshot["id"]: snapshot for snapshot in result["snapshots"]}
    g2_snapshot = snapshots[g2["snapshot_id"]]
    assert g2_snapshot["cutoff"] == "2026-08-24T00:00:00+00:00"
    prep = g2_snapshot["report"]["opponent_prep"]
    evidence = {match_id for team in prep["teams"] for match_id in team["evidence"]["match_ids"]}
    assert evidence == {"oe:LCK:G1"}
    # G3 (week of 09-07) sees G1, G2 and the second set G4, but never itself or the later patch.
    g3 = eligible["oe:LCK:G3"]
    assert g3["split"] == "HOLDOUT" and g3["inspected_window"] == "SEPTEMBER_2026_V2_REPLAY"
    g3_prep = snapshots[g3["snapshot_id"]]["report"]["opponent_prep"]
    g3_evidence = {
        match_id for team in g3_prep["teams"] for match_id in team["evidence"]["match_ids"]
    }
    assert g3_evidence == {"oe:LCK:G1", "oe:LCK:G2", "oe:LCK:G4"}
    for snapshot in result["snapshots"]:
        limit = datetime.fromisoformat(snapshot["evidence_played_at_or_before"])
        assert limit == datetime.fromisoformat(snapshot["cutoff"]) - AVAILABILITY_LAG
        for team in snapshot["report"]["opponent_prep"]["teams"]:
            for game in team.get("recent_games", []):
                assert datetime.fromisoformat(game["observed_at"]) <= limit
        assert snapshot["presence"][0]["picks"] + snapshot["presence"][0]["bans"] >= 1
    audit = result["audit"]
    assert audit["eligible_matches"] == 2
    assert audit["exclusions"] == {
        "NOT_CONFIRMED_FIRST_SET": 1,
        "NO_SAME_PATCH_TRAINING": 2,
        "OUTSIDE_2026_SEASON": 1,
    }
    assert audit["by_split"]["VALIDATION"]["ELIGIBLE"] == 1
    assert prepare_walk_forward(tmp_path) == result


def test_a_row_played_within_the_lag_before_the_cutoff_is_not_evidence(tmp_path):
    # G1 is played 12h before the Monday cutoff of G2's week: not yet "available" under the 24h lag.
    store(
        tmp_path,
        season_csv([("G1", "2026-08-23 12:00:00"), ("G2", "2026-08-26 10:00:00")]),
        CAPTURED,
    )
    result = prepare_walk_forward(tmp_path)
    assert result["matches"] == []
    assert result["audit"]["exclusions"] == {"NO_SAME_PATCH_TRAINING": 2}


def test_outcome_capture_selection_skips_other_seasons_and_forbidden_files(tmp_path):
    season = store(tmp_path, season_csv(SEASON), CAPTURED)
    old = season_csv(
        [
            ("H1", "2022-06-01 10:00:00", {"year": "2022"}),
            ("H2", "2022-06-08 10:00:00", {"year": "2022"}),
        ]
    )
    older_season = store(tmp_path, old, CAPTURED + timedelta(hours=1))
    result = prepare_walk_forward(tmp_path)
    assert result["outcome_source"]["content_hash"] == season
    assert result["outcome_source"]["skipped_captures"] == [
        {"content_hash": older_season, "reason": "NOT_2026_SEASON", "season_share": 0.0}
    ]
    assert (
        prepare_walk_forward(tmp_path, outcome_hash=season)["outcome_source"]["content_hash"]
        == season
    )
    with pytest.raises(ValueError, match="no 2026 season"):
        prepare_walk_forward(tmp_path, outcome_hash=older_season)
    with pytest.raises(ValueError, match="pinned outcome"):
        prepare_walk_forward(tmp_path, outcome_hash="sha256:" + "0" * 64)


def test_empty_or_corrupt_archive_fails_closed(tmp_path):
    with pytest.raises(ValueError, match="no captures"):
        prepare_walk_forward(tmp_path)
    store(tmp_path, season_csv(SEASON), CAPTURED)
    snapshot = SnapshotArchive(tmp_path).inspect("oracles-elixir-match-data").snapshots[0]
    snapshot.data_path.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="integrity"):
        prepare_walk_forward(tmp_path)
