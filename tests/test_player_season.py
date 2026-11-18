import hashlib
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from ops.build_player_season_history import build as build_history_file
from ops.build_player_season_history import verify_archive
from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.models import (
    DraftAction,
    MatchRecord,
    PickBanEvent,
    Provenance,
    Side,
)
from pro_meta_intelligence.opponent.player_season import (
    RECENT_GAME_LIMIT,
    RosterReference,
    build_player_season_history,
)
from pro_meta_intelligence.sources import SourceRegistry
from tests.test_opponent import FIXTURE, RETRIEVED_AT

RETRIEVED = datetime(2026, 11, 11, 2, 19, tzinfo=UTC)
CUTOFF = datetime(2026, 11, 14, 0, 0, tzinfo=UTC)
PROV = Provenance("oe", "CSV", "local-file:x", "sha256:aa", RETRIEVED, "sha256:aa")
BASIS = {
    "patch_id": "16.20",
    "cutoff": CUTOFF.isoformat(),
    "fixture_only": False,
    "source_versions": ["oe@sha256:bb#sha256:bb"],
}
SOURCE = {
    "source_id": "oe",
    "source_version": "sha256:aa",
    "content_hash": "sha256:aa",
    "retrieved_at": RETRIEVED.isoformat(),
}
REPORT = {
    "discovered_game_count": 10,
    "imported_game_count": 8,
    "rejected_game_count": 2,
    "issue_counts": {"INCOMPLETE_GAME": 2},
}


def match(
    n, when, *, patch="16.20", league="LCK", blue="oe:team:a", red="oe:team:b", avail=RETRIEVED
):
    return MatchRecord(f"m{n}", f"s{n}", league, "t", patch, blue, red, blue, when, avail, PROV)


def pick(
    n,
    team,
    player,
    champ,
    role,
    *,
    when=None,
    seq=1,
    avail=RETRIEVED,
    event_id=None,
    action=DraftAction.PICK,
):
    when = when or datetime(2026, 5, 1, tzinfo=UTC)
    return PickBanEvent(
        event_id or f"m{n}:pick:{seq}",
        f"m{n}",
        seq,
        team,
        Side.BLUE,
        action,
        champ,
        role,
        when,
        avail,
        PROV,
        player_id=player,
        player_name="Name",
    )


def run(matches, events, roster, **kw):
    return build_player_season_history(
        matches,
        events,
        roster,
        season=2026,
        cutoff=CUTOFF,
        roster_basis=BASIS,
        source=SOURCE,
        import_report=REPORT,
        **kw,
    )


def player(result, team, pid):
    return next(p for p in result["players"] if p["team_id"] == team and p["player_id"] == pid)


REF_A = RosterReference("oe:team:a", "A", "oe:player:1", "Faker")


def test_reference_cutoff_preserves_equivalent_z_notation():
    basis = {**BASIS, "cutoff": CUTOFF.isoformat().replace("+00:00", "Z")}
    result = build_player_season_history(
        [],
        [],
        [REF_A],
        season=2026,
        cutoff=CUTOFF,
        roster_basis=basis,
        source=SOURCE,
        import_report=REPORT,
    )
    assert result["cutoff"] == basis["cutoff"]
    assert result["roster_basis"] == basis


def test_point_in_time_and_year_boundary_are_excluded():
    when = datetime(2026, 5, 1, tzinfo=UTC)
    matches = [
        match(1, when),
        match(2, datetime(2025, 12, 31, 23, 59, tzinfo=UTC)),
        match(3, datetime(2026, 1, 1, 0, 0, tzinfo=UTC)),
        match(4, CUTOFF + timedelta(hours=1), avail=CUTOFF + timedelta(hours=2)),
        match(5, when, avail=CUTOFF + timedelta(seconds=1)),
    ]
    events = [pick(n, "oe:team:a", "oe:player:1", "Ahri", "MID") for n in range(1, 6)]
    # An event available after the cutoff never counts even when its match does.
    events.append(
        pick(6, "oe:team:a", "oe:player:1", "Azir", "MID", avail=CUTOFF + timedelta(days=1))
    )
    matches.append(match(6, when))
    result = run(matches, events, [REF_A])
    found = player(result, "oe:team:a", "oe:player:1")
    assert found["roles"]["MID"]["season"]["games"] == 2  # m1 and the 2026-01-01 game
    assert result["import_summary"]["excluded"]["outside_season"] == 1
    assert result["import_summary"]["excluded"]["after_cutoff"] == 2
    assert [c["champion_id"] for c in found["roles"]["MID"]["season"]["champions"]] == ["Ahri"]


