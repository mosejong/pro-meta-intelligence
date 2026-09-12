from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.backtest.draft_dataset import (
    first_game_ids,
    ordered_draft,
    prepare_dataset,
)
from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceRegistry

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
START = datetime(2026, 8, 22, 3, tzinfo=UTC)


def test_draft_order_uses_pick_and_ban_sequences_separately():
    events = (
        OracleElixirCSVAdapter(SourceRegistry.load_default())
        .import_file(FIXTURE, retrieved_at=START, source_timezone="UTC")
        .draft_events
    )
    draft = ordered_draft(events)
    assert draft == ordered_draft(list(reversed(events)))
    assert [item["turn"] for item in draft] == list(range(1, 21))
    assert draft[6]["champion_id"] == "Xin Zhao"
    assert draft[12]["kind"] == "BAN"
    assert draft[12]["side"] == "RED"
    assert draft[16]["kind"] == "PICK"
    assert draft[16]["phase"] == 2
    assert ordered_draft(events[:-1]) is None
    assert ordered_draft([events[0], *events[:-1]]) is None
    assert ordered_draft([replace(events[0], sequence=99), *events[1:]]) is None


def test_first_set_requires_consistent_provider_rows(tmp_path):
    assert first_game_ids(FIXTURE) == {"oe:LCK:GAME001"}
    path = tmp_path / "mixed.csv"
    text = FIXTURE.read_text(encoding="utf-8")
    path.write_text(text.replace(",1,16.15,", ",2,16.15,", 1), encoding="utf-8")
    assert first_game_ids(path) == set()


def build_archive(root):
    base = FIXTURE.read_bytes()
    rows = base.splitlines(keepends=True)
    second = (
        b"".join(rows[1:])
        .replace(b"GAME001", b"GAME002")
        .replace(b"2026-08-20 10:00:00", b"2026-08-25 10:00:00")
    )
    archive = SnapshotArchive(root)
    for index, body in enumerate((base, base + second)):
        archive.store(
            RawSourceArtifact.create(
                source_id="oracles-elixir-match-data",
                request_url="https://drive.usercontent.google.com/download?id=reviewed",
                final_url="https://drive.usercontent.google.com/download?id=reviewed",
                media_type="text/csv",
                retrieved_at=START + timedelta(days=index * 7),
                body=body,
            )
        )
    return archive


def test_holdout_uses_actual_earlier_capture_and_excludes_training_matches(tmp_path):
    build_archive(tmp_path)
    result = prepare_dataset(tmp_path)
    assert [item["match_id"] for item in result["matches"]] == ["oe:LCK:GAME002"]
    match = result["matches"][0]
    snapshot = result["snapshots"][0]
    assert snapshot["cutoff"] == START.isoformat()
    assert datetime.fromisoformat(snapshot["cutoff"]) < datetime.fromisoformat(match["observed_at"])
    assert snapshot["source_hash"] != match["outcome_source_hash"]
    assert all(
        "oe:LCK:GAME002" not in team["evidence"]["match_ids"]
        for team in snapshot["report"]["opponent_prep"]["teams"]
    )
    assert result["audit"]["exclusions"] == {"NO_EARLIER_CAPTURE": 1}
    assert prepare_dataset(tmp_path) == result


def test_corrupt_or_insufficient_archive_fails_closed(tmp_path):
    with pytest.raises(ValueError, match="at least two"):
        prepare_dataset(tmp_path)
    archive = build_archive(tmp_path)
    snapshot = archive.inspect("oracles-elixir-match-data").snapshots[0]
    snapshot.data_path.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="integrity"):
        prepare_dataset(tmp_path)


def test_new_holdout_excludes_all_matches_at_or_before_boundary(tmp_path):
    build_archive(tmp_path)
    boundary = datetime(2026, 8, 25, 10, tzinfo=UTC)
    result = prepare_dataset(tmp_path, observed_after=boundary)
    assert result["matches"] == []
    assert result["audit"]["observed_after"] == boundary.isoformat()
    assert result["audit"]["exclusions"] == {"BEFORE_OR_AT_HOLDOUT_BOUNDARY": 2}
    assert len(prepare_dataset(tmp_path, observed_after=START)["matches"]) == 1
    with pytest.raises(ValueError, match="timezone"):
        prepare_dataset(tmp_path, observed_after=datetime(2026, 8, 25))
