"""Team baselines re-scored on the golddiffat15 peer-context-supported subset of the 2026 cohort.

Local exploratory research diagnostic. It is NOT a player model, feature effect, normalization,
probability release or tuning step:

- Support: for every identifiable target of the fixed ``DEFAULT_CONFIG`` cohort, the existing
  ``pregame_metric_context.build_metric_context`` is called once per player (10 per game) with
  its default specification (golddiffat15, latest 20, minimum 5 valid, minimum 5 peers, 24h
  simulated delay). A target is "context supported" only when all 10 calls return
  ``descriptive_context_available``. The status decision itself is never re-implemented here.
- History supply mirrors ``audit_pregame_history_support``: every accepted season-year record of
  any league, every copy of a repeated match ID excluded, the raw player 1..10 / identity /
  team / patch checks (``_game_issue``) and the within-game consistency check reused, and the
  observation builder (``_observations``) reused. Observations are pre-indexed by
  (league, role) only; there is NO patch prefilter, so the extractor's duplicate handling
  across patches is preserved.
- Baselines: ONE full-timeline ``clean_records`` + ``simulate`` run with the unchanged
  ``DEFAULT_CONFIG`` (warmup, league timelines and every chronological Elo update kept). The
  already-produced predictions are split by the existing ``partition_predictions`` and scored by
  the existing ``summarize``. No subset is refit or re-simulated.
- Output is aggregate JSON only: status/query/exclusion/supply counts and partition scores. No
  match/player/team IDs, raw rows, target or peer means, position values, per-query peer
  counts, labels or probabilities are written or logged.
"""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from ops.audit_performance_coverage import raw_player_rows
from ops.audit_pregame_history_support import (
    SOURCE_ID,
    SOURCE_TIMEZONE,
    _game_issue,
    _hash_hex,
    _iso,
    _observations,
    validate_output_path,
)
from ops.benchmark_match_baselines import (
    DEFAULT_CONFIG,
    BaselineConfig,
    clean_records,
    simulate,
    summarize,
)
from ops.benchmark_supported_history_cohort import (
    PARTITIONS,
    STATUS_EMPTY,
    STATUS_SCORED,
    partition_predictions,
)
from ops.pregame_metric_context import (
    METRIC,
    STATUS_AVAILABLE,
    STATUS_PEERS_INSUFFICIENT,
    STATUS_TARGET_INSUFFICIENT,
    ContextObservation,
    build_metric_context,
)
from ops.pregame_player_history import HistoryConfig, HistoryQuery

ARTIFACT_TYPE = "metric-context-cohort-baselines"
CONTEXT_STATUSES = (STATUS_AVAILABLE, STATUS_TARGET_INSUFFICIENT, STATUS_PEERS_INSUFFICIENT)
CLAIMS = (
    "EXPLORATORY_ALREADY_SEEN_COHORT",
    "NOT_PUBLIC_PREREGISTRATION_OR_INDEPENDENT_VALIDATION",
    "SIMULATED_24H_NOT_ACTUAL_AVAILABILITY",
    "TARGET_ROSTER_KNOWN_ASSUMPTION",
    "ACTUAL_RETRIEVED_AT_IS_SEPARATE_PROVENANCE",
    "CONTEXT_SUPPORT_GATE_NOT_FEATURE_ADMISSION",
    "SUBSET_DIFFERENCE_IS_SELECTION_NOT_PLAYER_FEATURE_EFFECT",
    "NOT_INTERCHANGEABLE_WITH_13_METRIC_HISTORY_SUPPORT",
    "NO_NEW_PLAYER_MODEL_FIT_OR_TUNING",
    "EXISTING_TEAM_ELO_CHRONOLOGICAL_UPDATES_KEPT",
    "EXISTING_FIXED_HALF_BLUE_LAPLACE_TEAM_ELO_ONLY_NOT_PRODUCT_WINRATE",
    "RAW_UNITS_NOT_VERIFIED",
    "NO_UI_OR_SOURCE_FETCH",
    "AGGREGATE_ONLY_NO_IDS_VALUES_POSITIONS_OR_PROBABILITIES",
)
INTERPRETATION = {
    "already_explored": (
        "This cohort and this metric specification were already explored locally. This is not a "
        "public preregistration and not new independent validation."
    ),
    "selection_not_feature_effect": (
        "All scores use team-level baselines only. Any difference between the supported and "
        "not_supported partitions is a selection difference between subsets of the same "
        "cohort, never an effect of a player feature."
    ),
    "not_interchangeable_with_history_support": (
        "Context support (all 10 players with a same-league/role/exact-patch golddiffat15 "
        "position among >= 5 peers) uses different support criteria from the earlier "
        "history support (13 raw metrics vs 1 metric, plus a same-league peer gate). Neither "
        "set contains the other by construction; their scores are not interchangeable."
    ),
    "no_new_fit": (
        "No player model was fitted and no parameter was tuned, refit or optimized on any "
        "partition. The existing team Elo still applies its chronological rating updates over "
        "the full timeline; that is the unchanged baseline, not new training."
    ),
    "baselines_only": (
        "Only the existing fixed 0.5, blue Laplace and team Elo baselines are scored; none is a "
        "product win rate."
    ),
    "empty_partition": "An empty partition keeps the existing summarize None scores (n = 0).",
}


