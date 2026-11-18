import csv
import hashlib
import io
from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.opponent.player_career import CORE, build_player_career_history

CUTOFF = datetime(2026, 11, 18, tzinfo=UTC)


def rows(year=2015, game="g", team="a", date="2016-01-01 12:00:00"):
    result = []
    for side, base, tid, win in (("Blue", 0, team, "1"), ("Red", 5, "b", "0")):
        for n, role in enumerate(("top", "jng", "mid", "bot", "sup"), 1):
            result.append(
                dict(
                    zip(
                        CORE,
                        (
                            game,
                            str(year),
                            "LCK",
                            date,
                            "5.1",
                            str(base + n),
                            side,
                            role,
                            f"p{base + n}",
                            "same name",
                            tid,
                            "same team name",
                            f"c{base + n}",
                            win,
                        ),
                        strict=True,
                    )
                )
            )
        result.append(
            dict(
                zip(
                    CORE,
                    (
                        game,
                        str(year),
                        "LCK",
                        date,
                        "5.1",
                        "100" if base == 0 else "200",
                        side,
                        "team",
                        "",
                        "",
                        tid,
                        "team",
                        "",
                        win,
                    ),
                    strict=True,
                )
            )
        )
    return result


def archive(data=None, year=2015, **meta):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=CORE)
    writer.writeheader()
    writer.writerows(rows(year) if data is None else data)
    text = "\ufeff" + stream.getvalue()
    return text, {
        "source_id": "oe",
        "season": year,
        "retrieved_at": "2026-11-17T00:00:00+00:00",
        "content_hash": hashlib.sha256(text.encode()).hexdigest(),
        **meta,
    }


def build(*archives, ids=("p1",)):
    return build_player_career_history(
        list(archives), player_ids=ids, cutoff=CUTOFF, reference_season=2026, reference_patch="5.1"
    )


def test_multi_year_transfer_gaps_and_exact_identity():
    result = build(
        archive(),
        archive(rows(2017, "g2", "transfer"), 2017),
        ids=("p1", "p2", "unknown", "name:same name"),
    )
    player = next(p for p in result["players"] if p["player_id"] == "p1")
    assert player["games"] == 2
    assert player["status"] == "HISTORICAL_ONLY"
    seasons = {s["season"]: s for s in player["seasons"]}
    assert seasons[2016]["status"] == "NOT_LOADED"
    assert seasons[2026]["status"] == "NOT_LOADED"
    chapter = seasons[2015]["chapters"][0]
    assert chapter["team_id"] == "a"
    assert chapter["champion_counts"] == {"c1": 1}
    assert chapter["patches"] == {"5.1": {"c1": 1}}
    assert chapter["first_observed_at"].startswith("2016-01-01")
    assert seasons[2017]["chapters"][0]["team_id"] == "transfer"
    assert player["observation_gap"]["kind"] == "OBSERVATION_GAP"
    by_id = {p["player_id"]: p for p in result["players"]}
    assert by_id["p2"]["games"] == 2
    assert by_id["unknown"]["status"] == "NOT_OBSERVED"
    assert by_id["unknown"]["observation_gap"] is None
    assert by_id["name:same name"]["status"] == "UNSUPPORTED_ID"


@pytest.mark.parametrize(
    "reason,kwargs",
    [
        ("HASH_MISMATCH", {"content_hash": "bad"}),
        ("RETRIEVED_AFTER_CUTOFF", {"retrieved_at": "2026-11-19T00:00:00Z"}),
        ("INVALID_ARCHIVE", {"retrieved_at": "2026-11-17"}),
    ],
)
def test_metadata_gates(reason, kwargs):
    result = build(archive(**kwargs))
    assert result["coverage"]["accepted_games"] == 0
    assert result["coverage"]["rejection_counts"][reason] == 1


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"date": "2026-11-19"}, "AFTER_CUTOFF"),
        ({"year": "2014"}, "SEASON_MISMATCH"),
        ({"playerid": ""}, "MISSING_STABLE_ID"),
        ({"playerid": "name:foo"}, "MISSING_STABLE_ID"),
        ({"playerid": "p2"}, "DUPLICATE_PLAYER"),
        ({"champion": "c2"}, "INVALID_CHAMPIONS"),
        ({"result": "0"}, "INCONSISTENT_TEAM"),
        ({"teamid": "different"}, "INCONSISTENT_TEAM"),
        ({"position": "sup"}, "INCONSISTENT_TEAM"),
    ],
)
def test_game_rejections(change, reason):
    data = rows()
    data[0].update(change)
    result = build(archive(data))
    assert result["coverage"]["accepted_games"] == 0
    assert result["coverage"]["rejection_counts"][reason] == 1


