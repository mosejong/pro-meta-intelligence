import dataclasses
import hashlib
import math
import random
from datetime import UTC, datetime, timedelta

import pytest

import ops.benchmark_match_baselines as mb
from pro_meta_intelligence.models import MatchRecord, Provenance

HASH = "a" * 64
PROV = Provenance(
    source_id="oracles_elixir",
    source_type="PRO_MATCH_CSV_SNAPSHOT",
    source_uri="synthetic.csv",
    source_version=HASH,
    retrieved_at=datetime(2026, 11, 19, tzinfo=UTC),
    content_hash=HASH,
)
EVAL = datetime(2026, 7, 1, tzinfo=UTC)


def game(mid, blue, red, winner, at, league="LCK", names=None):
    return MatchRecord(
        match_id=mid,
        series_id=f"s-{mid}",
        league=league,
        tournament="T",
        patch_id="26.1",
        blue_team_id=blue,
        red_team_id=red,
        winner_team_id=winner,
        observed_at=at,
        available_at=datetime(2026, 11, 19, tzinfo=UTC),
        provenance=PROV,
        blue_team_name=names[0] if names else None,
        red_team_name=names[1] if names else None,
    )


def by_id(predictions):
    return {p.match_id: p for p in predictions}


def run(records, **kwargs):
    games, reasons = mb.clean_records(records, expected_hash=HASH, **kwargs)
    return mb.simulate(games), reasons


def test_exact_baselines_after_warmup():
    w1 = game("w1", "A", "B", "A", EVAL - timedelta(days=3))
    w2 = game("w2", "C", "A", "A", EVAL - timedelta(days=2))
    t1 = game("t1", "A", "C", "C", EVAL)
    preds, _ = run([w1, w2, t1])
    assert [p.match_id for p in preds] == ["t1"]
    p = preds[0]
    assert p.probabilities["fixed_half"] == 0.5
    # w1 blue won, w2 red won -> (1 + 1) / (2 + 2)
    assert p.probabilities["blue_laplace"] == pytest.approx(0.5)
    # w1: p=.5, A +10, B -10. w2 frozen at C=1500 vs A=1510 -> p_c, red(A) won.
    p_w2 = 1 / (1 + 10 ** ((1510 - 1500) / 400))
    a = 1510 + 20 * p_w2
    c = 1500 - 20 * p_w2
    assert p.probabilities["team_elo"] == pytest.approx(1 / (1 + 10 ** ((c - a) / 400)))
    assert (p.blue_prior_games, p.red_prior_games, p.mature) == (2, 1, False)


def test_delayed_result_not_used_before_publication_and_used_at_exactly_24h():
    first = game("g1", "A", "B", "A", EVAL)
    early = game("g2", "A", "B", "B", EVAL + timedelta(hours=23, minutes=59))
    exact = game("g3", "A", "B", "B", EVAL + timedelta(hours=24))
    preds = by_id(run([first, early, exact])[0])
    assert preds["g2"].probabilities["team_elo"] == 0.5
    assert preds["g2"].probabilities["blue_laplace"] == 0.5
    assert preds["g3"].probabilities["team_elo"] > 0.5
    assert preds["g3"].probabilities["blue_laplace"] == pytest.approx(2 / 3)


def test_same_time_games_never_see_each_other():
    a = game("g1", "A", "B", "A", EVAL)
    b = game("g2", "A", "B", "A", EVAL)
    preds = by_id(run([a, b])[0])
    assert preds["g1"].probabilities == preds["g2"].probabilities


def test_changing_future_winners_does_not_change_earlier_predictions():
    base = [
        game(
            f"g{i}",
            "AB"[i % 2],
            "BA"[i % 2],
            "A" if i % 3 else "B",
            EVAL - timedelta(days=10) + timedelta(hours=12 * i),
        )
        for i in range(40)
    ]
    cut = 30
    altered = base[:cut] + [
        dataclasses.replace(
            g,
            winner_team_id=g.red_team_id if g.winner_team_id == g.blue_team_id else g.blue_team_id,
        )
        for g in base[cut:]
    ]
    before, after = by_id(run(base)[0]), by_id(run(altered)[0])
    cut_time = base[cut].observed_at
    for mid, pred in before.items():
        if pred.observed_at <= cut_time + timedelta(hours=23):
            assert after[mid].probabilities == pred.probabilities
    # labels themselves reflect the flip, proving the change reached the data
    assert after[base[-1].match_id].blue_won != before[base[-1].match_id].blue_won


def test_input_order_and_names_do_not_matter():
    records = [
        game(
            f"g{i}",
            f"T{i % 4}",
            f"T{(i + 1) % 4}",
            f"T{i % 4}" if i % 2 else f"T{(i + 1) % 4}",
            EVAL - timedelta(days=5) + timedelta(hours=8 * i),
            league=["LCK", "LPL"][i % 2],
        )
        for i in range(30)
    ]
    shuffled = records[:]
    random.Random(7).shuffle(shuffled)
    renamed = [dataclasses.replace(r, blue_team_name="X", red_team_name="Y") for r in shuffled]
    snapshot = list(records)
    a = mb.assess(records, expected_hash=HASH)
    b = mb.assess(renamed, expected_hash=HASH)
    assert a == b
    assert records == snapshot


def test_duplicates_and_conflicts():
    g1 = game("g1", "A", "B", "A", EVAL)
    g2 = game("g2", "A", "B", "A", EVAL + timedelta(days=1))
    g2_conflict = dataclasses.replace(g2, winner_team_id="B")
    games, reasons = mb.clean_records([g1, g1, g2, g2_conflict], expected_hash=HASH)
    assert [g.match_id for g in games] == ["g1"]
    assert reasons == {
        "conflicting_duplicate_id_records": 2,
        "conflicting_duplicate_ids": 1,
        "exact_duplicate_records_collapsed": 1,
    }


