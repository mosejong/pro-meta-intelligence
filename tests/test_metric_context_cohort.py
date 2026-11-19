import json

import pytest
from test_pregame_history_support import RETRIEVED, write_csv
from test_supported_history_cohort import import_matches

import ops.audit_pregame_history_support as hs
import ops.benchmark_metric_context_cohort as mc
import ops.benchmark_supported_history_cohort as sc
from ops.benchmark_match_baselines import DEFAULT_CONFIG, clean_records, simulate, summarize
from ops.pregame_metric_context import (
    STATUS_AVAILABLE,
    STATUS_PEERS_INSUFFICIENT,
    STATUS_TARGET_INSUFFICIENT,
)


def warmup(pairs):
    """``pairs`` rosters, each playing 5 June warmup games (all LCK, patch 16.15)."""
    return tuple(
        (f"GAMEW{k}{r}", f"2026-06-{1 + k * 5 + r:02d} 10:00:00")
        for k in range(pairs)
        for r in range(5)
    )


def roster(k):
    if k == 0:
        return {}  # fixture's own player IDs
    return {pid: {"playerid": f"oe:player:p{k}-{pid}"} for pid in range(1, 11)}


# Target 1 reuses roster 0 (5 priors each, 5 peers per role). Target 2 uses roster 1 but its
# blue top is a new player whose only game is the target itself (no history, never a peer).
TARGET_OK = ("GAMET1", "2026-07-10 10:00:00")
TARGET_NEW = ("GAMET2", "2026-07-11 10:00:00")


def fixture(tmp_path, pairs=3, targets=(TARGET_OK, TARGET_NEW)):
    games = (*warmup(pairs), *targets)
    overrides = {gameid: roster(int(gameid[5])) for gameid, _ in warmup(pairs)}
    overrides[TARGET_NEW[0]] = {**roster(1), 1: {"playerid": "oe:player:rookie"}}
    return write_csv(tmp_path, games=games, overrides=overrides)


def run_cli(source, digest, output, retrieved=RETRIEVED):
    args = ["--input", str(source), "--retrieved-at", retrieved]
    return mc.main([*args, "--content-hash", digest, "--output", str(output)])


def statuses(available, target, peers):
    return {
        STATUS_AVAILABLE: available,
        STATUS_TARGET_INSUFFICIENT: target,
        STATUS_PEERS_INSUFFICIENT: peers,
    }


# ---------------------------------------------------------------- support + partitions


def test_context_support_and_partitions_match_full_timeline_reference(tmp_path):
    source, digest = fixture(tmp_path)
    before = source.read_bytes()
    output = tmp_path / "context.json"
    assert run_cli(source, f"sha256:{digest.upper()}", output) == 0
    assert source.read_bytes() == before
    report = json.loads(output.read_text(encoding="utf-8"))

    assert report["status"] == "EVALUATED"
    assert set(mc.CLAIMS) <= set(report["claims"])
    assert report["source"]["source_hash_sha256"] == digest
    assert report["source"]["retrieved_at"] == RETRIEVED
    support = report["context_support"]
    assert support["context_spec"]["minimum_peer_players"] == 5
    assert support["context_spec"]["minimum_valid_games"] == 5
    assert support["context_spec"]["maximum_games"] == 20
    assert support["context_spec"]["publication_delay_hours"] == 24
    assert support["history_supply"]["supply_games"] == 17
    assert support["history_supply"]["supply_game_exclusions"] == {}
    overall = support["overall"]
    assert overall["target_games"] == 2
    assert overall["target_games_excluded"] == {}
    assert overall["queries"] == 20
    assert overall["query_statuses"] == statuses(19, 1, 0)
    assert overall["games_all_10_context_available"] == 1
    assert overall["games_not_all_10_context_available"] == 1
    assert support["by_league"]["LCK"] == overall

    baseline = report["baseline_run"]
    assert baseline["in_scope_games"] == 17 and baseline["warmup_games"] == 15
    assert baseline["refit_on_subset"] is False
    assert report["partition_check"] == {
        "all": 2,
        "supported": 1,
        "not_supported": 1,
        "disjoint": True,
        "union_equals_all": True,
    }

    # Independent reference: one full-timeline run, then a plain filter of its predictions.
    matches = import_matches(source)
    games, _ = clean_records(matches, DEFAULT_CONFIG, expected_hash=digest)
    full = simulate(games, DEFAULT_CONFIG)
    supported = [p for p in full if p.match_id.endswith(":GAMET1")]
    rest = [p for p in full if not p.match_id.endswith(":GAMET1")]
    parts = report["partitions"]
    assert parts["all"]["cohorts"] == summarize(full)
    assert parts["supported"]["cohorts"] == summarize(supported)
    assert parts["not_supported"]["cohorts"] == summarize(rest)
    assert {p["status"] for p in parts.values()} == {sc.STATUS_SCORED}

    # Same "all" scores as the earlier supported-history cohort CLI.
    earlier = sc.assess_cohort(source.read_bytes(), matches, expected_hash=digest)
    assert parts["all"] == earlier["partitions"]["all"]

    # Refitting only the supported game would change team Elo; the report must not do that.
    refit = simulate([g for g in games if g.match_id.endswith(":GAMET1")])
    refit_elo = summarize(refit)["all_targets"]["overall"]["team_elo"]
    assert parts["supported"]["cohorts"]["all_targets"]["overall"]["team_elo"] != refit_elo


