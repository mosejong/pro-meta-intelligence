import copy
import csv
import hashlib
import io
import json
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest

import ops.audit_lane_stat_consistency as lsc
from ops.audit_performance_coverage import PLAYER_PARTICIPANT_IDS, ROLES

FIXTURE = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
RETRIEVED = "2026-11-19T00:00:00Z"
GOLD_AS, CS_AS, XP_AS, GOLD_LV, CS_LV = lsc.RULES
LANE_COLUMNS = ("goldat15", "golddiffat15", "csat15", "csdiffat15", "xpdiffat15")

# Per role (top..sup): blue/red levels give diffs +100,+50,0,-50,-100 (gold) and 2,1,0,-1,-2 (cs).
BLUE_GOLD = (5000, 5100, 5200, 5300, 5400)
RED_GOLD = (4900, 5050, 5200, 5350, 5500)
BLUE_CS = (120, 121, 122, 123, 124)
RED_CS = (118, 120, 122, 124, 126)
BLUE_XP = (60, 30, 0, -30, -60)


def lane_values(side: str, k: int) -> dict[str, str]:
    blue = side == "blue"
    gold, other_gold = (BLUE_GOLD[k], RED_GOLD[k]) if blue else (RED_GOLD[k], BLUE_GOLD[k])
    cs, other_cs = (BLUE_CS[k], RED_CS[k]) if blue else (RED_CS[k], BLUE_CS[k])
    return {
        "goldat15": str(gold),
        "golddiffat15": str(gold - other_gold),
        "csat15": str(cs),
        "csdiffat15": str(cs - other_cs),
        "xpdiffat15": str(BLUE_XP[k] if blue else -BLUE_XP[k]),
    }


def game_rows() -> list[dict[str, str]]:
    rows = []
    for s, side in enumerate(("Blue", "Red")):
        for k, role in enumerate(ROLES):
            rows.append(
                {
                    "participantid": str(s * 5 + k + 1),
                    "playerid": f"oe:player:{side}-{role}",
                    "teamid": f"oe:team:{side.lower()}",
                    "side": side,
                    "position": role,
                    **lane_values(side.lower(), k),
                }
            )
    return rows


HEADERS = list(game_rows()[0])


def with_value(side: str, role: str, **changes: str) -> list[dict[str, str]]:
    rows = game_rows()
    for row in rows:
        if row["side"].lower() == side and row["position"] == role:
            row.update(changes)
    return rows


def statuses(rows, headers=HEADERS, **kwargs):
    return lsc.audit_lane_game(rows, headers, **kwargs).statuses


def flat(game_statuses) -> list[str]:
    return [game_statuses[rule][role] for rule in lsc.RULES for role in ROLES]


# ---------------------------------------------------------------- per-game relationships


def test_coherent_five_roles_including_zero_and_negative_diffs():
    game = lsc.audit_lane_game(game_rows(), HEADERS)
    assert game.identity_valid
    assert flat(game.statuses) == ["consistent"] * 25


def test_negative_zero_is_a_valid_zero_diff():
    rows = with_value("red", "mid", golddiffat15="-0", csdiffat15="-0.0", xpdiffat15="-0")
    assert flat(statuses(rows)) == ["consistent"] * 25


def test_sign_flipped_red_diff_breaks_antisymmetry_and_reverse_direction():
    result = statuses(with_value("red", "top", golddiffat15="100"))  # blue is +100
    assert result[GOLD_AS]["top"] == "inconsistent"
    assert result[GOLD_LV]["top"] == "inconsistent"  # forward holds, reverse fails
    assert result[CS_AS]["top"] == result[CS_LV]["top"] == "consistent"
    assert flat(result).count("inconsistent") == 2


def test_antisymmetric_but_wrong_magnitude_is_level_mismatch_only():
    result = statuses(
        [
            *with_value("blue", "jng", golddiffat15="999")[:5],
            *with_value("red", "jng", golddiffat15="-999")[5:],
        ]
    )
    assert result[GOLD_AS]["jng"] == "consistent"
    assert result[GOLD_LV]["jng"] == "inconsistent"


