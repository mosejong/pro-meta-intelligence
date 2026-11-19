"""Fixed directional golddiffat15 context-signal diagnostic on the context-supported subset.

Local exploratory research diagnostic implementing the frozen specification in
``docs/CONTEXT_SIGNAL_DIRECTION_2026-11-20.md`` (committed before any directional run). It is NOT a
player model, probability, feature admission, normalization or tuning step:

- Games: exactly the supported frozenset of the unchanged context-support pass
  (``assess_context_support_with_queries``). Unsupported games are never scored; no fallback.
- Signal per game: ``S = fsum(blue five position fractions) - fsum(red five)`` using the fractions
  already computed by the support pass (never recomputed). ``S > 0`` -> blue, ``S < 0`` -> red,
  exact equality of the two ``math.fsum`` results -> tie. No weights, thresholds, scaling or fit.
- Labels: ``Prediction.blue_won`` from ONE full-timeline ``clean_records`` + ``simulate`` run,
  joined by match ID in-process via the existing ``partition_predictions``. No subset refit.
- Reported: n / concordant / discordant / ties / half-credit concordance, coverage, the existing
  same-set ``summarize`` rows (fixed 0.5, blue Laplace, team Elo), a fixed signal-vs-Elo 2x2 with
  ties counted separately, an exact two-sided sign test and an exact McNemar test (both p = 0.5,
  standard library only), and a descriptive by-league n/concordant appendix (no tests).
- Output is aggregate JSON only: no match/player/team IDs, fractions, means, S values, per-game
  labels, signal probabilities or Elo probabilities.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from fractions import Fraction
from pathlib import Path

from ops.audit_pregame_history_support import (
    SOURCE_ID,
    SOURCE_TIMEZONE,
    _hash_hex,
    _iso,
    validate_output_path,
)
from ops.benchmark_match_baselines import (
    DEFAULT_CONFIG,
    BaselineConfig,
    Prediction,
    clean_records,
    simulate,
    summarize,
)
from ops.benchmark_metric_context_cohort import (
    ContextQueryResult,
    assess_context_support_with_queries,
)
from ops.benchmark_supported_history_cohort import partition_predictions
from ops.pregame_metric_context import STATUS_AVAILABLE

ARTIFACT_TYPE = "context-signal-direction-diagnostic"
SIDES = ("blue", "red")
PLAYERS_PER_SIDE = 5
ELO_MODEL = "team_elo"
STATUS_EVALUATED = "EVALUATED"
STATUS_NO_SUPPORTED_GAMES = "NO_SUPPORTED_GAMES"
TEST_RUN = "EXACT_TWO_SIDED_BINOMIAL_P_HALF"
TEST_NOT_RUN_NO_NON_TIE = "NOT_RUN_NO_NON_TIE_GAMES"
TEST_NOT_RUN_NO_DISCORDANT = "NOT_RUN_NO_DISCORDANT_PAIRS"
CLAIMS = (
    "EXPLORATORY_ALREADY_SEEN_COHORT",
    "NOT_PUBLIC_PREREGISTRATION_OR_INDEPENDENT_VALIDATION",
    "FIXED_UNFITTED_DIRECTIONAL_SIGNAL",
    "NO_PROBABILITIES_NO_COEFFICIENTS",
    "CONFOUNDED_WITH_TEAM_STRENGTH",
    "NOT_PLAYER_STRENGTH_OR_EFFECT",
    "RAW_UNITS_NOT_VERIFIED",
    "SIGN_FROM_ARITHMETIC_CHECK_NOT_DICTIONARY",
    "SIMULATED_24H_NOT_ACTUAL_AVAILABILITY",
    "TARGET_ROSTER_KNOWN_ASSUMPTION",
    "SUPPORTED_SUBSET_ONLY_NO_FALLBACK",
    "NO_UI_ADMISSION",
    "AGGREGATE_ONLY",
)
SIGNAL_SPEC = {
    "specification": "docs/CONTEXT_SIGNAL_DIRECTION_2026-11-20.md (frozen before any run)",
    "signal": "math.fsum(blue 5 context fractions) - math.fsum(red 5 context fractions)",
    "direction": "S > 0 blue; S < 0 red; exact equality of the two fsum results is a tie",
    "tie_tolerance": None,
    "weights_thresholds_scaling_or_fit": None,
    "fractions_source": "unchanged support pass of benchmark_metric_context_cohort",
    "games": "supported set only (all 10 queries descriptive_context_available)",
    "label": "Prediction.blue_won of one full-timeline simulate run, joined in-process",
    "concordance_half_credit": "(concordant + 0.5 * ties) / n",
    "tests": "exact two-sided binomial sign test on non-tie games and exact McNemar on "
    "discordant signal/Elo pairs, both against 0.5; exploratory, no other tests",
}
INTERPRETATION = {
    "any_value": (
        "Whatever the value: no feature admission, no UI change and no historical-player gate "
        "change."
    ),
    "not_above_elo_or_noise": (
        "Concordance at or below the Elo direction accuracy, or within sign-test noise of 0.5: "
        "no directional evidence beyond team baselines on this set."
    ),
    "above_both": (
        "Concordance above both: a descriptive association worth testing on a future unseen "
        "period. Not an ability claim; does not justify loosening support rules, windows, peers "
        "or patch pooling to cover more games."
    ),
    "no_automatic_verdict": (
        "This artifact does not classify its own result; the fixed readings above are applied "
        "by the reviewer."
    ),
    "already_explored": (
        "The cohort and context specification were already explored locally; this is not public "
        "preregistration or independent validation."
    ),
}


# --------------------------------------------------------------------------------------------
# Pure pieces (in-process only; nothing here is serialized per game)


def _checked_fraction(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("supported query has no numeric context fraction")
    value = float(value)
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise ValueError("context fraction must be finite and within [0, 1]")
    return value


def signal_directions(
    queries: Iterable[ContextQueryResult], supported_ids: frozenset[str]
) -> dict[str, int]:
    """Return {supported match ID: +1 blue / -1 red / 0 tie}. In-process only.

    Queries of unsupported games are ignored. A supported game must have exactly five available
    queries per side with valid fractions; anything else is an error, never a fallback.
    """
    by_game: dict[str, dict[str, list[float]]] = defaultdict(lambda: {s: [] for s in SIDES})
    for query in queries:
        if not isinstance(query, ContextQueryResult):
            raise TypeError("queries must be ContextQueryResult instances")
        if query.match_id not in supported_ids:
            continue
        if query.status != STATUS_AVAILABLE:
            raise ValueError("supported target has a query without available context")
        if query.side not in SIDES:
            raise ValueError("supported query side is not blue or red")
        by_game[query.match_id][query.side].append(_checked_fraction(query.position_fraction))
    if set(supported_ids) - by_game.keys():
        raise ValueError("a supported target has no evaluated queries")
    directions: dict[str, int] = {}
    for match_id, sides in by_game.items():
        if any(len(sides[side]) != PLAYERS_PER_SIDE for side in SIDES):
            raise ValueError("a supported target needs exactly 5 fractions per side")
        blue, red = math.fsum(sides["blue"]), math.fsum(sides["red"])
        # Sign of S = blue - red; for finite floats blue - red == 0 exactly iff blue == red.
        directions[match_id] = 1 if blue > red else -1 if blue < red else 0
    return directions


def exact_binomial_two_sided(successes: int, trials: int) -> float | None:
    """Exact two-sided binomial test against p = 0.5 (doubled smaller tail, capped at 1).

    Returns None when ``trials == 0`` (no test). Computed exactly with integers/fractions.
    """
    for value in (successes, trials):
        if isinstance(value, bool) or not isinstance(value, int):
            raise TypeError("binomial counts must be int")
    if trials < 0 or not 0 <= successes <= trials:
        raise ValueError("need 0 <= successes <= trials")
    if trials == 0:
        return None
    lower = sum(math.comb(trials, i) for i in range(successes + 1))
    upper = sum(math.comb(trials, i) for i in range(successes, trials + 1))
    return float(min(Fraction(1), Fraction(2 * min(lower, upper), 2**trials)))


def _rate(numerator: float, n: int) -> float | None:
    return round(numerator / n, 6) if n else None


def evaluate_directions(directions: Mapping[str, int], supported: Sequence[Prediction]) -> dict:
    """Aggregate counts and fixed tests for the supported predictions. Output is aggregate only."""
    ids = [p.match_id for p in supported]
    if len(set(ids)) != len(ids):
        raise ValueError("supported predictions contain a repeated match id")
    if set(ids) != set(directions) or len(ids) != len(directions):
        raise ValueError("supported signal games and supported predictions differ")

    counts = {"concordant": 0, "discordant": 0, "ties": 0}
    table = {
        "both_correct": 0,
        "signal_only_correct": 0,
        "elo_only_correct": 0,
        "both_wrong": 0,
        "signal_tie_only": 0,
        "elo_tie_only": 0,
        "both_tie": 0,
    }
    leagues: dict[str, dict[str, int]] = defaultdict(lambda: {"n": 0, "concordant": 0})
    for prediction in supported:
        y = prediction.blue_won
        if y not in (0, 1) or isinstance(y, bool):
            raise ValueError("label must be 0 or 1")
        direction = directions[prediction.match_id]
        if direction not in (-1, 0, 1):
            raise ValueError("direction must be -1, 0 or 1")
        signal_tie = direction == 0
        signal_right = not signal_tie and (direction > 0) == bool(y)
        if signal_tie:
            counts["ties"] += 1
        elif signal_right:
            counts["concordant"] += 1
        else:
            counts["discordant"] += 1
        league = leagues[prediction.league]
        league["n"] += 1
        league["concordant"] += int(signal_right)

        p_elo = prediction.probabilities[ELO_MODEL]
        elo_tie = p_elo == 0.5
        elo_right = not elo_tie and (p_elo > 0.5) == bool(y)
        if signal_tie and elo_tie:
            table["both_tie"] += 1
        elif signal_tie:
            table["signal_tie_only"] += 1
        elif elo_tie:
            table["elo_tie_only"] += 1
        elif signal_right and elo_right:
            table["both_correct"] += 1
        elif signal_right:
            table["signal_only_correct"] += 1
        elif elo_right:
            table["elo_only_correct"] += 1
        else:
            table["both_wrong"] += 1

    n = len(supported)
    if sum(counts.values()) != n or sum(table.values()) != n:
        raise ValueError("direction accounting is not an exact cover")
    non_tie = counts["concordant"] + counts["discordant"]
    discordant_pairs = table["signal_only_correct"] + table["elo_only_correct"]
    return {
        "direction": {
            "n": n,
            **counts,
            "concordance_half_credit": _rate(counts["concordant"] + 0.5 * counts["ties"], n),
        },
        "sign_test": {
            "label": "EXPLORATORY",
            "null_probability": 0.5,
            "successes": counts["concordant"],
            "trials_non_tie_games": non_tie,
            "status": TEST_RUN if non_tie else TEST_NOT_RUN_NO_NON_TIE,
            "p_value_two_sided": exact_binomial_two_sided(counts["concordant"], non_tie),
        },
        "elo_agreement": {
            "rule": "2x2 over games where neither the signal nor Elo (p == 0.5) is a tie; "
            "ties counted separately",
            **table,
        },
        "mcnemar": {
            "label": "EXPLORATORY",
            "null_probability": 0.5,
            "signal_only_correct": table["signal_only_correct"],
            "discordant_pairs": discordant_pairs,
            "status": TEST_RUN if discordant_pairs else TEST_NOT_RUN_NO_DISCORDANT,
            "p_value_two_sided": exact_binomial_two_sided(
                table["signal_only_correct"], discordant_pairs
            ),
        },
        "by_league_descriptive": {
            "label": "DESCRIPTIVE_ONLY_NO_TEST_SMALL_N",
            "leagues": {name: dict(v) for name, v in sorted(leagues.items())},
        },
    }


def assess_direction(
    raw: bytes,
    matches: Iterable,
    *,
    expected_hash: str,
    config: BaselineConfig = DEFAULT_CONFIG,
) -> dict:
    """Aggregate directional diagnostic. ``raw`` must be the exact verified bytes."""
    matches = tuple(matches)
    support_report, supported_ids, queries = assess_context_support_with_queries(
        raw, matches, expected_hash=expected_hash, cohort=config
    )
    games, reasons = clean_records(matches, config, expected_hash=expected_hash)
    predictions = simulate(games, config)  # one full-timeline run; never refit on a subset
    parts = partition_predictions(predictions, supported_ids)
    if len(parts["supported"]) != len(supported_ids):
        raise ValueError("supported partition size differs from the supported set")
    directions = signal_directions(queries, supported_ids)
    result = evaluate_directions(directions, parts["supported"])
    n = result["direction"]["n"]
    return {
        "status": STATUS_EVALUATED if n else STATUS_NO_SUPPORTED_GAMES,
        "config": config.describe(),
        "signal_spec": SIGNAL_SPEC,
        "baseline_run": {
            "full_timeline_single_simulation": True,
            "refit_on_subset": False,
            "in_scope_games": len(games),
            "target_games": len(predictions),
            "exclusion_reasons": reasons,
        },
        "context_support": support_report,
        "coverage": {
            "scored_supported_games": n,
            "cohort_target_games": len(parts["all"]),
            "unsupported_games_scored": 0,
            "fallback": None,
        },
        **result,
        "reference_same_games": summarize(parts["supported"], config)["all_targets"]["overall"],
        "interpretation": INTERPRETATION,
    }


# --------------------------------------------------------------------------------------------
# CLI (same guards as benchmark_metric_context_cohort)


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True, help="actual retrieval time (ISO, tz)")
    parser.add_argument("--content-hash", required=True, help="expected sha256 of --input")
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    expected = _hash_hex(args.content_hash)
    if expected is None:
        raise SystemExit("--content-hash must be a 64-character sha256 hex digest")
    try:
        retrieved_at = datetime.fromisoformat(args.retrieved_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SystemExit("--retrieved-at must be an ISO timestamp") from exc
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise SystemExit("--retrieved-at must include a timezone")
    source = args.input.resolve(strict=True)
    try:
        output = validate_output_path(args.output, source)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise SystemExit("input sha256 does not match --content-hash; refusing to run")

    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        source, retrieved_at=retrieved_at, source_timezone=SOURCE_TIMEZONE
    )
    if _hash_hex(imported.report.content_hash) != expected:
        raise SystemExit("adapter content hash differs from the verified sha256; refusing to run")

    result = assess_direction(raw, imported.matches, expected_hash=expected)
    report = {
        "artifact_type": ARTIFACT_TYPE,
        "local_diagnostic": True,
        "claims": list(CLAIMS),
        "source": {
            "source_id": SOURCE_ID,
            "source_hash_sha256": expected,
            "byte_length": len(raw),
            "retrieved_at": _iso(retrieved_at),
            "retrieved_at_basis": "actual retrieval time supplied by operator",
            "source_timezone": SOURCE_TIMEZONE,
            "adapter_accepted_games": imported.report.imported_game_count,
            "adapter_rejected_games": imported.report.rejected_game_count,
            "records_used": "adapter-accepted records of the full snapshot only",
        },
        **result,
        "network_collection_performed": False,
        "source_modified": False,
        "publication_permitted": False,
    }
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        raise SystemExit("source changed during the run; no report written")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:  # pragma: no cover
        output.unlink()
        raise SystemExit("source changed during the run; report withdrawn")
    print(json.dumps({"output": str(output), "status": result["status"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
