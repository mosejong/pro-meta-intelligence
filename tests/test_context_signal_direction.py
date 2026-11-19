import json
import math
from datetime import UTC, datetime

import pytest
from test_metric_context_cohort import TARGET_NEW, TARGET_OK, roster, warmup
from test_pregame_history_support import RETRIEVED, write_csv
from test_supported_history_cohort import import_matches

import ops.benchmark_context_signal_direction as sd
import ops.benchmark_metric_context_cohort as mc
from ops.benchmark_match_baselines import (
    DEFAULT_CONFIG,
    Prediction,
    clean_records,
    simulate,
    summarize,
)
from ops.pregame_metric_context import STATUS_AVAILABLE, STATUS_TARGET_INSUFFICIENT

BLUE_IDS = (1, 2, 3, 4, 5)
RED_IDS = (6, 7, 8, 9, 10)


def merge(*maps):
    out = {}
    for mapping in maps:
        for pid, columns in mapping.items():
            out[pid] = {**out.get(pid, {}), **columns}
    return out


def gold(ids, value):
    return {pid: {"golddiffat15": value} for pid in ids}


def blue_wins():
    return merge(
        {pid: {"result": "1"} for pid in (*BLUE_IDS, 100)},
        {pid: {"result": "0"} for pid in (*RED_IDS, 200)},
    )


def direction_fixture(
    tmp_path, *, high=None, target_blue_wins=False, extra=(), pairs=3, targets=None
):
    """Context-cohort fixture. Fixture red team wins every game unless ``target_blue_wins``.

    ``high`` raises roster 0's warmup golddiffat15 for those participant IDs to 500 (others -321).
    ``extra``: (gameid, date, overrides) games added on top.
    """
    tmp_path.mkdir(parents=True, exist_ok=True)  # callers may pass a fresh subdirectory
    targets = (TARGET_OK, TARGET_NEW) if targets is None else targets
    games = (*warmup(pairs), *targets, *((g, d) for g, d, _ in extra))
    overrides = {gameid: roster(int(gameid[5])) for gameid, _ in warmup(pairs)}
    overrides[TARGET_NEW[0]] = {**roster(1), 1: {"playerid": "oe:player:rookie"}}
    if high:
        for gameid, _ in warmup(pairs):
            if gameid[5] == "0":
                overrides[gameid] = merge(overrides[gameid], gold(high, "500"))
    if target_blue_wins:
        overrides[TARGET_OK[0]] = merge(overrides.get(TARGET_OK[0], {}), blue_wins())
    for gameid, _, extra_overrides in extra:
        overrides[gameid] = extra_overrides
    return write_csv(tmp_path, games=games, overrides=overrides)


def assess(source, digest):
    return sd.assess_direction(source.read_bytes(), import_matches(source), expected_hash=digest)


def run_cli(source, digest, output, retrieved=RETRIEVED):
    args = ["--input", str(source), "--retrieved-at", retrieved]
    return sd.main([*args, "--content-hash", digest, "--output", str(output)])


def q(match_id, side, fraction, status=STATUS_AVAILABLE):
    return mc.ContextQueryResult(
        match_id=match_id, side=side, status=status, position_fraction=fraction
    )


def game(match_id, blue, red):
    return [q(match_id, "blue", f) for f in blue] + [q(match_id, "red", f) for f in red]


def pred(match_id, blue_won, p_elo=0.4, league="LCK"):
    return Prediction(
        match_id=match_id,
        league=league,
        observed_at=datetime(2026, 7, 10, tzinfo=UTC),
        blue_won=blue_won,
        probabilities={"fixed_half": 0.5, "blue_laplace": 0.5, "team_elo": p_elo},
        blue_prior_games=5,
        red_prior_games=5,
        mature=True,
    )


# ---------------------------------------------------------------- real fixture: orientation


