import json
from datetime import timedelta

import pytest

from ops.refresh_draft_scouts import refresh_scouts
from tests.test_opponent import FIXTURE, RETRIEVED_AT


def test_refresh_stages_all_targets_and_rejects_backward_updates(tmp_path):
    output = tmp_path / "packs"
    output.mkdir()
    existing = output / "t1-vs-red.json"
    existing.write_text(json.dumps({"cutoff": RETRIEVED_AT.isoformat()}), encoding="utf-8")
    before = existing.read_bytes()
    with pytest.raises(ValueError, match="no games"):
        refresh_scouts(
            FIXTURE,
            RETRIEVED_AT,
            output,
            targets={"red": "Red Team", "missing": "Missing"},
            own_team="Blue Team",
        )
    assert existing.read_bytes() == before
    report = refresh_scouts(
        FIXTURE, RETRIEVED_AT, output, targets={"red": "Red Team"}, own_team="Blue Team"
    )
    pack = json.loads(existing.read_text(encoding="utf-8"))
    assert report["pack_count"] == 1
    assert pack["source_version"].startswith("sha256:")
    assert pack["target"]["import_coverage"]["accepted_games"] == 1
    assert pack["matchup_bans"]["game_count"] == 1
    assert sum(ban["game_count"] for ban in pack["matchup_bans"]["phase_one"]) == 3
    assert len(pack["target"]["observed_pairs"]) == 10
    assert all(
        pair["game_count"] == len(pair["evidence_match_ids"])
        for pair in pack["target"]["observed_pairs"]
    )
    existing.write_text(
        json.dumps({"cutoff": (RETRIEVED_AT + timedelta(days=1)).isoformat()}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="backward"):
        refresh_scouts(
            FIXTURE, RETRIEVED_AT, output, targets={"red": "Red Team"}, own_team="Blue Team"
        )


def test_refresh_rolls_back_when_replacement_fails_part_way(tmp_path, monkeypatch):
    import ops.refresh_draft_scouts as refresh

    output = tmp_path / "packs"
    output.mkdir()
    first = output / "t1-vs-a.json"
    first.write_text(
        json.dumps({"cutoff": RETRIEVED_AT.isoformat(), "old": True}), encoding="utf-8"
    )
    accepted = first.read_bytes()
    real_replace = refresh.os.replace
    calls = []

    def flaky_replace(src, dst):
        calls.append(dst)
        if len(calls) == 2:
            raise OSError("disk full")
        real_replace(src, dst)

    monkeypatch.setattr(refresh.os, "replace", flaky_replace)
    with pytest.raises(OSError, match="disk full"):
        refresh_scouts(
            FIXTURE,
            RETRIEVED_AT,
            output,
            targets={"a": "Red Team", "b": "Red Team"},
            own_team="Blue Team",
        )
    assert first.read_bytes() == accepted
    assert not (output / "t1-vs-b.json").exists()
    assert sorted(p.name for p in output.iterdir()) == ["t1-vs-a.json"]