def test_complete_team_rows_required():
    result = build(archive(rows()[:-1]))
    assert result["coverage"]["rejection_counts"] == {"INCOMPLETE_PARTICIPANTS": 1}


def test_duplicates_and_conflicts_order_independent():
    a = archive()
    identical = archive(list(reversed(rows())))
    result = build(a, identical)
    assert result["players"][0]["games"] == 1
    assert result["coverage"]["identical_duplicates"] == 1
    data = rows()
    data[0]["champion"] = "different"
    conflict = archive(data)
    for snapshots in ((a, identical, conflict), (conflict, identical, a)):
        result = build(*snapshots)
        assert result["coverage"]["accepted_games"] == 0
        assert result["coverage"]["rejection_counts"] == {"CONFLICTING_GAME": 1}


def test_current_season_and_loaded_absence():
    result = build(archive(), archive(rows(2026, "current"), 2026), ids=("p1", "absent"))
    by_id = {p["player_id"]: p for p in result["players"]}
    assert by_id["p1"]["status"] == "CURRENT_SEASON_OBSERVED"
    assert by_id["absent"]["seasons"][-1]["status"] == "NOT_OBSERVED"


def test_bytes_and_aware_cutoff():
    text, meta = archive()
    assert build((text.encode(), meta)) == build((text, meta))
    with pytest.raises(ValueError, match="timezone aware"):
        build_player_career_history(
            [],
            player_ids=(),
            cutoff=datetime(2026, 1, 1),
            reference_season=2026,
            reference_patch="16.1",
        )


def test_invalid_conflict_and_snapshot_order_are_deterministic():
    valid = archive()
    data = rows()
    data[0]["playerid"] = ""
    invalid = archive(data)
    assert build(valid, invalid) == build(invalid, valid)
    assert build(valid, invalid)["coverage"]["rejection_counts"] == {"CONFLICTING_GAME": 1}


def test_sources_are_distinct_and_optional_stats_do_not_affect_deduplication():
    text, meta = archive()
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=(*CORE, "kills"))
    writer.writeheader()
    writer.writerows({**r, "kills": 99} for r in rows())
    extra = stream.getvalue()
    changed = {**meta, "content_hash": hashlib.sha256(extra.encode()).hexdigest()}
    result = build((text, meta), (extra, changed), (text, {**meta, "source_id": "other"}))
    assert result["coverage"]["accepted_games"] == 2
    assert [p["games"] for p in result["players"]] == [1, 1]


def test_missing_core_schema_is_rejected():
    text = "gameid,year\ng,2015\n"
    _, meta = archive()
    meta["content_hash"] = hashlib.sha256(text.encode()).hexdigest()
    assert build((text, meta))["coverage"]["rejection_counts"] == {"MISSING_CORE_COLUMNS": 1}


def test_short_malformed_row_does_not_crash_sorting_with_valid_games():
    text, meta = archive()
    text += "short-row\n"
    meta["content_hash"] = hashlib.sha256(text.encode()).hexdigest()
    result = build((text, meta))
    assert result["coverage"]["accepted_games"] == 1
    assert result["coverage"]["rejection_counts"] == {"INCOMPLETE_PARTICIPANTS": 1}


def test_entire_target_range_is_marked_without_claiming_retirement():
    player = build(archive())["players"][0]
    assert [chapter["season"] for chapter in player["seasons"]] == list(range(2014, 2027))
    assert player["seasons"][0]["status"] == "NOT_LOADED"
    assert "retired" not in player


def test_invalid_source_type_is_reported_as_invalid_archive():
    result = build(archive(source_id=9))
    assert result["coverage"]["rejection_counts"] == {"INVALID_ARCHIVE": 1}