def test_equal_histories_are_an_exact_tie_and_unsupported_target_ignored(tmp_path):
    report = assess(*direction_fixture(tmp_path))
    assert report["status"] == sd.STATUS_EVALUATED
    assert report["direction"] == {
        "n": 1,
        "concordant": 0,
        "discordant": 0,
        "ties": 1,
        "concordance_half_credit": 0.5,
    }
    # The rookie target (target_insufficient) is never scored and gets no fallback.
    assert report["coverage"] == {
        "scored_supported_games": 1,
        "cohort_target_games": 2,
        "unsupported_games_scored": 0,
        "fallback": None,
    }
    assert report["context_support"]["overall"]["query_statuses"][STATUS_TARGET_INSUFFICIENT] == 1
    assert report["sign_test"]["status"] == sd.TEST_NOT_RUN_NO_NON_TIE
    assert report["sign_test"]["p_value_two_sided"] is None
    # Red won every warmup, so Elo is not a tie and favours red.
    assert report["elo_agreement"]["signal_tie_only"] == 1


def test_blue_higher_history_predicts_blue_and_label_flip_swaps_outcome(tmp_path):
    red_won = assess(*direction_fixture(tmp_path / "a", high=BLUE_IDS))
    assert red_won["direction"]["discordant"] == 1 and red_won["direction"]["concordant"] == 0
    assert red_won["elo_agreement"]["elo_only_correct"] == 1
    assert red_won["mcnemar"]["discordant_pairs"] == 1
    assert red_won["mcnemar"]["p_value_two_sided"] == 1.0

    blue_won = assess(*direction_fixture(tmp_path / "b", high=BLUE_IDS, target_blue_wins=True))
    assert blue_won["direction"]["concordant"] == 1 and blue_won["direction"]["discordant"] == 0
    assert blue_won["direction"]["concordance_half_credit"] == 1.0
    assert blue_won["elo_agreement"]["signal_only_correct"] == 1
    assert blue_won["sign_test"]["p_value_two_sided"] == 1.0


def test_red_higher_history_predicts_red(tmp_path):
    report = assess(*direction_fixture(tmp_path, high=RED_IDS))
    assert report["direction"]["concordant"] == 1
    assert report["elo_agreement"]["both_correct"] == 1
    assert report["mcnemar"]["status"] == sd.TEST_NOT_RUN_NO_DISCORDANT
    assert report["mcnemar"]["p_value_two_sided"] is None


def test_reference_rows_are_the_single_full_timeline_run_not_a_subset_refit(tmp_path):
    source, digest = direction_fixture(tmp_path, high=BLUE_IDS)
    report = assess(source, digest)
    games, _ = clean_records(import_matches(source), DEFAULT_CONFIG, expected_hash=digest)
    full = simulate(games, DEFAULT_CONFIG)
    supported = [p for p in full if p.match_id.endswith(":GAMET1")]
    assert report["reference_same_games"] == summarize(supported)["all_targets"]["overall"]
    assert report["baseline_run"]["refit_on_subset"] is False
    assert report["baseline_run"]["target_games"] == len(full)
    refit = simulate([g for g in games if g.match_id.endswith(":GAMET1")])
    refit_elo = summarize(refit)["all_targets"]["overall"]["team_elo"]
    assert report["reference_same_games"]["team_elo"] != refit_elo


def test_input_order_does_not_change_the_report(tmp_path):
    source, digest = direction_fixture(tmp_path, high=BLUE_IDS)
    raw, matches = source.read_bytes(), import_matches(source)
    forward = sd.assess_direction(raw, matches, expected_hash=digest)
    backward = sd.assess_direction(raw, tuple(reversed(matches)), expected_hash=digest)
    assert forward == backward


