"""Within-game arithmetic consistency of the raw 15-minute lane columns (research diagnostic).

Separates "the raw number parses" (``audit_performance_coverage``) from "the columns agree with
each other". For every adapter-accepted, observed_at-UTC-2026 game and each of the 5 roles it
checks 5 field-name-based relationships between the blue and red player of that role:

1. ``golddiffat15`` blue + red == 0
2. ``csdiffat15``   blue + red == 0
3. ``xpdiffat15``   blue + red == 0
4. blue ``goldat15`` - red ``goldat15`` == blue ``golddiffat15`` AND the reverse direction for red
5. blue ``csat15``   - red ``csat15``   == blue ``csdiffat15``   AND the reverse direction for red

- RELATIONSHIPS_ARE_DIAGNOSTIC_HYPOTHESES: inferred from column names only; the source's exact
  definitions were not re-verified. An inconsistency is NOT a verdict of a data error or a player
  fault, and never changes existing observations or history-support/admission decisions.
- RAW_UNITS_NOT_VERIFIED; ``gamelength`` is never used to decide 15-minute eligibility.
- No player effect / skill / win rate / normalization / matchup or swap interpretation.
- Tolerance is fixed (abs 1e-6, rel 0) and must not be tuned to observed results.
- Output is aggregate counts only: no values, residuals, player/team/game IDs or raw rows. The
  only identifier written is the source sha256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from ops.audit_performance_coverage import (
    INVALID_KINDS,
    MISSING_KINDS,
    PLAYER_PARTICIPANT_IDS,
    ROLES,
    SIDES,
    _hash_hex,
    _identity_reasons,
    _iso,
    classify_value,
    raw_player_rows,
)
from ops.audit_pregame_history_support import validate_output_path

SOURCE_ID = "oracles-elixir-match-data"
SOURCE_TIMEZONE = "UTC"
ARTIFACT_TYPE = "lane-stat-consistency-audit"
SEASON_YEAR = 2026
ABS_TOLERANCE = 1e-6  # fixed; never tuned to observed results
REL_TOLERANCE = 0.0

# rule -> (kind, level column or None, diff column)
RULES: dict[str, tuple[str, str | None, str]] = {
    "golddiffat15_blue_plus_red_is_zero": ("antisymmetric", None, "golddiffat15"),
    "csdiffat15_blue_plus_red_is_zero": ("antisymmetric", None, "csdiffat15"),
    "xpdiffat15_blue_plus_red_is_zero": ("antisymmetric", None, "xpdiffat15"),
    "goldat15_difference_equals_golddiffat15_both_ways": ("level", "goldat15", "golddiffat15"),
    "csat15_difference_equals_csdiffat15_both_ways": ("level", "csat15", "csdiffat15"),
}
# Mutually exclusive, in precedence order.
STATUSES = (
    "identity_unresolved",
    "dependency_invalid",
    "dependency_missing",
    "arithmetic_unavailable",
    "consistent",
    "inconsistent",
)
GAME_IDENTITY_REASONS = (
    "row_count_below_10",
    "row_count_above_10",
    "participantid_not_exactly_1_to_10",
    "missing_side_role",
    "missing_playerid",
    "missing_teamid",
    "invalid_side",
    "invalid_role",
    "duplicate_role_in_team",
    "duplicate_playerid_in_game",
    "teamid_inconsistent_within_side",
    "same_teamid_both_sides",
    "raw_teamid_differs_from_adapter_record",
)
CLAIMS = (
    "NO_NETWORK",
    "NO_MODEL",
    "RAW_UNITS_NOT_VERIFIED",
    "RELATIONSHIPS_ARE_DIAGNOSTIC_HYPOTHESES",
    "NO_CHANGE_TO_HISTORY_ADMISSION",
    "INCONSISTENCY_IS_NOT_A_DATA_ERROR_OR_PLAYER_FAULT_VERDICT",
    "NO_PLAYER_EFFECT_SKILL_WINRATE_OR_NORMALIZATION",
    "NO_MATCHUP_OR_SWAP_INTERPRETATION",
    "GAMELENGTH_NOT_USED_FOR_15_MINUTE_ELIGIBILITY",
    "FIXED_TOLERANCE_NOT_TUNED",
    "AGGREGATE_COUNTS_ONLY_NO_VALUES_RESIDUALS_OR_IDS",
    "ADAPTER_ACCEPTED_GAMES_ONLY",
    "NOT_A_RELEASE_OR_COMPLETENESS_CLAIM",
)


# --------------------------------------------------------------------------------------------
# Per-game diagnosis (pure, no I/O, inputs never mutated)


@dataclass(frozen=True, slots=True)
class LaneGameAudit:
    identity_reasons: frozenset[str]
    statuses: Mapping[str, Mapping[str, str]]  # rule -> role -> status

    @property
    def identity_valid(self) -> bool:
        return not self.identity_reasons


def _side_role(row: Mapping[str, str | None]) -> tuple[str, str]:
    return (row.get("side") or "").strip().lower(), (row.get("position") or "").strip().lower()


def game_identity_issues(
    rows: Sequence[Mapping[str, str | None]],
    expected_team_ids: Mapping[str, str] | None = None,
) -> frozenset[str]:
    """Game-level reasons the 10 blue/red role slots cannot be resolved (empty set = usable)."""
    reasons: set[str] = set()
    if len(rows) < len(PLAYER_PARTICIPANT_IDS):
        reasons.add("row_count_below_10")
    elif len(rows) > len(PLAYER_PARTICIPANT_IDS):
        reasons.add("row_count_above_10")
    participants = Counter((row.get("participantid") or "").strip() for row in rows)
    if participants != Counter(PLAYER_PARTICIPANT_IDS):
        reasons.add("participantid_not_exactly_1_to_10")
    for row_reasons in _identity_reasons(rows):  # existing per-row identity validation
        reasons |= row_reasons
    slots = Counter(_side_role(row) for row in rows)
    if any(slots[(side, role)] == 0 for side in SIDES for role in ROLES):
        reasons.add("missing_side_role")
    teams: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        side, _ = _side_role(row)
        team = (row.get("teamid") or "").strip()
        if side in SIDES and team:
            teams[side].add(team)
            if expected_team_ids is not None and team != expected_team_ids.get(side):
                reasons.add("raw_teamid_differs_from_adapter_record")
    if teams["blue"] and teams["blue"] & teams["red"]:
        reasons.add("same_teamid_both_sides")
    unknown = reasons.difference(GAME_IDENTITY_REASONS)
    if unknown:  # pragma: no cover - internal invariant
        raise RuntimeError(f"unaccounted identity reasons: {sorted(unknown)}")
    return frozenset(reasons)


def _dependency_status(
    blue: Mapping[str, str | None], red: Mapping[str, str | None], columns, present: set[str]
) -> str | None:
    kinds = [
        classify_value(row.get(column), column, column_present=column in present)
        for row in (blue, red)
        for column in columns
    ]
    if any(kind in INVALID_KINDS for kind in kinds):
        return "dependency_invalid"  # invalid takes precedence over missing
    if any(kind in MISSING_KINDS for kind in kinds):
        return "dependency_missing"
    if any(kind != "valid" for kind in kinds):  # pragma: no cover - internal invariant
        raise RuntimeError("unclassified dependency status")
    return None


def _within(residual: float) -> bool:
    return abs(residual) <= ABS_TOLERANCE  # rel tolerance is fixed at 0


def evaluate_rule(
    rule: str, blue: Mapping[str, str | None], red: Mapping[str, str | None], present: set[str]
) -> str:
    """Status of one relationship for one role's blue/red pair (identity already resolved)."""
    kind, level, diff = RULES[rule]
    columns = (diff,) if level is None else (level, diff)
    blocked = _dependency_status(blue, red, columns, present)
    if blocked is not None:
        return blocked
    blue_diff = float((blue.get(diff) or "").strip())
    red_diff = float((red.get(diff) or "").strip())
    if kind == "antisymmetric":
        computed = (blue_diff + red_diff,)
    else:
        blue_level = float((blue.get(level) or "").strip())
        red_level = float((red.get(level) or "").strip())
        forward = blue_level - red_level
        backward = red_level - blue_level
        # Both directions must hold at once; sign symmetry alone never makes this consistent.
        computed = (forward, backward, forward - blue_diff, backward - red_diff)
    if not all(math.isfinite(value) for value in computed):
        return "arithmetic_unavailable"
    residuals = computed if kind == "antisymmetric" else computed[2:]
    return "consistent" if all(_within(r) for r in residuals) else "inconsistent"