def test_roles_patches_and_leagues_are_split():
    matches = [
        match(1, datetime(2026, 3, 1, tzinfo=UTC), patch="16.05", league="LCK"),
        match(2, datetime(2026, 10, 1, tzinfo=UTC), patch="16.20", league="WLDs"),
        match(3, datetime(2026, 10, 2, tzinfo=UTC), patch="16.20", league="WLDs"),
    ]
    events = [
        pick(1, "oe:team:a", "oe:player:1", "Ahri", "MID"),
        pick(2, "oe:team:a", "oe:player:1", "Azir", "MID"),
        pick(3, "oe:team:a", "oe:player:1", "Gnar", "TOP"),
    ]
    roles = player(run(matches, events, [REF_A]), "oe:team:a", "oe:player:1")["roles"]
    assert set(roles) == {"MID", "TOP"}
    mid = roles["MID"]
    assert mid["season"]["games"] == sum(c["games"] for c in mid["season"]["champions"]) == 2
    assert mid["patch"]["games"] == 1 and mid["patch"]["champions"][0]["champion_id"] == "Azir"
    assert [(row["id"], row["games"]) for row in mid["by_patch"]] == [("16.05", 1), ("16.20", 1)]
    assert [(row["id"], row["games"]) for row in mid["by_league"]] == [("LCK", 1), ("WLDs", 1)]
    assert roles["TOP"]["season"]["games"] == 1


def test_same_name_and_transfers_are_never_merged():
    matches = [
        match(1, datetime(2026, 2, 1, tzinfo=UTC)),
        match(2, datetime(2026, 8, 1, tzinfo=UTC), blue="oe:team:c", red="oe:team:b"),
    ]
    events = [
        pick(1, "oe:team:a", "oe:player:1", "Ahri", "MID"),
        pick(1, "oe:team:b", "oe:player:2", "Azir", "MID", seq=2),
        pick(2, "oe:team:c", "oe:player:1", "Syndra", "MID"),
    ]
    roster = [
        REF_A,
        RosterReference("oe:team:b", "B", "oe:player:2", "Faker"),
        RosterReference("oe:team:c", "C", "oe:player:1", "Faker"),
        RosterReference("oe:team:b", "B", "name:ghost", "Ghost"),
    ]
    result = run(matches, events, roster)
    assert (
        player(result, "oe:team:a", "oe:player:1")["roles"]["MID"]["season"]["champions"][0][
            "champion_id"
        ]
        == "Ahri"
    )
    assert (
        player(result, "oe:team:c", "oe:player:1")["roles"]["MID"]["season"]["champions"][0][
            "champion_id"
        ]
        == "Syndra"
    )
    assert player(result, "oe:team:b", "oe:player:2")["roles"]["MID"]["season"]["games"] == 1
    assert player(result, "oe:team:b", "name:ghost")["status"] == "UNSUPPORTED_ID"


def test_duplicates_and_events_without_matching_match_or_team():
    matches = [
        match(1, datetime(2026, 4, 1, tzinfo=UTC)),
        match(1, datetime(2026, 4, 1, tzinfo=UTC)),
        match(2, datetime(2026, 4, 2, tzinfo=UTC)),
        match(3, datetime(2026, 4, 3, tzinfo=UTC)),
        replace(match(3, datetime(2026, 4, 3, tzinfo=UTC)), patch_id="16.07"),
    ]
    events = [
        pick(1, "oe:team:a", "oe:player:1", "Ahri", "MID"),
        pick(1, "oe:team:a", "oe:player:1", "Ahri", "MID"),  # exact duplicate
        pick(1, "oe:team:a", "oe:player:1", "Ahri", "MID", event_id="m1:pick:copy"),
        pick(2, "oe:team:a", "oe:player:1", "Ahri", "MID", seq=1),
        pick(2, "oe:team:a", "oe:player:1", "Azir", "MID", seq=4),  # two picks in one game
        pick(3, "oe:team:a", "oe:player:1", "Ahri", "MID"),  # conflicting match record
        pick(9, "oe:team:a", "oe:player:1", "Ahri", "MID"),  # unknown match
        replace(pick(1, "oe:team:z", "oe:player:1", "Ahri", "MID"), event_id="z"),
        pick(1, "oe:team:a", "oe:player:1", "Lux", "MID", action=DraftAction.BAN, event_id="b"),
    ]
    result = run(matches, events, [REF_A])
    assert player(result, "oe:team:a", "oe:player:1")["roles"]["MID"]["season"]["games"] == 1
    excluded = result["import_summary"]["excluded"]
    assert excluded["conflicting_duplicate"] == 1
    assert excluded["conflicting_player_game"] == 1


def test_recent_is_latest_twenty_unique_games_and_full_season_is_not_truncated():
    champions = [f"C{i:02d}" for i in range(25)]
    matches = [match(i, datetime(2026, 1, 2, tzinfo=UTC) + timedelta(days=i)) for i in range(25)]
    events = [pick(i, "oe:team:a", "oe:player:1", champions[i], "JUNGLE") for i in range(25)]
    jungle = player(run(matches, events, [REF_A]), "oe:team:a", "oe:player:1")["roles"]["JUNGLE"]
    assert len(jungle["season"]["champions"]) == 25
    assert jungle["recent"]["games"] == RECENT_GAME_LIMIT
    assert {c["champion_id"] for c in jungle["recent"]["champions"]} == set(champions[5:])
    assert all(len(c["example_event_ids"]) <= 3 for c in jungle["season"]["champions"])


