"""Team baselines re-scored on the history-supported subset of the fixed 2026 cohort.

Separates selection differences between the games that have prior raw player history and the
rest of the same evaluation cohort. Nothing is trained or tuned:

- The supported set comes from ``audit_pregame_history_support.assess_support_with_ids`` (the
  exact same support computation as the auditor; no duplicated gate logic).
- Baselines come from ONE full-timeline ``clean_records`` + ``simulate`` run with the unchanged
  ``DEFAULT_CONFIG`` (warmup and every rating update kept). Already-produced predictions are only
  partitioned by match ID and scored with the existing ``summarize``.
- Output is aggregate JSON only: no match/player/team IDs, metric values, probabilities or labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

from ops.audit_pregame_history_support import (
    SOURCE_ID,
    SOURCE_TIMEZONE,
    _hash_hex,
    _iso,
    assess_support_with_ids,
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

ARTIFACT_TYPE = "supported-history-cohort-baselines"
PARTITIONS = ("all", "supported", "not_supported")
STATUS_SCORED = "SCORED"
STATUS_EMPTY = "EMPTY_COHORT"
CLAIMS = (
    "EXPLORATORY_ALREADY_SEEN_COHORT",
    "SIMULATED_24H_NOT_ACTUAL_AVAILABILITY",
    "TARGET_ROSTER_KNOWN_ASSUMPTION",
    "HISTORY_GATE_NOT_FEATURE_ADMISSION",
    "NO_PLAYER_OR_CHAMPION_EFFECT",
    "NO_UI_NO_TRAINING_NO_SOURCE_FETCH",
    "NOT_CAUSAL_EFFECT_OR_RELEASED_WINRATE",
)
INTERPRETATION = {
    "selection_not_feature_effect": (
        "Baselines here use team-level information only. Any difference between the supported "
        "and not_supported partitions is a selection difference between subsets of the same "
        "cohort, never an effect of player features."
    ),
    "future_comparison_floor": (
        "The supported partition may serve as the like-for-like floor for a later model scored "
        "on the same games, but it is an already-seen exploratory cohort, not new independent "
        "validation."
    ),
    "no_tuning": "No parameter was tuned, refit or optimized on any partition.",
    "empty_partition": "An empty partition keeps the existing summarize None scores (n = 0).",
}


def partition_predictions(
    predictions: Sequence[Prediction], supported_ids: frozenset[str]
) -> dict[str, tuple[Prediction, ...]]:
    """Split existing predictions by membership; checks disjointness and exact coverage."""
    ids = [p.match_id for p in predictions]
    if len(set(ids)) != len(ids):
        raise ValueError("predictions contain a repeated match id")
    if not supported_ids <= set(ids):
        raise ValueError("a supported target has no full-timeline prediction")
    supported = tuple(p for p in predictions if p.match_id in supported_ids)
    rest = tuple(p for p in predictions if p.match_id not in supported_ids)
    if len(supported) + len(rest) != len(predictions) or {p.match_id for p in supported} & {
        p.match_id for p in rest
    }:
        raise ValueError("partition is not an exact disjoint cover of all predictions")
    return {"all": tuple(predictions), "supported": supported, "not_supported": rest}


def _support_aggregate(report: Mapping) -> dict:
    return {
        "status": report["status"],
        "rule": (
            "auditor target game where all 10 queries met minimum_games and every metric had "
            "a valid raw mean"
        ),
        "parameters": report["parameters"],
        "cohort_record_exclusions": report["cohort_scope"]["cohort_record_exclusions"],
        "history_supply": report["history_supply"],
        "overall": report["overall"],
        "by_league": report["by_league"],
    }


def assess_cohort(
    raw: bytes,
    matches: Iterable,
    *,
    expected_hash: str,
    config: BaselineConfig = DEFAULT_CONFIG,
) -> dict:
    """Aggregate partition scores. ``raw`` must be the exact verified bytes. Inputs not mutated."""
    matches = tuple(matches)
    support_report, supported_ids = assess_support_with_ids(
        raw, matches, expected_hash=expected_hash, cohort=config
    )
    games, reasons = clean_records(matches, config, expected_hash=expected_hash)
    predictions = simulate(games, config)  # one full-timeline run; never refit on a subset
    parts = partition_predictions(predictions, supported_ids)

    warmup = sum(1 for g in games if g.observed_at.astimezone(UTC) < config.evaluation_start)
    window = (
        {"first": _iso(predictions[0].observed_at), "last": _iso(predictions[-1].observed_at)}
        if predictions
        else None
    )
    return {
        "status": "EVALUATED" if predictions else "NO_EVALUATION_TARGETS",
        "config": config.describe(),
        "baseline_run": {
            "full_timeline_single_simulation": True,
            "refit_on_subset": False,
            "warmup_or_updates_removed": False,
            "in_scope_games": len(games),
            "warmup_games": warmup,
            "target_games": len(predictions),
            "evaluation_window": window,
            "exclusion_reasons": reasons,
        },
        "support": _support_aggregate(support_report),
        "partition_check": {
            "all": len(parts["all"]),
            "supported": len(parts["supported"]),
            "not_supported": len(parts["not_supported"]),
            "disjoint": True,
            "union_equals_all": True,
        },
        "partitions": {
            name: {
                "status": STATUS_SCORED if parts[name] else STATUS_EMPTY,
                "sample_size": len(parts[name]),
                "cohorts": summarize(parts[name], config),
            }
            for name in PARTITIONS
        },
        "interpretation": INTERPRETATION,
    }


# --------------------------------------------------------------------------------------------
# CLI


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

    result = assess_cohort(raw, imported.matches, expected_hash=expected)
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
