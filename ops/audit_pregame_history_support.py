"""Aggregate support-range audit of prior raw player history for an exploratory 2026 cohort.

Reproducible version of an ad-hoc check: for every identifiable target game in the fixed
``benchmark_match_baselines.DEFAULT_CONFIG`` cohort (observed_at UTC year 2026, its league set,
observed on/after 2026-07-01), query ``extract_player_history`` once per player (10 per game)
and COUNT how many queries have enough prior raw observations. Nothing else.

- NO_MODEL_EFFECT / NO_TRAINING: no model, coefficient, label, win rate or baseline score is
  computed. Values stay RAW_NOT_NORMALIZED and are never exported.
- The cohort is EXPLORATORY (it was already inspected), not untouched validation data.
- Availability is SIMULATED as observed_at + 24h, not actual publication time.
- The target roster (who plays which role) is an assumption taken from the target game's own
  rows (TARGET_ROSTER_KNOWN_ASSUMPTION).
- The adapter used the outcome column to ACCEPT games (winner must be a participant); the
  history metrics passed to the extractor never include outcome/name columns.
- Output is aggregate JSON only: no values, means, player/team/match IDs or names.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from ops.audit_performance_coverage import (
    METRICS,
    PLAYER_PARTICIPANT_IDS,
    audit_game,
    raw_player_rows,
)
from ops.benchmark_match_baselines import DEFAULT_CONFIG, BaselineConfig, clean_records
from ops.pregame_player_history import (
    HistoryConfig,
    HistoryObservation,
    HistoryQuery,
    extract_player_history,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_OUTPUT_ROOTS = (
    REPO_ROOT / "outputs" / "oracles-elixir",
    REPO_ROOT / "web" / "public",
    REPO_ROOT / "web" / "dist",
    REPO_ROOT / "web" / "dist-pages",
    REPO_ROOT / "web" / ".site-public",
    REPO_ROOT / "web" / "static-site",
)
FORBIDDEN_WEB_SEGMENTS = frozenset({"public", "dist", "dist-pages", ".site-public", "static-site"})
SOURCE_ID = "oracles-elixir-match-data"
SOURCE_TIMEZONE = "UTC"
ARTIFACT_TYPE = "pregame-history-support-audit"
HISTORY_CONFIG = HistoryConfig()  # fixed: 24h delay, max 20, min 5 (research spec)
CLAIMS = (
    "NO_MODEL_EFFECT",
    "NO_TRAINING",
    "EXPLORATORY_COHORT_NOT_UNTOUCHED_VALIDATION",
    "SIMULATED_AVAILABILITY_24H_NOT_ACTUAL",
    "TARGET_ROSTER_KNOWN_ASSUMPTION",
    "RAW_NOT_NORMALIZED",
    "NO_PUBLICATION",
    "NO_BASELINE_WINRATE_OR_LABELS_COMPUTED",
    "AGGREGATE_COUNTS_ONLY_NO_VALUES_MEANS_OR_IDS",
    "ADAPTER_USED_OUTCOME_FOR_ACCEPTANCE_ONLY_NOT_AS_HISTORY_FEATURE",
)
STATUS_OK = "OK"
STATUS_EMPTY = "EMPTY_COHORT"


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _hash_hex(value: str) -> str | None:
    normalized = value.strip().lower().removeprefix("sha256:")
    if len(normalized) == 64 and all(c in "0123456789abcdef" for c in normalized):
        return normalized
    return None


# --------------------------------------------------------------------------------------------
# Game eligibility (pure)


def _game_issue(
    record, rows: Sequence[Mapping[str, str | None]] | None, headers: Sequence[str]
) -> tuple[str | None, object]:
    """Return (reason, GameAudit|None). reason is None if the game's identity is usable."""
    if rows is None or [(r.get("participantid") or "").strip() for r in rows] != list(
        PLAYER_PARTICIPANT_IDS
    ):
        return "raw_player_rows_not_exactly_1_to_10", None
    audit = audit_game(rows, headers)
    if not audit.identity_valid:
        return "identity_invalid", audit
    expected_team = {"blue": record.blue_team_id, "red": record.red_team_id}
    for row in rows:
        side = (row.get("side") or "").strip().lower()
        if (row.get("teamid") or "").strip() != expected_team.get(side):
            return "raw_teamid_differs_from_adapter_record", audit
    if not (record.patch_id or "").strip():
        return "blank_patch_id", audit
    return None, audit