def test_future_and_within_delay_rows_do_not_change_target_signal_inputs(tmp_path):
    def target_queries(source, digest):
        _, _, queries = mc.assess_context_support_with_queries(
            source.read_bytes(), import_matches(source), expected_hash=digest
        )
        return [
            (x.side, x.status, x.position_fraction)
            for x in queries
            if x.match_id.endswith(":GAMET1")
        ]

    base = target_queries(*direction_fixture(tmp_path / "base", high=BLUE_IDS))
    extended = target_queries(
        *direction_fixture(
            tmp_path / "ext",
            high=BLUE_IDS,
            extra=(
                # 12h before the target: inside the simulated 24h publication delay.
                ("GAMEX1", "2026-07-09 22:00:00", gold(RED_IDS, "9999")),
                # After the target.
                ("GAMEF1", "2026-08-01 10:00:00", gold(RED_IDS, "9999")),
            ),
        )
    )
    assert len(base) == 10 and base == extended


def test_shared_iterator_keeps_support_output_and_exposes_existing_values(tmp_path):
    source, digest = direction_fixture(tmp_path, high=BLUE_IDS)
    raw, matches = source.read_bytes(), import_matches(source)
    report, ids = mc.assess_context_support_with_ids(raw, matches, expected_hash=digest)
    again, same_ids, queries = mc.assess_context_support_with_queries(
        raw, matches, expected_hash=digest
    )
    assert again == report and same_ids == ids
    assert len(queries) == report["overall"]["queries"]
    by_game = {}
    for x in queries:
        by_game.setdefault(x.match_id, []).append(x.status)
    assert ids == {m for m, s in by_game.items() if s == [STATUS_AVAILABLE] * 10}
    target = [x for x in queries if x.match_id in ids]
    assert sorted((x.side, x.position_fraction) for x in target) == sorted(
        [("blue", 1.0)] * 5 + [("red", 0.4)] * 5
    )


def test_no_supported_games_is_explicit(tmp_path):
    # Two rosters: only 3 peers per role, so nothing is supported.
    source, digest = direction_fixture(tmp_path, pairs=2, targets=(TARGET_OK,))
    report = assess(source, digest)
    assert report["status"] == sd.STATUS_NO_SUPPORTED_GAMES
    assert report["direction"]["n"] == 0
    assert report["direction"]["concordance_half_credit"] is None
    assert report["sign_test"]["p_value_two_sided"] is None
    assert report["mcnemar"]["p_value_two_sided"] is None
    assert report["reference_same_games"]["team_elo"]["n"] == 0


# ---------------------------------------------------------------- pure signal rules


def test_exact_tie_versus_almost_tie():
    ids = frozenset({"g"})
    tie = game("g", [0.1, 0.2, 0.3, 0.4, 0.5], [0.5, 0.4, 0.3, 0.2, 0.1])
    assert sd.signal_directions(tie, ids) == {"g": 0}
    # One ulp of 0.5 (2**-53) is below one ulp of the 2.5 sum (2**-51): math.fsum correctly
    # rounds both sums to 2.5, so the frozen exact-equality rule calls this a tie.
    tiny = math.nextafter(0.5, 1.0)
    assert math.fsum([0.5] * 4 + [tiny]) == math.fsum([0.5] * 5) == 2.5
    assert sd.signal_directions(game("g", [0.5] * 4 + [tiny], [0.5] * 5), ids) == {"g": 0}
    # 2**-51 is exactly representable at both 0.5 and 2.5, so the rounded sums differ.
    small = 0.5 + 2**-51
    assert math.fsum([0.5] * 4 + [small]) > math.fsum([0.5] * 5)
    assert sd.signal_directions(game("g", [0.5] * 4 + [small], [0.5] * 5), ids) == {"g": 1}
    assert sd.signal_directions(game("g", [0.5] * 5, [0.5] * 4 + [small]), ids) == {"g": -1}


def test_unsupported_queries_are_ignored_even_if_malformed():
    malformed = q("other", "purple", None, "peers_insufficient")
    queries = [*game("g", [0.6] * 5, [0.4] * 5), malformed]
    assert sd.signal_directions(queries, frozenset({"g"})) == {"g": 1}