def test_default_peer_minimum_keeps_supported_partition_empty(tmp_path):
    # Two rosters: every target player has 5 priors but only 3 same-role peers (< 5).
    source, digest = fixture(tmp_path, pairs=2, targets=(TARGET_OK,))
    raw, matches = source.read_bytes(), import_matches(source)
    report = mc.assess_context_cohort(raw, matches, expected_hash=digest)
    overall = report["context_support"]["overall"]
    assert overall["query_statuses"] == statuses(0, 0, 10)
    assert overall["games_all_10_context_available"] == 0
    assert report["partition_check"]["supported"] == 0
    assert report["partition_check"]["not_supported"] == report["partition_check"]["all"] == 1
    empty = report["partitions"]["supported"]
    assert empty["status"] == sc.STATUS_EMPTY and empty["sample_size"] == 0
    scores = empty["cohorts"]["all_targets"]["overall"]["team_elo"]
    assert scores["n"] == 0 and scores["brier"] is None and scores["logloss"] is None

    # Different criteria: the earlier 13-metric history support does accept this game.
    _, history_ids = hs.assess_support_with_ids(raw, matches, expected_hash=digest)
    assert len(history_ids) == 1


def test_duplicate_supply_match_excluded_without_patch_prefilter(tmp_path):
    source, digest = fixture(tmp_path)
    raw, matches = source.read_bytes(), import_matches(source)
    duplicated = next(m for m in matches if m.match_id.endswith(":GAMEW00"))
    report, ids = mc.assess_context_support_with_ids(
        raw, (*matches, duplicated), expected_hash=digest
    )
    assert report["history_supply"]["supply_game_exclusions"] == {"duplicate_match_id": 1}
    overall = report["overall"]
    # Roster 0 keeps only 4 priors before target 1; target 2 is unchanged (9 + rookie).
    assert overall["queries"] == 20
    assert overall["query_statuses"] == statuses(9, 11, 0)
    assert overall["games_all_10_context_available"] == 0
    assert ids == frozenset()


def test_unidentifiable_target_excluded_and_counted(tmp_path):
    dup = {"playerid": "oe:player:p1-2"}  # blue top repeats blue jng's ID
    source, digest = write_csv(
        tmp_path,
        games=(*warmup(3), TARGET_OK, TARGET_NEW),
        overrides={
            **{g: roster(int(g[5])) for g, _ in warmup(3)},
            TARGET_NEW[0]: {**roster(1), 1: dup},
        },
    )
    report, _ = mc.assess_context_support_with_ids(
        source.read_bytes(), import_matches(source), expected_hash=digest
    )
    overall = report["overall"]
    assert overall["target_games"] == 2
    assert overall["target_games_excluded"] == {"identity_invalid": 1}
    assert overall["queries"] == 10
    assert overall["query_statuses"] == statuses(10, 0, 0)
    assert overall["games_all_10_context_available"] == 1


def test_no_targets_is_explicit(tmp_path):
    source, digest = fixture(tmp_path, targets=())
    output = tmp_path / "context.json"
    assert run_cli(source, digest, output) == 0
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["status"] == "NO_EVALUATION_TARGETS"
    assert report["context_support"]["status"] == "EMPTY_COHORT"
    assert report["context_support"]["overall"]["queries"] == 0
    assert {p["status"] for p in report["partitions"].values()} == {sc.STATUS_EMPTY}


def test_wrong_bytes_rejected_by_library(tmp_path):
    source, digest = fixture(tmp_path)
    with pytest.raises(ValueError):
        mc.assess_context_support_with_ids(
            source.read_bytes() + b"\n", import_matches(source), expected_hash=digest
        )


# ---------------------------------------------------------------- privacy / refusals


def test_report_has_no_ids_values_positions_or_probabilities(tmp_path):
    source, digest = fixture(tmp_path)
    output = tmp_path / "context.json"
    run_cli(source, digest, output)
    text = output.read_text(encoding="utf-8")
    for leak in ("oe:player", "oe:team", "GAME", "Atlas", "Blue Team", "rookie", "-321"):
        assert leak not in text
    forbidden = {
        "match_id",
        "player_id",
        "team_id",
        "mean_raw",
        "position_fraction",
        "less_count",
        "equal_count",
        "greater_count",
        "candidate_count",
        "eligible_count",
        "used_match_ids",
        "probabilities",
        "blue_won",
    }

    def check_keys(node):
        if isinstance(node, dict):
            assert not forbidden.intersection(node)
            for value in node.values():
                check_keys(value)
        elif isinstance(node, list):
            for value in node:
                check_keys(value)

    check_keys(json.loads(text))


@pytest.mark.parametrize(
    "relative", ["web/public/x.json", "nested/web/dist/x.json", "report.csv", "snapshot.csv"]
)
def test_output_path_refusals(tmp_path, relative):
    source, digest = fixture(tmp_path)
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / relative)


def test_input_refusals(tmp_path):
    source, digest = fixture(tmp_path)
    before = source.read_bytes()
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
    assert source.read_bytes() == before
