import csv
import hashlib
import io
import json
from datetime import datetime
from pathlib import Path

import pytest

import ops.audit_pregame_history_support as hs
from ops.audit_performance_coverage import PLAYER_PARTICIPANT_IDS

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
RETRIEVED = "2026-11-19T00:00:00Z"
METRIC_VALUES = {
    "kills": "0",
    "deaths": "2",
    "assists": "5",
    "totalgold": "9876",
    "total cs": "201",
    "damagetochampions": "12345.5",
    "visionscore": "31",
    "goldat15": "5100",
    "csat15": "120",
    "golddiffat15": "-321",
    "csdiffat15": "0",
    "xpdiffat15": "44",
    "gamelength": "1834",
}
# Six prior games one day apart, the fixture's own game, and one later game (all LCK, 16.15).
HISTORY = tuple((f"GAMEH{i}", f"2026-07-0{i + 1} 10:00:00") for i in range(1, 7))
TARGET = ("GAME001", "2026-08-20 10:00:00")
FUTURE = ("GAMEF1", "2026-09-01 10:00:00")
DEFAULT_GAMES = (*HISTORY, TARGET, FUTURE)


def write_csv(tmp_path, games=DEFAULT_GAMES, *, drop=(), overrides=None):
    """games: (gameid, date); overrides: {gameid: {participantid: {column: value}}}."""
    with FIXTURE.open(encoding="utf-8", newline="") as handle:
        base = list(csv.DictReader(handle))
    columns = [c for c in list(base[0]) + list(METRIC_VALUES) if c not in drop]
    out = []
    for gameid, date in games:
        for row in base:
            new = dict(row, gameid=gameid, date=date)
            is_player = row["participantid"] in PLAYER_PARTICIPANT_IDS
            for metric, value in METRIC_VALUES.items():
                new[metric] = value if is_player else ""
            new.update((overrides or {}).get(gameid, {}).get(int(row["participantid"]), {}))
            out.append({c: new.get(c, "") for c in columns})
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(out)
    path = tmp_path / "snapshot.csv"
    path.write_bytes(buffer.getvalue().encode("utf-8"))
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


def run_cli(source, digest, output, retrieved=RETRIEVED):
    args = ["--input", str(source), "--retrieved-at", retrieved]
    return hs.main([*args, "--content-hash", digest, "--output", str(output)])


def report_for(tmp_path, **kwargs):
    source, digest = write_csv(tmp_path, **kwargs)
    output = tmp_path / "out" / "support.json"
    assert run_cli(source, digest, output) == 0
    return json.loads(output.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- counts


def test_cli_counts_exclude_target_and_future_games(tmp_path):
    source, digest = write_csv(tmp_path)
    before = source.read_bytes()
    output = tmp_path / "support.json"
    assert run_cli(source, f"sha256:{digest.upper()}", output) == 0
    assert source.read_bytes() == before
    report = json.loads(output.read_text(encoding="utf-8"))
    overall = report["overall"]

    assert report["status"] == hs.STATUS_OK
    assert set(hs.CLAIMS) <= set(report["claims"])
    assert report["source"]["source_hash_sha256"] == digest
    assert report["source"]["retrieved_at"] == RETRIEVED
    assert report["parameters"]["minimum_games"] == 5
    assert report["parameters"]["maximum_games"] == 20
    assert report["parameters"]["publication_delay_hours"] == 24
    assert report["history_supply"]["supply_games"] == 8
    assert overall["target_games"] == 8
    assert overall["queries"] == 80
    # Only the first game has no prior history; a game never counts itself or later games,
    # so exactly the 6th history game (5 priors), GAME001 (6) and the future game (7) qualify.
    assert overall["queries_zero_prior_observations"] == 10
    assert overall["queries_min_games_met"] == 30
    assert overall["games_all_10_min_games_met"] == 3
    assert set(overall["queries_metric_raw_mean_valid"].values()) == {30}
    assert overall["queries_all_metrics_raw_mean_valid"] == 30
    assert overall["games_all_10_all_metrics_raw_mean_valid"] == 3
    assert report["by_league"]["LCK"]["queries"] == 80


def test_missing_metric_column_stays_absent(tmp_path):
    report = report_for(tmp_path, drop=("visionscore",))
    overall = report["overall"]
    assert "visionscore" in report["history_supply"]["raw_metric_columns_absent"]
    assert overall["queries_metric_raw_mean_valid"]["visionscore"] == 0
    assert overall["queries_metric_raw_mean_valid"]["kills"] == 30
    assert overall["queries_all_metrics_raw_mean_valid"] == 0
    assert overall["games_all_10_all_metrics_raw_mean_valid"] == 0


def test_gamelength_mismatch_game_not_supplied(tmp_path):
    report = report_for(tmp_path, overrides={"GAMEH3": {1: {"gamelength": "999"}}})
    supply = report["history_supply"]
    assert supply["supply_game_exclusions"] == {"gamelength_inconsistent_within_game": 1}
    assert supply["supply_games"] == 7
    overall = report["overall"]
    assert overall["target_games"] == 8  # still a target; only its supply is withheld
    assert overall["games_all_10_min_games_met"] == 2
    assert overall["queries_min_games_met"] == 20


def test_unidentifiable_target_not_queried(tmp_path):
    dup = {"playerid": "oe:player:blue-top"}
    report = report_for(tmp_path, overrides={"GAME001": {2: dup}})
    overall = report["overall"]
    assert overall["target_games"] == 8
    assert overall["target_games_excluded"] == {"identity_invalid": 1}
    assert overall["queries"] == 70
    assert report["history_supply"]["supply_game_exclusions"] == {"identity_invalid": 1}
    assert overall["games_all_10_min_games_met"] == 2


def test_duplicate_match_id_excluded_from_supply_and_targets(tmp_path):
    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    source, digest = write_csv(tmp_path)
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        source,
        retrieved_at=datetime.fromisoformat("2026-11-19T00:00:00+00:00"),
        source_timezone="UTC",
    )
    matches = tuple(imported.matches)
    duplicated = next(m for m in matches if m.match_id.endswith(":GAMEH3"))
    result = hs.assess_support(source.read_bytes(), (*matches, duplicated), expected_hash=digest)
    assert result["history_supply"]["supply_game_exclusions"] == {"duplicate_match_id": 1}
    assert result["overall"]["target_games_excluded"] == {"duplicate_match_id": 1}
    assert result["overall"]["queries"] == 70
    assert result["overall"]["games_all_10_min_games_met"] == 2


