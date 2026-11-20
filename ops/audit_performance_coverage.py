"""Coverage/validity audit of raw per-player numeric observations in one local OE snapshot.

Scope is deliberately narrow: for games the existing ``OracleElixirCSVAdapter`` (behind the
``SourceRegistry`` policy gate) already accepted, count how many player rows carry a stable
identity and, per numeric column, how many values are valid / missing / invalid. Nothing else.

- It does NOT admit any column as a pre-game feature, train or score a model, infer player or
  team strength, or change the existing acceptance path (``audit_simulation_features`` keeps
  marking these columns UNSUPPORTED).
- Units stay RAW_NOT_NORMALIZED; no minute/second or skill conversion is performed.
- Missing is never zero-filled. A literal 0 that was actually observed is valid.
- ``result``/outcome columns are never read as metrics.
- Output is aggregate counts only: no values, player IDs, raw rows or per-team performance.
- Single snapshot: conflicts with other versions of the same file are not examined or resolved.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_OUTPUT_ROOTS = (REPO_ROOT / "web" / "public", REPO_ROOT / "outputs" / "oracles-elixir")
SOURCE_TIMEZONE = "UTC"
ARTIFACT_TYPE = "performance-observation-coverage-audit"
UNIT_STATUS = "RAW_NOT_NORMALIZED"
PLAYER_PARTICIPANT_IDS = tuple(str(value) for value in range(1, 11))
ROLES = ("top", "jng", "mid", "bot", "sup")
SIDES = ("blue", "red")

NON_NEGATIVE = (
    "kills",
    "deaths",
    "assists",
    "totalgold",
    "total cs",
    "damagetochampions",
    "visionscore",
    "goldat15",
    "csat15",
)
# Count-like columns: also require an integral value.
INTEGER = frozenset({"kills", "deaths", "assists", "total cs", "csat15"})
SIGNED = ("golddiffat15", "csdiffat15", "xpdiffat15")
POSITIVE_GAME_CONSTANT = ("gamelength",)
METRICS = NON_NEGATIVE + SIGNED + POSITIVE_GAME_CONSTANT
METRIC_GROUPS = {
    "kda": ("kills", "deaths", "assists"),
    "gold": ("totalgold", "goldat15"),
    "cs": ("total cs", "csat15"),
    "damage": ("damagetochampions",),
    "vision": ("visionscore",),
    "diff_at_15": SIGNED,
    "game_length": POSITIVE_GAME_CONSTANT,
}
NEVER_READ = ("result", "playername", "teamname")
if set(METRICS) & set(NEVER_READ):  # pragma: no cover - static guard
    raise RuntimeError("an outcome/name column is configured as a metric")

MISSING_KINDS = ("blank", "column_absent")
INVALID_KINDS = (
    "nonfinite",
    "unparseable_string",
    "negative_not_allowed",
    "non_positive",
    "non_integer",
    "inconsistent_within_game",
)
IDENTITY_REASONS = (
    "missing_playerid",
    "missing_teamid",
    "invalid_side",
    "invalid_role",
    "duplicate_role_in_team",
    "duplicate_playerid_in_game",
    "teamid_inconsistent_within_side",
)
CLAIMS = (
    "NOT_PREGAME_FEATURE_ADMISSION",
    "NO_MODEL_EFFECT",
    "NO_STRENGTH_INFERENCE",
    "MISSING_IS_NOT_ZERO",
    "OBSERVED_ZERO_IS_VALID",
    "UNITS_RAW_NOT_NORMALIZED",
    "OUTCOME_NOT_READ_AS_METRIC",
    "AGGREGATE_COUNTS_ONLY_NO_VALUES_IDS_OR_ROWS",
    "SINGLE_SNAPSHOT_NO_CROSS_VERSION_RESOLUTION",
    "ADAPTER_ACCEPTED_GAMES_ONLY",
    "NOT_COMPLETE_SEASON_COVERAGE",
)
_SHA256 = re.compile(r"[0-9a-f]{64}")
_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
_NONFINITE = frozenset(
    sign + word for sign in ("", "+", "-") for word in ("nan", "inf", "infinity")
)


# --------------------------------------------------------------------------------------------
# Per-value / per-game classification (pure, no I/O)


def classify_value(raw: str | None, metric: str, *, column_present: bool = True) -> str:
    """Return "valid", a MISSING_KINDS or an INVALID_KINDS entry (game consistency aside)."""
    if not column_present:
        return "column_absent"
    text = (raw or "").strip()
    if not text:
        return "blank"
    if text.lower() in _NONFINITE:
        return "nonfinite"
    if not _NUMBER.fullmatch(text):
        return "unparseable_string"
    value = float(text)
    if not math.isfinite(value):  # e.g. 1e999 overflow
        return "nonfinite"
    if metric in NON_NEGATIVE and value < 0:
        return "negative_not_allowed"
    if metric in POSITIVE_GAME_CONSTANT and value <= 0:
        return "non_positive"
    if metric in INTEGER and not value.is_integer():
        return "non_integer"
    return "valid"


def _identity_reasons(rows: Sequence[Mapping[str, str | None]]) -> list[set[str]]:
    reasons: list[set[str]] = [set() for _ in rows]
    role_seen: Counter = Counter()
    player_seen: Counter = Counter()
    team_by_side: dict[str, set[str]] = defaultdict(set)
    for index, row in enumerate(rows):
        player = (row.get("playerid") or "").strip()
        team = (row.get("teamid") or "").strip()
        side = (row.get("side") or "").strip().lower()
        role = (row.get("position") or "").strip().lower()
        if not player:
            reasons[index].add("missing_playerid")
        else:
            player_seen[player] += 1
        if not team:
            reasons[index].add("missing_teamid")
        if side not in SIDES:
            reasons[index].add("invalid_side")
        else:
            if team:
                team_by_side[side].add(team)
            if role in ROLES:
                role_seen[(side, role)] += 1
        if role not in ROLES:
            reasons[index].add("invalid_role")
    for index, row in enumerate(rows):
        player = (row.get("playerid") or "").strip()
        side = (row.get("side") or "").strip().lower()
        role = (row.get("position") or "").strip().lower()
        if player and player_seen[player] > 1:
            reasons[index].add("duplicate_playerid_in_game")
        if side in SIDES and role in ROLES and role_seen[(side, role)] > 1:
            reasons[index].add("duplicate_role_in_team")
        if side in SIDES and len(team_by_side[side]) > 1:
            reasons[index].add("teamid_inconsistent_within_side")
    return reasons


@dataclass(slots=True)
class GameAudit:
    identity_reasons: list[set[str]]
    statuses: dict[str, list[str]]  # metric -> per-row status

    @property
    def identity_valid(self) -> bool:
        return not any(self.identity_reasons)


def audit_game(rows: Sequence[Mapping[str, str | None]], headers: Iterable[str]) -> GameAudit:
    """Classify the 10 player rows of one accepted game. Rows are never mutated."""
    if len(rows) != len(PLAYER_PARTICIPANT_IDS):
        raise ValueError("an accepted game must contribute exactly 10 player rows")
    present = set(headers)
    identity = _identity_reasons(rows)
    statuses: dict[str, list[str]] = {}
    for metric in METRICS:
        column = metric in present
        per_row = []
        for row, reasons in zip(rows, identity, strict=True):
            if reasons:
                # Never classify (or zero-fill) a value whose owner cannot be identified.
                per_row.append("identity_unresolved")
            else:
                per_row.append(classify_value(row.get(metric), metric, column_present=column))
        if metric in POSITIVE_GAME_CONSTANT:
            values = {
                float((row.get(metric) or "").strip())
                for row, status in zip(rows, per_row, strict=True)
                if status == "valid"
            }
            if len(values) > 1:
                per_row = ["inconsistent_within_game" if s == "valid" else s for s in per_row]
        statuses[metric] = per_row
    return GameAudit(identity, statuses)


# --------------------------------------------------------------------------------------------
# Aggregation


@dataclass(slots=True)
class _Bucket:
    games: int = 0
    identity_valid_rows: int = 0
    identity_invalid_rows: int = 0
    identity_reasons: Counter = field(default_factory=Counter)
    identity_valid_games: int = 0
    metric_counts: dict[str, Counter] = field(
        default_factory=lambda: {metric: Counter() for metric in METRICS}
    )
    metric_full_games: Counter = field(default_factory=Counter)
    group_full_games: Counter = field(default_factory=Counter)

    def add(self, game: GameAudit) -> None:
        self.games += 1
        for reasons in game.identity_reasons:
            if reasons:
                self.identity_invalid_rows += 1
                self.identity_reasons.update(reasons)
            else:
                self.identity_valid_rows += 1
        self.identity_valid_games += game.identity_valid
        full = {}
        for metric, per_row in game.statuses.items():
            self.metric_counts[metric].update(per_row)
            full[metric] = all(status == "valid" for status in per_row)
            self.metric_full_games[metric] += full[metric]
        for name, columns in METRIC_GROUPS.items():
            self.group_full_games[name] += all(full[c] for c in columns)

    def to_dict(self) -> dict:
        expected = self.games * len(PLAYER_PARTICIPANT_IDS)
        metrics = {}
        for metric in METRICS:
            counts = self.metric_counts[metric]
            missing = {kind: counts.get(kind, 0) for kind in MISSING_KINDS}
            invalid = {kind: counts.get(kind, 0) for kind in INVALID_KINDS}
            entry = {
                "kind": (
                    "non_negative_integer"
                    if metric in INTEGER
                    else "non_negative"
                    if metric in NON_NEGATIVE
                    else "signed"
                    if metric in SIGNED
                    else "positive_game_constant"
                ),
                "unit": UNIT_STATUS,
                "valid": counts.get("valid", 0),
                "missing_total": sum(missing.values()),
                "missing": missing,
                "invalid_total": sum(invalid.values()),
                "invalid": invalid,
                "identity_unresolved": counts.get("identity_unresolved", 0),
                "games_all_10_rows_valid": self.metric_full_games[metric],
            }
            accounted = (
                entry["valid"]
                + entry["missing_total"]
                + entry["invalid_total"]
                + entry["identity_unresolved"]
            )
            if accounted != expected:  # pragma: no cover - internal invariant
                raise RuntimeError(f"row accounting mismatch for {metric}")
            metrics[metric] = entry
        return {
            "accepted_games": self.games,
            "expected_player_rows": expected,
            "identity": {
                "valid_rows": self.identity_valid_rows,
                "invalid_rows": self.identity_invalid_rows,
                "invalid_reason_row_counts": {
                    reason: self.identity_reasons.get(reason, 0) for reason in IDENTITY_REASONS
                },
                "games_all_10_rows_identity_valid": self.identity_valid_games,
            },
            "metrics": metrics,
            "metric_groups": {
                name: {
                    "columns": list(columns),
                    "games_all_10_rows_valid_for_every_column": self.group_full_games[name],
                }
                for name, columns in METRIC_GROUPS.items()
            },
        }


def aggregate(games: Iterable[tuple[str, str, GameAudit]]) -> dict:
    """``games`` yields (league, patch, GameAudit). Returns overall/by_league/by_patch counts."""
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


def _hash_hex(value: str) -> str | None:
    normalized = value.strip().lower().removeprefix("sha256:")
    return normalized if _SHA256.fullmatch(normalized) else None


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def raw_player_rows(raw: bytes) -> tuple[dict[str, list[dict[str, str | None]]], list[str]]:
    """Group raw player rows (participantid 1-10) by exact ``oe:{league}:{gameid}``.

    Player names are never used as a key; the ``result`` column is dropped on read.
    """
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    headers = [h for h in (reader.fieldnames or ()) if h is not None]
    keep = set(METRICS) | {"participantid", "playerid", "teamid", "side", "position"}
    grouped: dict[str, list[dict[str, str | None]]] = defaultdict(list)
    for row in reader:
        participant = (row.get("participantid") or "").strip()
        if participant not in PLAYER_PARTICIPANT_IDS:
            continue
        league = (row.get("league") or "").strip()
        gameid = (row.get("gameid") or "").strip()
        grouped[f"oe:{league}:{gameid}"].append({k: row.get(k) for k in keep if k in row})
    for rows in grouped.values():
        rows.sort(key=lambda r: int((r.get("participantid") or "0").strip()))
    return dict(grouped), headers


def audit_snapshot(raw: bytes, matches: Sequence, *, expected_hash: str, year: int) -> dict:
    """Audit adapter-accepted ``MatchRecord``s against the exact verified bytes."""
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("snapshot bytes do not match the verified content hash")
    grouped, headers = raw_player_rows(raw)
    exclusions: Counter = Counter()
    entries: list[tuple[str, str, GameAudit]] = []
    observed: list[datetime] = []
    seen: set[str] = set()
    for match in matches:
        if match.match_id in seen:
            exclusions["duplicate_match_id"] += 1
            continue
        seen.add(match.match_id)
        if _hash_hex(match.provenance.content_hash) != expected_hash:
            exclusions["provenance_hash_mismatch"] += 1
            continue
        if match.observed_at.astimezone(UTC).year != year:
            exclusions["observed_at_utc_year_out_of_scope"] += 1
            continue
        rows = grouped.get(match.match_id)
        if rows is None or [(r.get("participantid") or "").strip() for r in rows] != list(
            PLAYER_PARTICIPANT_IDS
        ):
            exclusions["raw_player_rows_not_exactly_1_to_10"] += 1
            continue
        entries.append((match.league, match.patch_id, audit_game(rows, headers)))
        observed.append(match.observed_at.astimezone(UTC))
    result = aggregate(entries)
    return {
        "scope": {
            "season_year_basis": "observed_at UTC year",
            "season_year": year,
            "in_scope_games": len(entries),
            "observed_range": (
                {"first": _iso(min(observed)), "last": _iso(max(observed))} if observed else None
            ),
            "accepted_match_exclusions": dict(sorted(exclusions.items())),
            "raw_metric_columns_present": [m for m in METRICS if m in headers],
            "raw_metric_columns_absent": [m for m in METRICS if m not in headers],
        },
        **result,
    }


def validate_output_path(output: Path, source: Path) -> Path:
    resolved = output.resolve()
    for root in FORBIDDEN_OUTPUT_ROOTS:
        if resolved.is_relative_to(root.resolve()):
            raise ValueError("refusing to write inside web/public or the raw snapshot archive")
    parts = [part.lower() for part in resolved.parts]
    if any(a == "web" and b == "public" for a, b in zip(parts, parts[1:], strict=False)):
        raise ValueError("refusing to write inside a web/public directory")
    if resolved == source.resolve():
        raise ValueError("refusing to write over the source snapshot")
    if resolved.suffix.lower() != ".json":
        raise ValueError("output must be a .json report")
    if resolved.exists() or output.is_symlink():
        raise ValueError("output already exists; choose a new path to preserve prior reports")
    return resolved


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True, help="actual local retrieval time (ISO)")
    parser.add_argument("--content-hash", required=True, help="expected sha256 hex of --input")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--year", type=int, default=2026, help="observed_at UTC year")
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

    audit = audit_snapshot(raw, imported.matches, expected_hash=expected, year=args.year)
    report = {
        "artifact_type": ARTIFACT_TYPE,
        "local_diagnostic": True,
        "claims": list(CLAIMS),
        "source": {
            "source_id": "oracles-elixir-match-data",
            "source_hash_sha256": expected,
            "byte_length": imported.report.byte_length,
            "retrieved_at": _iso(retrieved_at),
            "retrieved_at_basis": "actual local retrieval time supplied by operator",
            "source_timezone": SOURCE_TIMEZONE,
            "adapter_discovered_games": imported.report.discovered_game_count,
            "adapter_accepted_games": imported.report.imported_game_count,
            "adapter_rejected_games": imported.report.rejected_game_count,
            "adapter_rejection_counts": dict(imported.report.issue_counts),
        },
        "metric_rules": {
            "non_negative": list(NON_NEGATIVE),
            "integer_required": sorted(INTEGER),
            "signed_negative_allowed": list(SIGNED),
            "positive_and_identical_across_10_rows": list(POSITIVE_GAME_CONSTANT),
            "unit": UNIT_STATUS,
            "columns_never_read_as_metrics": list(NEVER_READ),
            "identity_required": "playerid, teamid, side, position; 5 unique roles per side",
        },
        **audit,
        "network_collection_performed": False,
        "source_modified": False,
        "publication_permitted": False,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:  # pragma: no cover
        raise SystemExit("source changed during the audit")
    print(json.dumps({"output": str(output), "in_scope_games": audit["scope"]["in_scope_games"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