def test_only_red_side_wrong_is_inconsistent():
    result = statuses(with_value("red", "bot", csdiffat15="2"))  # should be 1
    assert result[CS_AS]["bot"] == "inconsistent"
    assert result[CS_LV]["bot"] == "inconsistent"


def test_fixed_absolute_tolerance():
    inside = statuses(
        [
            *with_value("blue", "top", golddiffat15="100.0000005")[:5],
            *with_value("red", "top", golddiffat15="-100.0000005")[5:],
        ]
    )
    assert inside[GOLD_AS]["top"] == inside[GOLD_LV]["top"] == "consistent"
    outside = statuses(with_value("red", "top", xpdiffat15="-60.00001"))
    assert outside[XP_AS]["top"] == "inconsistent"


def test_invalid_takes_precedence_over_missing():
    rows = [
        *with_value("blue", "sup", golddiffat15="")[:5],
        *with_value("red", "sup", golddiffat15="abc")[5:],
    ]
    result = statuses(rows)
    assert result[GOLD_AS]["sup"] == "dependency_invalid"
    assert result[GOLD_LV]["sup"] == "dependency_invalid"
    blank_only = statuses(with_value("blue", "sup", golddiffat15=" "))
    assert blank_only[GOLD_AS]["sup"] == blank_only[GOLD_LV]["sup"] == "dependency_missing"


def test_invalid_level_only_blocks_level_rule():
    result = statuses(with_value("blue", "mid", goldat15="-1", csat15="122.5"))
    assert result[GOLD_LV]["mid"] == result[CS_LV]["mid"] == "dependency_invalid"
    assert result[GOLD_AS]["mid"] == result[CS_AS]["mid"] == "consistent"


def test_absent_column_is_missing_not_zero():
    rows = [{k: v for k, v in row.items() if k != "csat15"} for row in game_rows()]
    headers = [h for h in HEADERS if h != "csat15"]
    result = statuses(rows, headers)
    assert set(result[CS_LV].values()) == {"dependency_missing"}
    assert set(result[CS_AS].values()) == {"consistent"}


def test_overflow_is_arithmetic_unavailable():
    rows = [
        *with_value("blue", "top", golddiffat15="1e308")[:5],
        *with_value("red", "top", golddiffat15="1e308")[5:],
    ]
    assert statuses(rows)[GOLD_AS]["top"] == "arithmetic_unavailable"
    level = statuses(with_value("blue", "jng", goldat15="1.7e308", golddiffat15="-1.7e308"))
    assert level[GOLD_LV]["jng"] == "arithmetic_unavailable"
    assert statuses(with_value("red", "mid", golddiffat15="1e999"))[GOLD_AS]["mid"] == (
        "dependency_invalid"  # nonfinite raw input is invalid, not an arithmetic failure
    )


# ---------------------------------------------------------------- identity fail-closed


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda rows: rows[:9], {"row_count_below_10", "missing_side_role"}),
        (
            lambda rows: [*rows, dict(rows[0], participantid="1")],
            {"row_count_above_10", "duplicate_role_in_team", "duplicate_playerid_in_game"},
        ),
        (
            lambda rows: [*rows[:7], dict(rows[7], position="top"), *rows[8:]],
            {"duplicate_role_in_team", "missing_side_role"},
        ),
        (
            lambda rows: [dict(rows[0], playerid=rows[1]["playerid"]), *rows[1:]],
            {"duplicate_playerid_in_game"},
        ),
        (lambda rows: [dict(rows[0], playerid=""), *rows[1:]], {"missing_playerid"}),
        (
            lambda rows: [dict(r, teamid="oe:team:blue") for r in rows],
            {"same_teamid_both_sides"},
        ),
    ],
)
def test_identity_failures_mark_all_25_slots_unresolved(mutate, expected):
    game = lsc.audit_lane_game(mutate(game_rows()), HEADERS)
    assert expected <= game.identity_reasons
    assert flat(game.statuses) == ["identity_unresolved"] * 25