def test_no_sample_is_not_found_and_rejects_future_source():
    result = run([match(1, datetime(2026, 4, 1, tzinfo=UTC))], [], [REF_A])
    assert player(result, "oe:team:a", "oe:player:1") == {
        "team_id": "oe:team:a",
        "team_name": "A",
        "player_id": "oe:player:1",
        "player_name": "Faker",
        "status": "NOT_FOUND",
        "games": 0,
        "roles": {},
    }
    with pytest.raises(ValueError, match="after the cutoff"):
        build_player_season_history(
            [],
            [],
            [REF_A],
            season=2026,
            cutoff=CUTOFF,
            roster_basis=BASIS,
            source={**SOURCE, "retrieved_at": (CUTOFF + timedelta(1)).isoformat()},
            import_report=REPORT,
        )
    with pytest.raises(ValueError, match="roster basis cutoff"):
        build_player_season_history(
            [],
            [],
            [REF_A],
            season=2026,
            cutoff=RETRIEVED,
            roster_basis=BASIS,
            source=SOURCE,
            import_report=REPORT,
        )


def test_adapter_fixture_roles_come_from_events():
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        FIXTURE, retrieved_at=RETRIEVED_AT, source_timezone="+09:00"
    )
    cutoff = RETRIEVED_AT
    result = build_player_season_history(
        imported.matches,
        imported.draft_events,
        [RosterReference("oe:team:blue", "Blue Team", "oe:player:blue-jng", "Comet")],
        season=2026,
        cutoff=cutoff,
        roster_basis={**BASIS, "cutoff": cutoff.isoformat()},
        source={**SOURCE, "retrieved_at": RETRIEVED_AT.isoformat()},
        import_report=imported.report.to_dict(),
    )
    found = result["players"][0]
    assert found["status"] == "FOUND"
    assert list(found["roles"]) == ["JUNGLE"]
    assert found["roles"]["JUNGLE"]["season"]["champions"][0]["champion_id"] == "Xin Zhao"


def _archive(tmp_path: Path, data: bytes, retrieved_at: str):
    digest = hashlib.sha256(data).hexdigest()
    csv_path = tmp_path / f"{digest}.csv"
    csv_path.write_bytes(data)
    meta = tmp_path / f"{digest}.meta.json"
    meta.write_text(
        json.dumps(
            {
                "source_id": "oracles-elixir-match-data",
                "data_file": csv_path.name,
                "content_hash": f"sha256:{digest}",
                "byte_length": len(data),
                "retrieved_at": retrieved_at,
            }
        )
    )
    return csv_path, meta


def test_ops_build_verifies_archive_and_preserves_previous_output(tmp_path):
    csv_path, meta = _archive(tmp_path, FIXTURE.read_bytes(), RETRIEVED_AT.isoformat())
    assert verify_archive(csv_path, meta)["retrieved_at"] == RETRIEVED_AT
    feed = tmp_path / "feed.json"
    feed.write_text(
        json.dumps(
            {
                "patch_id": "16.15",
                "cutoff": (RETRIEVED_AT + timedelta(days=1)).isoformat(),
                "fixture_only": False,
                "evidence_index": {
                    "source_versions": [
                        {"source_id": "s", "source_version": "v", "content_hash": "h"}
                    ]
                },
                "opponent_prep": {
                    "teams": [
                        {
                            "team_id": "oe:team:blue",
                            "team_name": "Blue Team",
                            "player_profiles": [
                                {"player_id": "oe:player:blue-jng", "player_name": "Comet"}
                            ],
                        }
                    ]
                },
            }
        )
    )
    output = tmp_path / "out" / "history.json"
    result = build_history_file(csv_path, meta, feed, output, season=2026)
    assert result["found"] == 1 and output.exists()
    written = json.loads(output.read_text(encoding="utf-8"))
    assert written["source"]["retrieved_at"] == RETRIEVED_AT.isoformat()
    accepted = output.read_bytes()

    tampered = json.loads(meta.read_text())
    tampered["content_hash"] = "sha256:" + "0" * 64
    meta.write_text(json.dumps(tampered))
    with pytest.raises(ValueError, match="hash"):
        build_history_file(csv_path, meta, feed, output, season=2026)
    assert output.read_bytes() == accepted

    late_dir = tmp_path / "late"
    late_dir.mkdir()
    late_csv, late_meta = _archive(
        late_dir, FIXTURE.read_bytes(), (RETRIEVED_AT + timedelta(days=5)).isoformat()
    )
    with pytest.raises(ValueError, match="after the roster cutoff"):
        build_history_file(late_csv, late_meta, feed, output, season=2026)
    assert output.read_bytes() == accepted
    assert not list(output.parent.glob(".player-season-*"))
