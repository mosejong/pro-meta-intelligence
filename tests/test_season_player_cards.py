import hashlib
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace

import pytest

from ops.build_season_player_cards import (
    NUGURI_ID,
    canonical_json,
    discover_candidate_ids,
    transform_career_history,
)
from tests.test_player_career import CUTOFF, archive, build, rows


def test_observed_chapters_include_reference_season_and_preserve_counts_and_provenance():
    career = build(
        archive(rows(2022, "old"), 2022),
        archive(rows(2022, "transfer", "other"), 2022),
        archive(rows(2026, "current"), 2026),
    )
    result = transform_career_history(career)
    assert result["artifact_type"] == "season-player-cards"
    assert result["schema_version"] == 1
    assert result["cutoff"] == CUTOFF.isoformat()
    assert result["sources"] == career["sources"]
    assert len(result["cards"]) == 3
    assert len({card["id"] for card in result["cards"]}) == 3
    assert {card["season"] for card in result["cards"]} == {2022, 2026}
    for card in result["cards"]:
        assert card["game_count"] == 1
        assert card["player_name"] == "same name"
        assert card["role"] == "TOP"
        assert card["champions"] == [{"champion_id": "c1", "games": 1}]
        assert card["patches"] == ["5.1"]
        assert card["source_hashes"] == sorted(
            {
                source["content_hash"]
                for source in career["sources"]
                if source["season"] == card["season"]
            }
        )
        identity = [card[key] for key in ("source_id", "player_id", "season", "team_id", "role")]
        assert card["id"] == hashlib.sha256(canonical_json(identity)).hexdigest()
    assert result["catalog_id"] == hashlib.sha256(canonical_json(result["cards"])).hexdigest()
    assert [s["season"] for s in result["seasons"]] == list(range(2014, 2027))
    assert {s["season"] for s in result["seasons"] if s["status"] == "LOADED"} == {2022, 2026}


def test_all_roles_and_distinct_sources_players_teams_are_retained():
    career = build(archive(rows(2022), 2022), ids=tuple(f"p{i}" for i in range(1, 6)))
    other = deepcopy(career["players"][0])
    other["source_id"] = "another-source"
    career["players"].append(other)
    result = transform_career_history(career)
    assert len(result["cards"]) == len({c["id"] for c in result["cards"]}) == 6
    assert {c["role"] for c in result["cards"]} == {
        "TOP",
        "JUNGLE",
        "MID",
        "BOTTOM",
        "SUPPORT",
    }
    career["players"].reverse()
    assert transform_career_history(career) == result


def test_rejected_snapshots_and_conflicts_do_not_create_cards_or_loaded_seasons():
    rejected = build(archive(rows(2022), 2022, content_hash="wrong"))
    result = transform_career_history(rejected)
    assert not result["cards"]
    assert all(s["status"] == "NOT_LOADED" for s in result["seasons"])
    changed = rows(2022)
    changed[0]["champion"] = "different"
    conflict = transform_career_history(build(archive(rows(2022), 2022), archive(changed, 2022)))
    assert not conflict["cards"]
    assert next(s for s in conflict["seasons"] if s["season"] == 2022)["status"] == "LOADED"


def test_csv_discovery_filters_year_league_role_and_future_snapshots(tmp_path, monkeypatch):
    from ops import build_season_player_cards as module

    path = tmp_path / "small.csv"
    path.write_text(
        "year,league,position,playerid\n"
        "2022,LCK,top,historical\n2022,WLDs,mid,worlds\n"
        "2022,LCK,team,team-id\n2022,OTHER,top,other-league\n"
        "2021,LCK,top,other-year\n",
        encoding="utf-8",
    )
    snapshots = [
        SimpleNamespace(data_path=path, retrieved_at=CUTOFF),
        SimpleNamespace(data_path=tmp_path / "must-not-open", retrieved_at=CUTOFF + timedelta(1)),
    ]
    monkeypatch.setattr(module, "inspect_plan", lambda *a, **kw: ({}, object()))
    monkeypatch.setattr(
        module, "archive_for_year", lambda inspection, year: SimpleNamespace(snapshots=snapshots)
    )
    assert discover_candidate_ids({"opponent_prep": {}}, tmp_path, cutoff=CUTOFF) == tuple(
        sorted({NUGURI_ID, "historical", "worlds"})
    )


def test_naive_cutoff_rejected():
    career = build()
    career["cutoff"] = "2026-11-18"
    with pytest.raises(ValueError, match="timezone aware"):
        transform_career_history(career)


def test_candidate_feed_ids_and_exact_nuguri_without_network(tmp_path):
    feed = {
        "opponent_prep": {
            "teams": [
                {"player_profiles": [{"player_id": "exact-id"}, {"player_id": "another-id"}]},
                {"player_profiles": [{"player_id": "exact-id"}]},
            ]
        }
    }
    assert discover_candidate_ids(feed, tmp_path, cutoff=CUTOFF) == tuple(
        sorted(
            {
                NUGURI_ID,
                "exact-id",
                "another-id",
            }
        )
    )


def test_explicit_candidate_seasons_discover_2015_without_reading_unrequested_years(
    tmp_path, monkeypatch
):
    from ops import build_season_player_cards as module

    files = {}
    for year in (2015, 2022):
        path = tmp_path / f"{year}.csv"
        path.write_text(
            f"year,league,position,playerid\n{year},LCK,top,player-{year}\n2021,LCK,top,wrong-year\n",
            encoding="utf-8",
        )
        files[year] = SimpleNamespace(data_path=path, retrieved_at=CUTOFF)
    requested = []
    monkeypatch.setattr(module, "inspect_plan", lambda *a, **kw: ({}, object()))

    def annual(inspection, year):
        requested.append(year)
        return SimpleNamespace(snapshots=[files[year]])

    monkeypatch.setattr(module, "archive_for_year", annual)
    result = discover_candidate_ids(
        {"opponent_prep": {}}, tmp_path, cutoff=CUTOFF, candidate_years=(2022, 2015, 2015)
    )
    assert requested == [2015, 2022]
    assert set(result) == {NUGURI_ID, "player-2015", "player-2022"}


@pytest.mark.parametrize("years", [(), (2013,), (2027,), (True,), (2015.0,)])
def test_invalid_candidate_seasons_are_rejected_before_archive_access(tmp_path, years):
    with pytest.raises(ValueError, match="candidate years"):
        discover_candidate_ids(
            {"opponent_prep": {}}, tmp_path, cutoff=CUTOFF, candidate_years=years
        )