def test_teamid_must_match_adapter_record():
    game = lsc.audit_lane_game(
        game_rows(), HEADERS, expected_team_ids={"blue": "oe:team:blue", "red": "oe:team:x"}
    )
    assert game.identity_reasons == {"raw_teamid_differs_from_adapter_record"}
    assert set(flat(game.statuses)) == {"identity_unresolved"}


def test_order_invariant_and_inputs_unchanged():
    rows = with_value("red", "top", golddiffat15="100")
    snapshot = copy.deepcopy(rows)
    forward = statuses(rows)
    assert rows == snapshot
    assert statuses(list(reversed(rows))) == forward


def test_aggregate_partitions_every_slot():
    games = [
        ("LCK", "16.15", lsc.audit_lane_game(game_rows(), HEADERS)),
        ("LCK", "16.16", lsc.audit_lane_game(with_value("red", "top", golddiffat15="1"), HEADERS)),
        ("LEC", "16.15", lsc.audit_lane_game(game_rows()[:9], HEADERS)),
        ("LEC", "16.15", lsc.audit_lane_game(with_value("blue", "sup", csat15=""), HEADERS)),
    ]
    result = lsc.aggregate(games)
    overall = result["overall"]
    assert overall["games"] == 4
    assert overall["slots_total"] == 100
    assert overall["identity_unresolved_games"] == 1
    status_keys = ("consistent", "inconsistent", "missing", "invalid", "unresolved")
    for counts in overall["rules"].values():
        assert counts["slots"] == 20
        assert sum(counts[k] for k in (*status_keys, "arithmetic_unavailable")) == 20
        assert counts["tested"] == counts["consistent"] + counts["inconsistent"]
        assert counts["unresolved"] == 5
    assert overall["rules"][CS_LV]["missing"] == 1
    assert overall["rules"][GOLD_AS]["inconsistent"] == 1
    assert result["by_league"]["LEC"]["rules"][GOLD_AS]["unresolved"] == 5
    assert result["by_patch"]["16.16"]["rules"][GOLD_LV]["inconsistent"] == 1


# ---------------------------------------------------------------- snapshot / CLI


def write_csv(tmp_path, games, *, overrides=None):
    """games: (gameid, date); overrides: {gameid: {participantid: {column: value}}}."""
    with FIXTURE.open(encoding="utf-8", newline="") as handle:
        base = list(csv.DictReader(handle))
    lane = {row["participantid"]: row for row in game_rows()}
    columns = [*base[0], *LANE_COLUMNS]
    out = []
    for gameid, date in games:
        for row in base:
            new = dict(row, gameid=gameid, date=date)
            pid = row["participantid"]
            for column in LANE_COLUMNS:
                new[column] = lane[pid][column] if pid in PLAYER_PARTICIPANT_IDS else ""
            new.update((overrides or {}).get(gameid, {}).get(int(pid), {}))
            out.append({c: new.get(c, "") for c in columns})
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(out)
    path = tmp_path / "snapshot.csv"
    path.write_bytes(buffer.getvalue().encode("utf-8"))
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


GAMES = (
    ("GAME001", "2026-08-20 10:00:00"),
    ("GAME002", "2026-08-21 10:00:00"),
    ("GAME2025", "2025-12-30 10:00:00"),
)
OVERRIDES = {"GAME002": {6: {"golddiffat15": "777.25"}}}  # red top


def run_cli(source, digest, output, retrieved=RETRIEVED):
    args = ["--input", str(source), "--retrieved-at", retrieved, "--content-hash", digest]
    return lsc.main([*args, "--output", str(output)])


