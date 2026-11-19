import csv
import hashlib
import io
import json
from pathlib import Path

import pytest

import ops.audit_performance_coverage as pc

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
RETRIEVED = "2026-11-19T00:00:00Z"
DEFAULTS = {
    "kills": "0",
    "deaths": "2",
    "assists": "5",
    "totalgold": "987654",
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


# ---------------------------------------------------------------- helpers


def player_rows(overrides=None):
    overrides = overrides or {}
    rows = []
    for i in range(1, 11):
        side = "Blue" if i <= 5 else "Red"
        rows.append(
            {
                "participantid": str(i),
                "playerid": f"p{i}",
                "teamid": f"t-{side}",
                "side": side,
                "position": pc.ROLES[(i - 1) % 5],
                **DEFAULTS,
                **overrides.get(i, {}),
            }
        )
    return rows


def write_csv(tmp_path, *, overrides=None, drop=(), extra_games=()):
    """Real adapter fixture + metric columns. extra_games: (gameid, field_overrides) clones."""
    with FIXTURE.open(encoding="utf-8", newline="") as handle:
        base = list(csv.DictReader(handle))
    columns = [c for c in list(base[0]) + list(DEFAULTS) if c not in drop]
    out_rows = []
    for gameid, changes in (("GAME001", {}), *extra_games):
        for row in base:
            new = dict(row, gameid=gameid, **changes)
            pid = row["participantid"]
            is_player = pid in pc.PLAYER_PARTICIPANT_IDS
            for metric, value in DEFAULTS.items():
                new[metric] = value if is_player else ""
            if gameid == "GAME001":
                new.update((overrides or {}).get(int(pid), {}))
            out_rows.append({c: new.get(c, "") for c in columns})
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(out_rows)
    path = tmp_path / "snapshot.csv"
    path.write_bytes(buffer.getvalue().encode("utf-8"))
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


def run_cli(source, digest, output, *extra):
    return pc.main(
        [
            "--input",
            str(source),
            "--retrieved-at",
            RETRIEVED,
            "--content-hash",
            digest,
            "--output",
            str(output),
            *extra,
        ]
    )


# ---------------------------------------------------------------- value classification


@pytest.mark.parametrize(
    ("raw", "metric", "expected"),
    [
        ("0", "kills", "valid"),
        ("0", "golddiffat15", "valid"),
        ("", "kills", "blank"),
        ("   ", "visionscore", "blank"),
        (None, "kills", "blank"),
        ("NaN", "kills", "nonfinite"),
        ("inf", "totalgold", "nonfinite"),
        ("-Infinity", "golddiffat15", "nonfinite"),
        ("1e999", "damagetochampions", "nonfinite"),
        ("abc", "kills", "unparseable_string"),
        ("1_000", "totalgold", "unparseable_string"),
        ("1,000", "totalgold", "unparseable_string"),
        ("-1", "deaths", "negative_not_allowed"),
        ("-321", "golddiffat15", "valid"),
        ("-4.5", "xpdiffat15", "valid"),
        ("2.5", "kills", "non_integer"),
        ("3.0", "kills", "valid"),
        ("2.5", "totalgold", "valid"),
        ("0", "gamelength", "non_positive"),
        ("-10", "gamelength", "non_positive"),
    ],
)
def test_classify_value(raw, metric, expected):
    assert pc.classify_value(raw, metric) == expected


def test_absent_column_is_missing_not_zero():
    assert pc.classify_value("5", "kills", column_present=False) == "column_absent"


def test_outcome_is_never_a_metric():
    assert "result" not in pc.METRICS
    rows, _ = pc.raw_player_rows(FIXTURE.read_bytes())
    assert all("result" not in r and "playername" not in r for g in rows.values() for r in g)


# ---------------------------------------------------------------- per game


def test_observed_zero_is_valid_and_missing_is_not():
    rows = player_rows({1: {"kills": ""}, 2: {"kills": "0"}})
    game = pc.audit_game(rows, rows[0].keys())
    assert game.identity_valid
    assert game.statuses["kills"].count("valid") == 9
    assert game.statuses["kills"][0] == "blank"
    report = pc.aggregate([("LCK", "16.15", game)])["overall"]["metrics"]["kills"]
    assert report["valid"] == 9 and report["missing"]["blank"] == 1
    assert report["games_all_10_rows_valid"] == 0


def test_missing_column_counted_separately():
    rows = player_rows()
    headers = [h for h in rows[0] if h != "visionscore"]
    for r in rows:
        r.pop("visionscore")
    entry = pc.aggregate([("L", "P", pc.audit_game(rows, headers))])["overall"]["metrics"][
        "visionscore"
    ]
    assert entry["missing"] == {"blank": 0, "column_absent": 10}
    assert entry["valid"] == 0


def test_signed_negative_allowed_and_nonnegative_negative_rejected():
    rows = player_rows({3: {"golddiffat15": "-900", "assists": "-1"}})
    game = pc.audit_game(rows, rows[0].keys())
    assert game.statuses["golddiffat15"] == ["valid"] * 10
    assert game.statuses["assists"][2] == "negative_not_allowed"


def test_nan_and_infinity_rejected():
    rows = player_rows({1: {"totalgold": "NaN"}, 2: {"csdiffat15": "Infinity"}})
    game = pc.audit_game(rows, rows[0].keys())
    assert game.statuses["totalgold"][0] == "nonfinite"
    assert game.statuses["csdiffat15"][1] == "nonfinite"


def test_gamelength_mismatch_marks_game_inconsistent():
    rows = player_rows({7: {"gamelength": "1835"}})
    game = pc.audit_game(rows, rows[0].keys())
    assert game.statuses["gamelength"] == ["inconsistent_within_game"] * 10
    one_missing = player_rows({7: {"gamelength": ""}})
    game = pc.audit_game(one_missing, one_missing[0].keys())
    assert game.statuses["gamelength"].count("valid") == 9


@pytest.mark.parametrize(
    ("override", "reason", "affected"),
    [
        ({4: {"position": "adc"}}, "invalid_role", 1),
        ({4: {"position": "top"}}, "duplicate_role_in_team", 2),
        ({6: {"playerid": "p1"}}, "duplicate_playerid_in_game", 2),
        ({2: {"playerid": " "}}, "missing_playerid", 1),
        ({2: {"teamid": ""}}, "missing_teamid", 1),
        ({9: {"side": "Purple"}}, "invalid_side", 1),
        ({3: {"teamid": "t-other"}}, "teamid_inconsistent_within_side", 5),
    ],
)
def test_identity_failures_are_never_zero_filled(override, reason, affected):
    rows = player_rows(override)
    game = pc.audit_game(rows, rows[0].keys())
    assert not game.identity_valid
    out = pc.aggregate([("L", "P", game)])["overall"]
    assert out["identity"]["invalid_reason_row_counts"][reason] == affected
    assert out["identity"]["games_all_10_rows_identity_valid"] == 0
    kills = out["metrics"]["kills"]
    # numbers were present for every row, yet unresolved rows are not counted valid
    assert kills["identity_unresolved"] >= affected
    assert kills["valid"] == 10 - kills["identity_unresolved"]
    assert kills["games_all_10_rows_valid"] == 0


def test_row_accounting_and_input_not_mutated():
    rows = player_rows({1: {"kills": "x"}, 5: {"position": "bad"}})
    snapshot = [dict(r) for r in rows]
    out = pc.aggregate([("L", "P", pc.audit_game(rows, rows[0].keys()))])["overall"]
    assert rows == snapshot
    assert out["expected_player_rows"] == 10
    for entry in out["metrics"].values():
        parts = ("valid", "missing_total", "invalid_total", "identity_unresolved")
        total = sum(entry[part] for part in parts)
        assert total == 10
        assert entry["unit"] == "RAW_NOT_NORMALIZED"


# ---------------------------------------------------------------- real adapter fixture / CLI


def test_cli_real_adapter_fixture_aggregates_only(tmp_path):
    source, digest = write_csv(
        tmp_path,
        overrides={2: {"kills": ""}, 8: {"golddiffat15": "-77"}},
        extra_games=(
            ("GAME002", {"datacompleteness": "partial"}),
            ("GAME003", {"date": "2025-08-20 10:00:00", "year": "2025"}),
        ),
    )
    before = source.read_bytes()
    output = tmp_path / "out" / "coverage.json"
    assert run_cli(source, digest, output) == 0
    assert source.read_bytes() == before
    text = output.read_text(encoding="utf-8")
    report = json.loads(text)
    assert report["source"]["source_hash_sha256"] == digest
    assert report["source"]["retrieved_at"] == "2026-11-19T00:00:00Z"
    assert report["source"]["adapter_rejected_games"] == 1
    assert report["source"]["adapter_rejection_counts"] == {"INCOMPLETE_GAME": 1}
    assert report["scope"]["accepted_match_exclusions"] == {"observed_at_utc_year_out_of_scope": 1}
    assert report["scope"]["in_scope_games"] == 1
    for claim in ("NOT_PREGAME_FEATURE_ADMISSION", "NO_MODEL_EFFECT", "NO_STRENGTH_INFERENCE"):
        assert claim in report["claims"]
    overall = report["overall"]
    assert overall["expected_player_rows"] == 10
    assert overall["identity"]["valid_rows"] == 10
    assert overall["metrics"]["kills"]["valid"] == 9
    assert overall["metrics"]["kills"]["missing"]["blank"] == 1
    assert overall["metrics"]["golddiffat15"]["valid"] == 10
    assert overall["metrics"]["gamelength"]["games_all_10_rows_valid"] == 1
    assert list(report["by_league"]) == ["LCK"] and list(report["by_patch"]) == ["16.15"]
    # no values, player IDs, names, or team IDs leak
    for leaked in ("987654", "oe:player:", "oe:team:", "Atlas", "Blue Team", "GAME001"):
        assert leaked not in text


def test_cli_counts_duplicate_player_id_in_adapter_accepted_game(tmp_path):
    source, digest = write_csv(tmp_path, overrides={7: {"playerid": "oe:player:blue-top"}})
    output = tmp_path / "dup.json"
    assert run_cli(source, digest, output) == 0
    report = json.loads(output.read_text(encoding="utf-8"))
    identity = report["overall"]["identity"]
    assert report["scope"]["in_scope_games"] == 1
    assert identity["invalid_reason_row_counts"]["duplicate_playerid_in_game"] == 2
    assert report["overall"]["metrics"]["kills"]["identity_unresolved"] == 2


def test_cli_missing_metric_column_and_prefixed_hash(tmp_path):
    source, digest = write_csv(tmp_path, drop=("visionscore",))
    output = tmp_path / "absent.json"
    assert run_cli(source, "sha256:" + digest, output) == 0
    report = json.loads(output.read_text(encoding="utf-8"))
    assert "visionscore" in report["scope"]["raw_metric_columns_absent"]
    assert report["overall"]["metrics"]["visionscore"]["missing"]["column_absent"] == 10


def test_cli_refusals(tmp_path):
    source, digest = write_csv(tmp_path)
    before = source.read_bytes()
    with pytest.raises(SystemExit, match="does not match"):
        run_cli(source, "a" * 64, tmp_path / "x.json")
    with pytest.raises(SystemExit, match="web/public"):
        run_cli(source, digest, tmp_path / "web" / "public" / "x.json")
    with pytest.raises(SystemExit, match="web/public"):
        run_cli(source, digest, pc.REPO_ROOT / "web" / "public" / "x.json")
    with pytest.raises(SystemExit, match="raw snapshot archive"):
        run_cli(source, digest, pc.REPO_ROOT / "outputs" / "oracles-elixir" / "raw" / "x.json")
    with pytest.raises(SystemExit):
        run_cli(source, digest, source)
    existing = tmp_path / "exists.json"
    existing.write_text("{}")
    with pytest.raises(SystemExit, match="already exists"):
        run_cli(source, digest, existing)
    assert existing.read_text() == "{}"
    with pytest.raises(SystemExit, match="timezone"):
        pc.main(
            [
                "--input",
                str(source),
                "--retrieved-at",
                "2026-11-19T00:00:00",
                "--content-hash",
                digest,
                "--output",
                str(tmp_path / "n.json"),
            ]
        )
    assert source.read_bytes() == before
    assert not (tmp_path / "x.json").exists()


def test_snapshot_bytes_must_match_hash():
    raw = FIXTURE.read_bytes()
    with pytest.raises(ValueError, match="do not match"):
        pc.audit_snapshot(raw, (), expected_hash="b" * 64, year=2026)