def _context_spec() -> dict:
    """Describe the helper's own defaults (read from it, not re-declared)."""
    history = HistoryConfig()
    peers = inspect.signature(build_metric_context).parameters["minimum_peer_players"].default
    return {
        "metric": METRIC,
        "reference": "same league + same role + exact patch; target match and player excluded",
        "publication_delay_hours": history.publication_delay.total_seconds() / 3600,
        "maximum_games": history.maximum_games,
        "minimum_valid_games": history.minimum_games,
        "minimum_peer_players": peers,
        "helper_called_with_defaults": True,
    }


def _new_bucket() -> dict:
    return {
        "target_games": 0,
        "target_games_excluded": Counter(),
        "queries": 0,
        "query_statuses": Counter(),
        "games_all_10_context_available": 0,
        "games_not_all_10_context_available": 0,
    }


def _finish_bucket(bucket: dict) -> dict:
    return {
        **bucket,
        "target_games_excluded": dict(sorted(bucket["target_games_excluded"].items())),
        "query_statuses": {s: bucket["query_statuses"].get(s, 0) for s in CONTEXT_STATUSES},
    }


def _check_bucket(bucket: dict) -> None:
    excluded = sum(bucket["target_games_excluded"].values())
    evaluated = bucket["target_games"] - excluded
    statuses = sum(bucket["query_statuses"].values())
    if bucket["queries"] != evaluated * 10 or statuses != bucket["queries"]:
        raise ValueError("query accounting does not cover exactly 10 queries per target")
    if (
        bucket["games_all_10_context_available"] + bucket["games_not_all_10_context_available"]
        != evaluated
    ):
        raise ValueError("target accounting is not an exact cover")