def _observations(record, rows, headers: Sequence[str]) -> list[HistoryObservation]:
    present = [m for m in METRICS if m in headers]  # absent columns stay column_absent
    return [
        HistoryObservation(
            match_id=record.match_id,
            player_id=(row.get("playerid") or "").strip(),
            role=(row.get("position") or "").strip().lower(),
            patch_id=record.patch_id.strip(),
            observed_at=record.observed_at,
            metrics={metric: row.get(metric) for metric in present},
        )
        for row in rows
    ]


def _new_bucket() -> dict:
    return {
        "target_games": 0,
        "target_games_excluded": Counter(),
        "queries": 0,
        "queries_zero_prior_observations": 0,
        "queries_min_games_met": 0,
        "games_all_10_min_games_met": 0,
        "queries_metric_raw_mean_valid": Counter(),
        "queries_all_metrics_raw_mean_valid": 0,
        "games_all_10_all_metrics_raw_mean_valid": 0,
    }


def _finish_bucket(bucket: dict) -> dict:
    return {
        **bucket,
        "target_games_excluded": dict(sorted(bucket["target_games_excluded"].items())),
        "queries_metric_raw_mean_valid": {
            m: bucket["queries_metric_raw_mean_valid"].get(m, 0) for m in METRICS
        },
    }