@pytest.mark.parametrize("bad", [None, math.nan, math.inf, -math.inf, -0.01, 1.01, True, "0.5"])
def test_invalid_or_nonfinite_fraction_is_an_error(bad):
    with pytest.raises(ValueError):
        sd.signal_directions(game("g", [0.5] * 4 + [bad], [0.5] * 5), frozenset({"g"}))


def test_supported_game_shape_errors():
    ids = frozenset({"g"})
    with pytest.raises(ValueError):  # 4 blue + 6 red
        sd.signal_directions(game("g", [0.5] * 4, [0.5] * 6), ids)
    with pytest.raises(ValueError):  # 5 + 4
        sd.signal_directions(game("g", [0.5] * 5, [0.5] * 4), ids)
    with pytest.raises(ValueError):  # bad side
        sd.signal_directions([*game("g", [0.5] * 4, [0.5] * 5), q("g", "purple", 0.5)], ids)
    with pytest.raises(ValueError):  # supported but a query is not available
        sd.signal_directions(
            [*game("g", [0.5] * 4, [0.5] * 5), q("g", "blue", None, STATUS_TARGET_INSUFFICIENT)],
            ids,
        )
    with pytest.raises(ValueError):  # supported ID without queries
        sd.signal_directions(game("g", [0.5] * 5, [0.5] * 5), frozenset({"g", "missing"}))
    with pytest.raises(TypeError):
        sd.signal_directions([("g", "blue", "available", 0.5)], ids)


def test_label_join_is_strict():
    with pytest.raises(ValueError):  # supported signal game without a prediction
        sd.evaluate_directions({"g": 1, "h": 0}, (pred("g", 1),))
    with pytest.raises(ValueError):  # prediction without a supported signal
        sd.evaluate_directions({"g": 1}, (pred("g", 1), pred("h", 0)))
    with pytest.raises(ValueError):  # repeated prediction
        sd.evaluate_directions({"g": 1}, (pred("g", 1), pred("g", 1)))


def test_counts_table_and_league_appendix():
    directions = {"a": 1, "b": 1, "c": -1, "d": 0, "e": 1, "f": -1}
    supported = (
        pred("a", 1, 0.6),  # both right
        pred("b", 0, 0.6),  # both wrong
        pred("c", 0, 0.6, "LPL"),  # signal only
        pred("d", 1, 0.5),  # both tie
        pred("e", 1, 0.5),  # Elo tie only (signal right)
        pred("f", 1, 0.6, "LPL"),  # Elo only
    )
    result = sd.evaluate_directions(directions, supported)
    assert result["direction"] == {
        "n": 6,
        "concordant": 3,
        "discordant": 2,
        "ties": 1,
        "concordance_half_credit": round(3.5 / 6, 6),
    }
    assert {k: v for k, v in result["elo_agreement"].items() if k != "rule"} == {
        "both_correct": 1,
        "signal_only_correct": 1,
        "elo_only_correct": 1,
        "both_wrong": 1,
        "signal_tie_only": 0,
        "elo_tie_only": 1,
        "both_tie": 1,
    }
    assert result["sign_test"]["trials_non_tie_games"] == 5
    assert result["sign_test"]["p_value_two_sided"] == 1.0
    assert result["mcnemar"]["discordant_pairs"] == 2
    assert result["by_league_descriptive"]["leagues"] == {
        "LCK": {"n": 4, "concordant": 2},
        "LPL": {"n": 2, "concordant": 1},
    }


def test_empty_evaluation_reports_no_rates_or_tests():
    result = sd.evaluate_directions({}, ())
    assert result["direction"]["n"] == 0
    assert result["direction"]["concordance_half_credit"] is None
    assert result["sign_test"]["status"] == sd.TEST_NOT_RUN_NO_NON_TIE
    assert result["mcnemar"]["status"] == sd.TEST_NOT_RUN_NO_DISCORDANT