def test_invalid_records_are_rejected_with_reasons():
    good = game("ok", "A", "B", "A", EVAL)
    outsider = game("w", "A", "B", "C", EVAL)
    same = game("s", "A", "A", "A", EVAL)
    naive = game("n", "A", "B", "A", EVAL)
    object.__setattr__(naive, "observed_at", datetime(2026, 7, 1))
    other_hash = dataclasses.replace(
        game("h", "A", "B", "A", EVAL), provenance=dataclasses.replace(PROV, content_hash="b" * 64)
    )
    games, reasons = mb.clean_records([good, outsider, same, naive, other_hash], expected_hash=HASH)
    assert [g.match_id for g in games] == ["ok"]
    assert reasons == {
        "naive_timestamp": 1,
        "provenance_hash_mismatch": 1,
        "same_team_both_sides": 1,
        "winner_not_participant": 1,
    }


def test_warmup_scope_and_mature_cohort_are_separate():
    records = []
    for i in range(6):
        records.append(game(f"w{i}", "A", "B", "A", EVAL - timedelta(days=10 - i)))
    records.append(game("old", "A", "B", "A", datetime(2025, 12, 1, tzinfo=UTC)))
    records.append(game("cl", "A", "B", "A", EVAL, league="LCK CL"))
    records.append(game("t1", "A", "B", "B", EVAL))
    records.append(game("t2", "A", "Z", "A", EVAL + timedelta(days=2)))
    result = mb.assess(records, expected_hash=HASH)
    assert result["warmup_games"] == 6
    assert result["target_games"] == 2
    assert result["exclusion_reasons"] == {"league_out_of_scope": 1, "out_of_season": 1}
    assert result["cohorts"]["all_targets"]["sample_size"] == 2
    assert result["cohorts"]["both_teams_min_prior_games"]["sample_size"] == 1
    fixed = result["cohorts"]["all_targets"]["overall"]["fixed_half"]
    assert fixed["tie_count"] == 2 and fixed["accuracy_with_half_credit_ties"] == 0.5
    assert fixed["brier"] == 0.25 and fixed["logloss"] == pytest.approx(math.log(2), abs=1e-6)


def test_score_rejects_invalid_probabilities_and_clamps_logloss():
    with pytest.raises(ValueError):
        mb.score([(float("nan"), 1)])
    with pytest.raises(ValueError):
        mb.score([(1.2, 1)])
    result = mb.score([(0.0, 1)])
    assert math.isfinite(result["logloss"]) and result["accuracy_with_half_credit_ties"] == 0.0


def test_cli_refuses_hash_mismatch_public_output_and_overwrite(tmp_path):
    source = tmp_path / "in.csv"
    source.write_bytes(b"synthetic")
    good_hash = hashlib.sha256(b"synthetic").hexdigest()
    base = ["--input", str(source), "--retrieved-at", "2026-11-19T00:00:00Z"]

    with pytest.raises(SystemExit, match="does not match"):
        mb.main([*base, "--content-hash", HASH, "--output", str(tmp_path / "o.json")])
    with pytest.raises(SystemExit, match="web/public"):
        mb.main(
            [
                *base,
                "--content-hash",
                good_hash,
                "--output",
                str(tmp_path / "web" / "public" / "o.json"),
            ]
        )
    existing = tmp_path / "exists.json"
    existing.write_text("{}")
    with pytest.raises(SystemExit, match="already exists"):
        mb.main([*base, "--content-hash", good_hash, "--output", str(existing)])
    assert existing.read_text() == "{}"
    with pytest.raises(SystemExit, match="timezone"):
        mb.main(
            [
                "--input",
                str(source),
                "--retrieved-at",
                "2026-11-19T00:00:00",
                "--content-hash",
                good_hash,
                "--output",
                str(tmp_path / "n.json"),
            ]
        )


def test_native_adapter_hash_prefix_is_verified_without_weakening_digest_check():
    match = game("prefixed", "A", "B", "A", EVAL)
    prefixed = dataclasses.replace(
        match, provenance=dataclasses.replace(PROV, content_hash="sha256:" + HASH)
    )
    accepted, reasons = mb.clean_records([prefixed], expected_hash=HASH)
    assert len(accepted) == 1 and not reasons
    rejected, reasons = mb.clean_records([prefixed], expected_hash="b" * 64)
    assert not rejected and reasons == {"provenance_hash_mismatch": 1}


def test_cli_accepts_real_adapter_fixture_and_writes_only_aggregate_report(tmp_path):
    import json
    from pathlib import Path

    source = Path(__file__).parent / "fixtures" / "oracles_elixir_game.csv"
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "research.json"
    assert (
        mb.main(
            [
                "--input",
                str(source),
                "--retrieved-at",
                "2026-11-19T00:00:00Z",
                "--content-hash",
                digest,
                "--output",
                str(output),
            ]
        )
        == 0
    )
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["source"]["source_hash_sha256"] == digest
    assert report["source"]["adapter_imported_games"] > 0
    assert "provenance_hash_mismatch" not in report["exclusion_reasons"]
    assert report["claims"]["NO_UI_EFFECT"] is True


def test_other_season_cannot_be_reported_as_a_scored_evaluation():
    old = game("old", "A", "B", "A", datetime(2022, 7, 1, tzinfo=UTC))
    report = mb.assess([old], expected_hash=HASH)
    assert report["status"] == "NO_EVALUATION_TARGETS"
    assert report["target_games"] == 0
    assert report["cohorts"]["all_targets"]["overall"]["team_elo"]["brier"] is None
    assert report["exclusion_reasons"] == {"out_of_season": 1}