def test_cli_real_adapter_counts_and_source_unchanged(tmp_path):
    source, digest = write_csv(tmp_path, GAMES, overrides=OVERRIDES)
    before = source.read_bytes()
    output = tmp_path / "out" / "lane.json"
    assert run_cli(source, f"sha256:{digest.upper()}", output) == 0
    assert source.read_bytes() == before
    report = json.loads(output.read_text(encoding="utf-8"))

    assert set(lsc.CLAIMS) <= set(report["claims"])
    assert report["source"]["source_hash_sha256"] == digest
    assert report["scope"]["in_scope_games"] == 2
    assert report["scope"]["scope_exclusions"] == {"observed_at_utc_year_out_of_scope": 1}
    rules = report["overall"]["rules"]
    assert all(counts["slots"] == 10 for counts in rules.values())
    assert rules[GOLD_AS]["inconsistent"] == rules[GOLD_LV]["inconsistent"] == 1
    assert rules[CS_AS]["consistent"] == rules[CS_LV]["consistent"] == 10
    assert report["relationship_rules"]["tolerance"] == {"absolute": 1e-6, "relative": 0.0}
    assert report["relationship_rules"]["gamelength_used"] is False

    text = output.read_text(encoding="utf-8")
    leaks = ("oe:player", "oe:team", "oe:LCK", "GAME0", "GAME2", "Atlas", "Blue Team", "777.25")
    for leak in leaks:
        assert leak not in text


def test_duplicate_match_id_fails_closed(tmp_path):
    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    source, digest = write_csv(tmp_path, GAMES[:2])
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        source,
        retrieved_at=datetime.fromisoformat("2026-11-19T00:00:00+00:00"),
        source_timezone="UTC",
    )
    matches = tuple(imported.matches)
    duplicated = next(m for m in matches if m.match_id.endswith(":GAME002"))
    result = lsc.audit_snapshot(source.read_bytes(), (*matches, duplicated), expected_hash=digest)
    assert result["scope"]["scope_exclusions"] == {"duplicate_match_id_records": 2}
    assert result["scope"]["in_scope_games"] == 1
    assert result["overall"]["slots_total"] == 25


def test_extra_raw_row_for_accepted_game_is_identity_unresolved(tmp_path):
    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    source, _ = write_csv(tmp_path, GAMES[:2])
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        source,
        retrieved_at=datetime.fromisoformat("2026-11-19T00:00:00+00:00"),
        source_timezone="UTC",
    )
    raw = source.read_bytes()
    lines = raw.decode("utf-8").splitlines(keepends=True)
    extra = next(line for line in lines if line.startswith("GAME002,") and ",3,Blue,mid," in line)
    tampered = raw + extra.encode("utf-8")  # in-memory only; the source file is untouched
    digest = hashlib.sha256(tampered).hexdigest()
    # Re-bind the accepted records to the tampered bytes so only raw row grouping differs.
    matches = [
        replace(m, provenance=replace(m.provenance, content_hash=digest)) for m in imported.matches
    ]
    result = lsc.audit_snapshot(tampered, matches, expected_hash=digest)
    overall = result["overall"]
    assert overall["games"] == 2
    assert overall["identity_unresolved_games"] == 1
    reasons = overall["identity_unresolved_reason_game_counts"]
    assert reasons["row_count_above_10"] == reasons["duplicate_role_in_team"] == 1
    assert all(counts["unresolved"] == 5 for counts in overall["rules"].values())
    assert all(counts["consistent"] == 5 for counts in overall["rules"].values())


@pytest.mark.parametrize("relative", ["web/public/x.json", "nested/web/dist/x.json", "x.csv"])
def test_output_path_refusals(tmp_path, relative):
    source, digest = write_csv(tmp_path, GAMES)
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / relative)
    assert not (tmp_path / relative).exists()


def test_refuses_existing_output_source_and_bad_inputs(tmp_path):
    source, digest = write_csv(tmp_path, GAMES)
    existing = tmp_path / "existing.json"
    existing.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit):
        run_cli(source, digest, existing)
    assert existing.read_text(encoding="utf-8") == "{}"
    with pytest.raises(SystemExit):
        run_cli(source, digest, source)
    with pytest.raises(SystemExit):
        run_cli(source, "0" * 64, tmp_path / "a.json")
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / "b.json", retrieved="2026-11-19T00:00:00")
    assert not any((tmp_path / name).exists() for name in ("a.json", "b.json"))