@pytest.mark.parametrize(
    ("k", "n", "expected"),
    [
        (0, 0, None),
        (0, 1, 1.0),
        (1, 1, 1.0),
        (5, 5, 0.0625),
        (0, 5, 0.0625),
        (8, 10, 0.109375),
        (2, 10, 0.109375),
        (5, 10, 1.0),
        (0, 20, 2 / 2**20),
    ],
)
def test_exact_binomial_known_values(k, n, expected):
    assert sd.exact_binomial_two_sided(k, n) == expected


def test_exact_binomial_rejects_bad_counts():
    for args in ((3, 2), (-1, 2), (0, -1)):
        with pytest.raises(ValueError):
            sd.exact_binomial_two_sided(*args)
    with pytest.raises(TypeError):
        sd.exact_binomial_two_sided(True, 2)


# ---------------------------------------------------------------- CLI privacy / refusals

TOP_LEVEL = {
    "artifact_type",
    "local_diagnostic",
    "claims",
    "source",
    "status",
    "config",
    "signal_spec",
    "baseline_run",
    "context_support",
    "coverage",
    "direction",
    "sign_test",
    "elo_agreement",
    "mcnemar",
    "by_league_descriptive",
    "reference_same_games",
    "interpretation",
    "network_collection_performed",
    "source_modified",
    "publication_permitted",
}
FORBIDDEN_KEYS = {
    "match_id",
    "player_id",
    "team_id",
    "mean_raw",
    "position_fraction",
    "probabilities",
    "blue_won",
    "side",
    "signal_value",
    "less_count",
    "equal_count",
    "greater_count",
}


def test_cli_report_is_aggregate_only(tmp_path):
    source, digest = direction_fixture(tmp_path, high=BLUE_IDS)
    before = source.read_bytes()
    output = tmp_path / "direction.json"
    assert run_cli(source, f"sha256:{digest.upper()}", output) == 0
    assert source.read_bytes() == before
    report = json.loads(output.read_text(encoding="utf-8"))
    assert set(report) == TOP_LEVEL
    assert report["claims"] == list(sd.CLAIMS)
    assert report["source"]["source_hash_sha256"] == digest
    assert report["publication_permitted"] is False
    assert set(report["reference_same_games"]) == {"fixed_half", "blue_laplace", "team_elo"}
    assert set(report["by_league_descriptive"]["leagues"]["LCK"]) == {"n", "concordant"}

    def walk(node):
        if isinstance(node, dict):
            assert not FORBIDDEN_KEYS.intersection(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
        elif isinstance(node, str):
            # Identifiers in the fixture all start with "oe:" (players, teams, match IDs).
            assert not node.startswith("oe:")
            assert "rookie" not in node

    walk(report)


@pytest.mark.parametrize(
    "relative", ["web/public/x.json", "nested/web/dist/x.json", "report.csv", "snapshot.csv"]
)
def test_output_path_refusals(tmp_path, relative):
    source, digest = direction_fixture(tmp_path)
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / relative)


def test_input_refusals_and_no_overwrite(tmp_path):
    source, digest = direction_fixture(tmp_path)
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


def test_library_rejects_wrong_bytes(tmp_path):
    source, digest = direction_fixture(tmp_path)
    with pytest.raises(ValueError):
        sd.assess_direction(
            source.read_bytes() + b"\n", import_matches(source), expected_hash=digest
        )


def test_source_changed_during_run_writes_nothing(tmp_path, monkeypatch):
    source, digest = direction_fixture(tmp_path)
    original = sd.assess_direction

    def mutate_then_assess(*args, **kwargs):
        result = original(*args, **kwargs)
        source.write_bytes(source.read_bytes() + b"\n")
        return result

    monkeypatch.setattr(sd, "assess_direction", mutate_then_assess)
    output = tmp_path / "changed.json"
    with pytest.raises(SystemExit):
        run_cli(source, digest, output)
    assert not output.exists()
