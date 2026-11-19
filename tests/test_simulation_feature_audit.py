import csv
import io
import json
import socket
from datetime import UTC, datetime, timedelta

import pytest

from ops.audit_simulation_features import (
    FEATURE_COLUMNS,
    FORBIDDEN_PRE_GAME_FIELDS,
    audit_features,
    main,
    prior_usage,
)
from pro_meta_intelligence.opponent.player_career import CORE
from tests.test_career_archive_admission import NOW, SOURCE, no_core, store, valid
from tests.test_player_career import rows

YEAR = 2022


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def two_games(year=YEAR):
    return rows(year, game="g1", date=f"{year}-06-01 12:00:00") + rows(
        year, game="g2", date=f"{year}-06-02 12:00:00"
    )


def with_stats(data, kills="7", gold="12345"):
    stream = io.StringIO()
    fieldnames = [*CORE, "kills", "deaths", "assists", "totalgold"]
    writer = csv.DictWriter(stream, fieldnames=fieldnames)
    writer.writeheader()
    for row in data:
        writer.writerow({**row, "kills": kills, "deaths": "1", "assists": "2", "totalgold": gold})
    return stream.getvalue().encode()


def year_of(report, year=YEAR):
    return next(y for y in report["years"] if y["season"] == year)


def run(root, **kwargs):
    return audit_features(
        root, cutoff=kwargs.pop("cutoff", NOW), years=kwargs.pop("years", (YEAR,)), **kwargs
    )


def test_forbidden_list_is_explicit_and_disjoint_from_features():
    assert {"result", "kills", "deaths", "assists", "totalgold", "damagetochampions"} <= set(
        FORBIDDEN_PRE_GAME_FIELDS
    )
    assert not set(FEATURE_COLUMNS) & set(FORBIDDEN_PRE_GAME_FIELDS)


def test_usable_year_aggregates_usage_and_samples_without_raw_or_names(tmp_path):
    stored = store(tmp_path, YEAR, valid(YEAR, two_games()))
    report = run(tmp_path, include_usage=True)
    entry = year_of(report)
    assert entry["feature_status"] == "AGGREGATED"
    assert entry["admission"]["status"] == "USABLE"
    assert entry["admission"]["sources"][0]["content_hash"] == stored.content_hash.removeprefix(
        "sha256:"
    )
    features = entry["features"]
    assert features["accepted_games"] == 2
    assert features["league_games"] == {"LCK": 2}
    assert features["patch_games"] == {"5.1": 2}
    assert features["team_games"] == {"a": 2, "b": 2}
    usage = features["player_champion_role_usage"]
    assert usage["distinct_players"] == 10 and usage["distinct_player_champion_roles"] == 10
    assert usage["triples_by_min_games"] == {"ge_1": 10, "ge_3": 0, "ge_5": 0, "ge_10": 0}
    assert {"player_id": "p1", "role": "top", "champion": "c1", "games": 2} in usage["entries"]
    text = json.dumps(report)
    assert "same name" not in text and "same team name" not in text
    assert tmp_path.name not in text and '"g1"' not in text  # no paths or game IDs
    assert report["player_strength_claimed"] is False
    assert report["complete_coverage_claimed"] is False


def test_usage_entries_are_opt_in(tmp_path):
    store(tmp_path, YEAR, valid(YEAR, two_games()))
    assert year_of(run(tmp_path))["features"]["player_champion_role_usage"]["entries"] is None


def test_missing_and_unsupported_stats_are_never_zero_or_values(tmp_path):
    store(tmp_path, YEAR, valid(YEAR, two_games()))
    groups = year_of(run(tmp_path))["fields"]["groups"]
    assert groups["gold"]["status"] == "MISSING" and groups["kda"]["status"] == "MISSING"
    assert groups["gold"]["values_emitted"] is None

    other = tmp_path / "with-stats"
    store(other, YEAR, with_stats(two_games()))
    report = run(other)
    groups = year_of(report)["fields"]["groups"]
    assert groups["kda"]["status"] == "UNSUPPORTED"
    assert groups["kda"]["raw_columns_present"] == ["kills", "deaths", "assists"]
    assert groups["gold"]["status"] == "UNSUPPORTED"
    assert groups["damage"]["status"] == "MISSING"
    assert all(not g["in_match_record"] and not g["aggregated"] for g in groups.values())
    assert "12345" not in json.dumps(report)
    assert "totalgold" not in report["match_record_fields"]