def assess_context_support_with_ids(
    raw: bytes,
    matches: Iterable,
    *,
    expected_hash: str,
    cohort: BaselineConfig = DEFAULT_CONFIG,
) -> tuple[dict, frozenset[str]]:
    """Aggregate context-support counts plus the supported target IDs (in-process only).

    The ID set links to predictions inside this process and must never be serialized.
    """
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("snapshot bytes do not match the verified content hash")
    matches = tuple(matches)
    grouped, headers = raw_player_rows(raw)

    id_counts = Counter(m.match_id for m in matches)
    duplicate_ids = {match_id for match_id, n in id_counts.items() if n > 1}

    # Supply: every accepted season-year record of any league (as in the support auditor).
    all_leagues = frozenset(m.league for m in matches) | cohort.leagues
    season, season_reasons = clean_records(
        matches, replace(cohort, leagues=all_leagues), expected_hash=expected_hash
    )
    supply_exclusions: Counter = Counter()
    by_league_role: dict[tuple[str, str], list[ContextObservation]] = defaultdict(list)
    usable: dict[str, tuple] = {}
    supply_games = 0
    for record in season:
        if record.match_id in duplicate_ids:
            supply_exclusions["duplicate_match_id"] += 1
            continue
        rows = grouped.get(record.match_id)
        reason, audit = _game_issue(record, rows, headers)
        if reason is not None:
            supply_exclusions[reason] += 1
            continue
        usable[record.match_id] = (record, rows)
        if any("inconsistent_within_game" in s for s in audit.statuses.values()):
            supply_exclusions["gamelength_inconsistent_within_game"] += 1
            continue
        supply_games += 1
        for observation in _observations(record, rows, headers):
            # League + role pre-index only. NO patch prefilter (keeps cross-patch duplicates).
            by_league_role[(record.league, observation.role)].append(
                ContextObservation(league=record.league, observation=observation)
            )
    indexed = {key: tuple(value) for key, value in by_league_role.items()}

    # Targets: the unchanged cohort scope, observed on/after evaluation_start.
    cohort_records, cohort_reasons = clean_records(matches, cohort, expected_hash=expected_hash)
    targets = [r for r in cohort_records if r.observed_at >= cohort.evaluation_start]

    overall = _new_bucket()
    leagues: dict[str, dict] = defaultdict(_new_bucket)
    supported: set[str] = set()
    for record in targets:
        buckets = (overall, leagues[record.league])
        for bucket in buckets:
            bucket["target_games"] += 1
        if record.match_id in duplicate_ids:
            reason = "duplicate_match_id"
        elif record.match_id in usable:
            reason = None
        else:
            reason, _ = _game_issue(record, grouped.get(record.match_id), headers)
            reason = reason or "not_usable"
        if reason is not None:
            for bucket in buckets:
                bucket["target_games_excluded"][reason] += 1
            continue
        _, rows = usable[record.match_id]
        all_available = True
        for row in rows:
            query = HistoryQuery(
                target_match_id=record.match_id,
                player_id=(row.get("playerid") or "").strip(),
                role=(row.get("position") or "").strip().lower(),
                patch_id=record.patch_id.strip(),
                cutoff=record.observed_at,
            )
            status = build_metric_context(
                indexed.get((record.league, query.role), ()), query, league=record.league
            )["status"]
            if status not in CONTEXT_STATUSES:
                raise ValueError("unexpected metric context status")
            all_available &= status == STATUS_AVAILABLE
            for bucket in buckets:
                bucket["queries"] += 1
                bucket["query_statuses"][status] += 1
        key = (
            "games_all_10_context_available"
            if all_available
            else "games_not_all_10_context_available"
        )
        for bucket in buckets:
            bucket[key] += 1
        if all_available:
            supported.add(record.match_id)

    _check_bucket(overall)
    for bucket in leagues.values():
        _check_bucket(bucket)
    if len(supported) != overall["games_all_10_context_available"]:
        raise ValueError("supported set size differs from the all-10 count")

    report = {
        "status": "OK" if overall["target_games"] else "EMPTY_COHORT",
        "rule": "target game where all 10 build_metric_context calls are " + STATUS_AVAILABLE,
        "context_spec": _context_spec(),
        "cohort_record_exclusions": cohort_reasons,
        "history_supply": {
            "candidate_rule": "every accepted season-year record in any league",
            "index": "league + role only; no patch prefilter",
            "season_record_exclusions": season_reasons,
            "season_records": len(season),
            "supply_games": supply_games,
            "supply_game_exclusions": dict(sorted(supply_exclusions.items())),
            "metric_column_present": METRIC in headers,
        },
        "overall": _finish_bucket(overall),
        "by_league": {league: _finish_bucket(b) for league, b in sorted(leagues.items())},
    }
    return report, frozenset(supported)


def assess_context_cohort(
    raw: bytes,
    matches: Iterable,
    *,
    expected_hash: str,
    config: BaselineConfig = DEFAULT_CONFIG,
) -> dict:
    """Aggregate partition scores. ``raw`` must be the exact verified bytes. Inputs not mutated."""
    matches = tuple(matches)
    support_report, supported_ids = assess_context_support_with_ids(
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
        "context_support": support_report,
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

    result = assess_context_cohort(raw, imported.matches, expected_hash=expected)
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