def audit_lane_game(
    rows: Sequence[Mapping[str, str | None]],
    headers: Iterable[str],
    *,
    expected_team_ids: Mapping[str, str] | None = None,
) -> LaneGameAudit:
    """Diagnose all 25 (role x rule) slots of one game. Row order does not matter."""
    present = set(headers)
    reasons = game_identity_issues(rows, expected_team_ids)
    statuses: dict[str, dict[str, str]] = {}
    if reasons:
        statuses = {rule: {role: "identity_unresolved" for role in ROLES} for rule in RULES}
        return LaneGameAudit(reasons, statuses)
    by_slot = {_side_role(row): row for row in rows}
    for rule in RULES:
        statuses[rule] = {
            role: evaluate_rule(rule, by_slot[("blue", role)], by_slot[("red", role)], present)
            for role in ROLES
        }
    return LaneGameAudit(reasons, statuses)


# --------------------------------------------------------------------------------------------
# Aggregation


@dataclass(slots=True)
class _Bucket:
    games: int = 0
    identity_unresolved_games: int = 0
    identity_reason_game_counts: Counter = field(default_factory=Counter)
    rule_counts: dict[str, Counter] = field(
        default_factory=lambda: {rule: Counter() for rule in RULES}
    )

    def add(self, game: LaneGameAudit) -> None:
        self.games += 1
        if not game.identity_valid:
            self.identity_unresolved_games += 1
            self.identity_reason_game_counts.update(game.identity_reasons)
        for rule in RULES:
            per_role = game.statuses[rule]
            if set(per_role) != set(ROLES):  # pragma: no cover - internal invariant
                raise RuntimeError("every game must account for exactly the 5 roles")
            self.rule_counts[rule].update(per_role.values())

    def to_dict(self) -> dict:
        slots = self.games * len(ROLES)
        rules = {}
        for rule in RULES:
            counts = self.rule_counts[rule]
            if sum(counts.values()) != slots or set(counts) - set(STATUSES):  # pragma: no cover
                raise RuntimeError(f"slot accounting mismatch for {rule}")
            rules[rule] = {
                "slots": slots,
                "tested": counts.get("consistent", 0) + counts.get("inconsistent", 0),
                "consistent": counts.get("consistent", 0),
                "inconsistent": counts.get("inconsistent", 0),
                "missing": counts.get("dependency_missing", 0),
                "invalid": counts.get("dependency_invalid", 0),
                "unresolved": counts.get("identity_unresolved", 0),
                "arithmetic_unavailable": counts.get("arithmetic_unavailable", 0),
            }
        return {
            "games": self.games,
            "slots_total": slots * len(RULES),
            "identity_unresolved_games": self.identity_unresolved_games,
            "identity_unresolved_reason_game_counts": {
                reason: self.identity_reason_game_counts.get(reason, 0)
                for reason in GAME_IDENTITY_REASONS
            },
            "rules": rules,
        }