def test_same_game_stats_and_outcome_do_not_change_aggregates(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    store(a, YEAR, with_stats(two_games(), kills="1", gold="100"))
    flipped = two_games()
    for row in flipped:
        row["result"] = "0" if row["result"] == "1" else "1"
    store(b, YEAR, with_stats(flipped, kills="30", gold="99999"))
    assert year_of(run(a))["features"] == year_of(run(b))["features"]


def test_prior_usage_excludes_target_same_time_and_unavailable_games():
    def game(name, day):
        data = rows(YEAR, game=name, date=f"{YEAR}-06-{day:02d} 12:00:00")
        return data

    at = NOW
    accepted = {
        ("LCK", "g1"): (game("g1", 1), at),
        ("LCK", "g2"): (game("g2", 2), at),
        ("LCK", "g3"): (game("g3", 2), at),
    }
    target = datetime(YEAR, 6, 2, 12, tzinfo=UTC)
    # Archived only at NOW: nothing was really available before the target game.
    assert prior_usage(accepted, target_observed_at=target, decision_at=target) == {}
    usage = prior_usage(accepted, target_observed_at=target, decision_at=NOW)
    assert usage[("p1", "top", "c1")] == 1  # only g1; target and same-timestamp g3 excluded


def test_archived_availability_and_simulated_delay_are_separate(tmp_path):
    recent = rows(2026, game="g1", date="2026-11-17 12:00:00") + rows(
        2026, game="g2", date="2026-06-01 12:00:00"
    )
    store(tmp_path, 2026, valid(2026, recent))
    timing = year_of(run(tmp_path, years=(2026,), simulated_delay=timedelta(hours=24)), 2026)[
        "features"
    ]["timing"]
    archived, simulated = timing["archived_availability"], timing["simulated_publication"]
    assert archived["games_observed_before_archived_availability"] == 2
    assert archived["historically_point_in_time_replayable"] is False
    assert simulated["is_real_availability"] is False
    assert simulated["games_label_ready_by_cutoff"] == 1
    assert simulated["games_label_pending_at_cutoff"] == 1


def test_missing_future_hash_and_invalid_years_are_preserved_not_aggregated(tmp_path):
    store(tmp_path, 2021, valid(2021), at=NOW + timedelta(days=1))  # future retrieval
    stored = store(tmp_path, 2022, valid(2022))
    stored.data_path.write_bytes(stored.data_path.read_bytes().replace(b"LCK", b"LPL"))
    store(tmp_path, 2023, no_core(2023))
    report = run(tmp_path, years=(2020, 2021, 2022, 2023))
    statuses = {
        y["season"]: (y["admission"]["status"], y["feature_status"]) for y in report["years"]
    }
    assert statuses == {
        2020: ("NOT_DOWNLOADED", "NOT_AGGREGATED_NOT_DOWNLOADED"),
        2021: ("NOT_AVAILABLE_AT_CUTOFF", "NOT_AGGREGATED_NOT_AVAILABLE_AT_CUTOFF"),
        2022: ("BLOCKED_INTEGRITY", "NOT_AGGREGATED_BLOCKED_INTEGRITY"),
        2023: ("INVALID_ARCHIVE", "NOT_AGGREGATED_INVALID_ARCHIVE"),
    }
    assert all(y["features"] is None and y["fields"] is None for y in report["years"])
    assert (NOW + timedelta(days=1)).isoformat() not in json.dumps(report)


def test_conflicting_versions_are_poisoned_and_partial_rejections_kept(tmp_path):
    first, second = two_games(), two_games()
    second[0]["champion"] = "different"
    store(tmp_path, YEAR, valid(YEAR, first), at=NOW - timedelta(hours=2))
    store(tmp_path, YEAR, valid(YEAR, second), at=NOW - timedelta(hours=1))
    entry = year_of(run(tmp_path))
    assert entry["admission"]["status"] == "USABLE_WITH_REJECTIONS"
    assert entry["admission"]["coverage"]["rejection_counts"] == {"CONFLICTING_GAME": 1}
    assert entry["features"]["accepted_games"] == 1
    assert "different" not in json.dumps(entry)


def test_after_cutoff_game_rows_are_rejected(tmp_path):
    data = rows(2026, game="g1", date="2026-06-01 12:00:00") + rows(
        2026, game="g2", date="2026-11-30 12:00:00"
    )
    store(tmp_path, 2026, valid(2026, data))
    entry = year_of(run(tmp_path, years=(2026,)), 2026)
    assert entry["admission"]["reasons"] == ["AFTER_CUTOFF"]
    assert entry["features"]["accepted_games"] == 1


def test_bytes_changed_after_admission_fail_closed(tmp_path, monkeypatch):
    stored = store(tmp_path, YEAR, valid(YEAR, two_games()))
    import ops.audit_simulation_features as module

    real = module.audit_archive

    def tamper(*args, **kwargs):
        report = real(*args, **kwargs)
        stored.data_path.write_bytes(b"tampered")
        return report

    monkeypatch.setattr(module, "audit_archive", tamper)
    entry = year_of(run(tmp_path))
    assert entry["feature_status"] == "FAILED_CLOSED"
    # Re-inspection drops the tampered snapshot, so the admitted set no longer matches.
    assert entry["reasons"] == ["SNAPSHOT_SET_CHANGED_AFTER_ADMISSION"]
    assert entry["features"] is None


def test_cli_writes_once_outside_archive_and_rejects_bad_inputs(tmp_path, capsys):
    archive_dir = tmp_path / "archive"
    store(archive_dir, YEAR, valid(YEAR, two_games()))
    out = tmp_path / "reports" / "features.json"
    args = ["--archive-dir", str(archive_dir), "--cutoff", NOW.isoformat(), "--year", str(YEAR)]
    assert main([*args, "--output", str(out)]) == 0
    assert tmp_path.name not in capsys.readouterr().out
    first = out.read_bytes()
    assert json.loads(first)["years"][0]["feature_status"] == "AGGREGATED"
    for bad in (
        [*args, "--output", str(out)],
        [*args, "--output", str(archive_dir / SOURCE / "x.json")],
        ["--archive-dir", str(archive_dir), "--cutoff", "2026-11-18T00:00:00", "--year", "2022"],
        ["--archive-dir", str(archive_dir), "--cutoff", NOW.isoformat()],
        [*args, "--simulated-delay-hours", "-1"],
        [*args, "--year", "2013"],
    ):
        with pytest.raises(SystemExit):
            main(bad)
    assert out.read_bytes() == first
    assert not (archive_dir / SOURCE / "x.json").exists()
