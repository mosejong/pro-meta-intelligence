"""Independent checks: enumerate the null distribution and audit paired tie accounting."""

from datetime import UTC, datetime
from itertools import product

from ops.benchmark_context_signal_direction import evaluate_directions, exact_binomial_two_sided
from ops.benchmark_match_baselines import Prediction


def test_exact_test_matches_enumerated_coin_flips():
    assert exact_binomial_two_sided(0, 0) is None
    for n in range(1, 11):
        outcomes = [sum(bits) for bits in product((0, 1), repeat=n)]
        for successes in range(n + 1):
            lower = sum(count <= successes for count in outcomes)
            upper = sum(count >= successes for count in outcomes)
            expected = min(1, 2 * min(lower, upper) / len(outcomes))
            assert exact_binomial_two_sided(successes, n) == expected


def test_paired_disagreements_exclude_both_kinds_of_tie():
    def prediction(key, winner, elo):
        return Prediction(
            key, "LCK", datetime(2026, 1, 1, tzinfo=UTC), winner, {"team_elo": elo}, 10, 10, True
        )

    predictions = [prediction(f"signal-{i}", 1, 0.2) for i in range(6)]
    directions = {p.match_id: 1 for p in predictions}
    predictions += [
        prediction("elo-only", 0, 0.2),
        prediction("signal-tie", 1, 0.9),
        prediction("elo-tie", 1, 0.5),
        prediction("both-tie", 0, 0.5),
    ]
    directions.update({"elo-only": 1, "signal-tie": 0, "elo-tie": 1, "both-tie": 0})
    result = evaluate_directions(directions, predictions)
    assert result["direction"] == {
        "n": 10,
        "concordant": 7,
        "discordant": 1,
        "ties": 2,
        "concordance_half_credit": 0.8,
    }
    assert result["mcnemar"]["discordant_pairs"] == 7
    assert result["mcnemar"]["signal_only_correct"] == 6
    assert result["mcnemar"]["p_value_two_sided"] == 0.125
    assert result["sign_test"]["trials_non_tie_games"] == 8
    assert result["sign_test"]["p_value_two_sided"] == 0.0703125
    assert result["elo_agreement"]["signal_tie_only"] == 1
    assert result["elo_agreement"]["elo_tie_only"] == 1
    assert result["elo_agreement"]["both_tie"] == 1