def assess_support(
    raw: bytes,
    matches: Iterable,
    *,
    expected_hash: str,
    cohort: BaselineConfig = DEFAULT_CONFIG,
    history_config: HistoryConfig = HISTORY_CONFIG,
) -> dict:
    """Aggregate support counts. ``raw`` must be the exact verified bytes. Inputs not mutated."""
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("snapshot bytes do not match the verified content hash")
    matches = tuple(matches)
    grouped, headers = raw_player_rows(raw)

    # Any match ID seen more than once (even identical copies) is excluded everywhere.
    id_counts = Counter(m.match_id for m in matches)
    duplicate_ids = {match_id for match_id, n in id_counts.items() if n > 1}

    # Supply candidates: every accepted record of the season year, any league.
    all_leagues = frozenset(m.league for m in matches) | cohort.leagues
    season, season_reasons = clean_records(
        matches, replace(cohort, leagues=all_leagues), expected_hash=expected_hash
    )
    supply_exclusions: Counter = Counter()
    by_player_role: dict[tuple[str, str], list[HistoryObservation]] = defaultdict(list)
    usable: dict[str, tuple] = {}
    supply_games = 0
    observed: list[datetime] = []
    for record in season:
        observed.append(record.observed_at.astimezone(UTC))
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
            # Conservative: never feed a game whose game-constant metric disagrees across rows.
            supply_exclusions["gamelength_inconsistent_within_game"] += 1
            continue
        supply_games += 1
        for observation in _observations(record, rows, headers):
            by_player_role[(observation.player_id, observation.role)].append(observation)

    # Target cohort: the unchanged DEFAULT_CONFIG scope, observed on/after evaluation_start.
    cohort_records, cohort_reasons = clean_records(matches, cohort, expected_hash=expected_hash)
    targets = [r for r in cohort_records if r.observed_at >= cohort.evaluation_start]

    overall = _new_bucket()
    leagues: dict[str, dict] = defaultdict(_new_bucket)
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
        game_min_met = True
        game_all_metrics = True
        for row in rows:
            query = HistoryQuery(
                target_match_id=record.match_id,
                player_id=(row.get("playerid") or "").strip(),
                role=(row.get("position") or "").strip().lower(),
                patch_id=record.patch_id.strip(),
                cutoff=record.observed_at,
            )
            # Pre-indexing by (player, role) is equivalent: the extractor scopes to exactly that.
            result = extract_player_history(
                by_player_role.get((query.player_id, query.role), ()), query, history_config
            )
            min_met = not result["sample"]["below_minimum_games"]
            valid = [m for m in METRICS if result["metrics"][m]["mean_raw"] is not None]
            all_valid = len(valid) == len(METRICS)
            game_min_met &= min_met
            game_all_metrics &= all_valid
            for bucket in buckets:
                bucket["queries"] += 1
                bucket["queries_zero_prior_observations"] += result["games_used"] == 0
                bucket["queries_min_games_met"] += min_met
                bucket["queries_all_metrics_raw_mean_valid"] += all_valid
                bucket["queries_metric_raw_mean_valid"].update(valid)
        for bucket in buckets:
            bucket["games_all_10_min_games_met"] += game_min_met
            bucket["games_all_10_all_metrics_raw_mean_valid"] += game_all_metrics

    return {
        "status": STATUS_OK if overall["target_games"] else STATUS_EMPTY,
        "cohort_scope": {
            **cohort.describe(),
            "target_rule": "cleaned in-scope records with observed_at >= evaluation_start",
            "cohort_record_exclusions": cohort_reasons,
            "split_or_coefficients_changed": False,
            "comparison_note": (
                "Supported games are a selected subset of the cohort; any baseline comparison "
                "must re-score baselines on the same subset."
            ),
        },
        "history_supply": {
            "candidate_rule": "every accepted season-year record in any league",
            "season_record_exclusions": season_reasons,
            "season_records": len(season),
            "supply_games": supply_games,
            "supply_game_exclusions": dict(sorted(supply_exclusions.items())),
            "observed_range": (
                {"first": _iso(min(observed)), "last": _iso(max(observed))} if observed else None
            ),
            "raw_metric_columns_present": [m for m in METRICS if m in headers],
            "raw_metric_columns_absent": [m for m in METRICS if m not in headers],
        },
        "parameters": {
            "query_key": "player_id + role + exact patch_id",
            "query_cutoff": "target observed_at",
            "target_match_excluded_by_exact_id": True,
            "publication_delay_hours": history_config.publication_delay.total_seconds() / 3600,
            "maximum_games": history_config.maximum_games,
            "minimum_games": history_config.minimum_games,
            "metric_raw_mean_valid": "extractor mean_raw is not None (>= minimum valid values)",
        },
        "overall": _finish_bucket(overall),
        "by_league": {league: _finish_bucket(b) for league, b in sorted(leagues.items())},
    }


# --------------------------------------------------------------------------------------------
# CLI


def validate_output_path(output: Path, source: Path) -> Path:
    if output.is_symlink():
        raise ValueError("output must not be a symlink")
    resolved = output.resolve()
    for root in FORBIDDEN_OUTPUT_ROOTS:
        if resolved.is_relative_to(root.resolve()):
            raise ValueError("refusing to write inside a published web path or the raw archive")
    parts = [part.lower() for part in resolved.parts]
    if any(
        a == "web" and b in FORBIDDEN_WEB_SEGMENTS for a, b in zip(parts, parts[1:], strict=False)
    ):
        raise ValueError("refusing to write inside a web publication directory")
    if resolved == source.resolve():
        raise ValueError("refusing to write over the source snapshot")
    if resolved.suffix.lower() != ".json":
        raise ValueError("output must be a .json report")
    if resolved.exists():
        raise ValueError("output already exists; choose a new path")
    return resolved


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

    support = assess_support(raw, imported.matches, expected_hash=expected)
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
            "adapter_outcome_use": "acceptance validation only; never a history metric",
        },
        **support,
        "network_collection_performed": False,
        "source_modified": False,
        "publication_permitted": False,
    }
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        raise SystemExit("source changed during the audit; no report written")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:  # pragma: no cover
        output.unlink()
        raise SystemExit("source changed during the audit; report withdrawn")
    print(json.dumps({"output": str(output), "status": support["status"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