def aggregate(games: Iterable[tuple[str, str, LaneGameAudit]]) -> dict:
    """``games`` yields (league, patch, LaneGameAudit)."""
    overall = _Bucket()
    by_league: dict[str, _Bucket] = defaultdict(_Bucket)
    by_patch: dict[str, _Bucket] = defaultdict(_Bucket)
    for league, patch, game in games:
        overall.add(game)
        by_league[league].add(game)
        by_patch[patch].add(game)
    return {
        "overall": overall.to_dict(),
        "by_league": {k: v.to_dict() for k, v in sorted(by_league.items())},
        "by_patch": {k: v.to_dict() for k, v in sorted(by_patch.items())},
    }


# --------------------------------------------------------------------------------------------
# Snapshot binding


def audit_snapshot(raw: bytes, matches: Iterable, *, expected_hash: str) -> dict:
    """Audit adapter-accepted ``MatchRecord``s against the exact verified bytes."""
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("snapshot bytes do not match the verified content hash")
    matches = tuple(matches)
    grouped, headers = raw_player_rows(raw)
    id_counts = Counter(match.match_id for match in matches)
    exclusions: Counter = Counter()
    entries: list[tuple[str, str, LaneGameAudit]] = []
    for match in matches:
        if id_counts[match.match_id] > 1:
            # Fail closed: every copy of an ambiguous ID is excluded, even identical ones.
            exclusions["duplicate_match_id_records"] += 1
            continue
        if _hash_hex(match.provenance.content_hash) != expected_hash:
            exclusions["provenance_hash_mismatch"] += 1
            continue
        observed = match.observed_at
        if observed.tzinfo is None or observed.utcoffset() is None:
            exclusions["naive_observed_at"] += 1
            continue
        if observed.astimezone(UTC).year != SEASON_YEAR:
            exclusions["observed_at_utc_year_out_of_scope"] += 1
            continue
        rows = grouped.get(match.match_id, [])
        game = audit_lane_game(
            rows,
            headers,
            expected_team_ids={"blue": match.blue_team_id, "red": match.red_team_id},
        )
        patch = (match.patch_id or "").strip() or "blank_patch_id"
        entries.append((match.league, patch, game))
    lane_columns = sorted({c for _, level, diff in RULES.values() for c in (level, diff) if c})
    return {
        "scope": {
            "season_year_basis": "observed_at UTC year",
            "season_year": SEASON_YEAR,
            "adapter_accepted_records_seen": len(matches),
            "in_scope_games": len(entries),
            "scope_exclusions": dict(sorted(exclusions.items())),
            "identity_unresolved_games_counted_in_slots": True,
            "raw_lane_columns_present": [c for c in lane_columns if c in headers],
            "raw_lane_columns_absent": [c for c in lane_columns if c not in headers],
        },
        **aggregate(entries),
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

    audit = audit_snapshot(raw, imported.matches, expected_hash=expected)
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
        },
        "relationship_rules": {
            "rules": {
                rule: (
                    f"blue {diff} + red {diff} == 0"
                    if level is None
                    else f"blue {level} - red {level} == blue {diff} and "
                    f"red {level} - blue {level} == red {diff}"
                )
                for rule, (_, level, diff) in RULES.items()
            },
            "basis": "column-name hypotheses; source definitions not re-verified",
            "tolerance": {"absolute": ABS_TOLERANCE, "relative": REL_TOLERANCE},
            "status_precedence": list(STATUSES),
            "tested": "consistent + inconsistent",
            "observed_zero_and_negative_diffs_valid": True,
            "gamelength_used": False,
        },
        **audit,
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
    print(json.dumps({"output": str(output), "in_scope_games": audit["scope"]["in_scope_games"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