def test_empty_cohort_is_explicit(tmp_path):
    games = tuple((g, d.replace("2026-07-", "2026-03-")) for g, d in HISTORY)
    report = report_for(tmp_path, games=(*games, ("GAME001", "2026-03-20 10:00:00")))
    assert report["status"] == hs.STATUS_EMPTY
    assert report["overall"]["target_games"] == 0
    assert report["overall"]["queries"] == 0
    assert report["history_supply"]["supply_games"] == 7


def test_below_minimum_history(tmp_path):
    report = report_for(tmp_path, games=(*HISTORY[:3], TARGET))
    overall = report["overall"]
    assert overall["queries"] == 40
    assert overall["queries_min_games_met"] == 0
    assert overall["games_all_10_min_games_met"] == 0
    assert overall["queries_all_metrics_raw_mean_valid"] == 0


# ---------------------------------------------------------------- privacy / refusals


def test_report_has_no_ids_names_or_values(tmp_path):
    source, digest = write_csv(tmp_path)
    output = tmp_path / "support.json"
    run_cli(source, digest, output)
    text = output.read_text(encoding="utf-8")
    for leak in ("oe:player", "oe:team", "GAME", "Atlas", "Blue Team", "used_match_ids", "12345.5"):
        assert leak not in text

    def check_keys(node):
        if isinstance(node, dict):
            assert not {
                "mean_raw",
                "used_match_ids",
                "player_id",
                "team_id",
                "match_id",
            }.intersection(node)
            for value in node.values():
                check_keys(value)
        elif isinstance(node, list):
            for value in node:
                check_keys(value)

    check_keys(json.loads(text))


@pytest.mark.parametrize(
    "relative",
    ["web/public/x.json", "nested/web/dist/x.json", "report.csv", "snapshot.csv"],
)
def test_output_path_refusals(tmp_path, relative):
    source, digest = write_csv(tmp_path)
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / relative)


def test_input_refusals(tmp_path):
    source, digest = write_csv(tmp_path)
    existing = tmp_path / "existing.json"
    existing.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit):
        run_cli(source, digest, existing)
    assert existing.read_text(encoding="utf-8") == "{}"
    with pytest.raises(SystemExit):
        run_cli(source, "0" * 64, tmp_path / "a.json")
    with pytest.raises(SystemExit):
        run_cli(source, "not-a-hash", tmp_path / "b.json")
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / "c.json", retrieved="2026-11-19T00:00:00")
    assert not any((tmp_path / name).exists() for name in ("a.json", "b.json", "c.json"))


def test_other_league_history_supplies_same_player_role_patch(tmp_path):
    overrides = {
        match_id: {participant: {"league": "VCS"} for participant in (*range(1, 11), 100, 200)}
        for match_id, _ in HISTORY
    }
    report = report_for(tmp_path, games=(*HISTORY, TARGET), overrides=overrides)
    assert report["overall"]["target_games"] == 1
    assert report["overall"]["queries"] == 10
    assert report["overall"]["games_all_10_min_games_met"] == 1
    assert report["history_supply"]["supply_games"] == 7
    assert set(report["by_league"]) == {"LCK"}
