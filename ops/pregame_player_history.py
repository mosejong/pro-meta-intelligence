"""Pure, leak-guarded extraction of one player's prior raw observations before a target match.

Research-only helper. It is NOT a pre-match data collector, model, feature admission or
strength estimate:

- Availability is SIMULATED as ``observed_at + publication_delay`` (fixed 24h by default). It
  does not reproduce when data was really published or retrieved. A snapshot's real
  ``retrieved_at`` is separate provenance and is never back-dated or used here.
- The target match's roster (which player/role is queried) is a caller-supplied assumption
  (``known_target_roster_assumption``); nothing claims it was known in advance.
- The target match itself (its results, stats, outcome) is always excluded by ``match_id``.
- Values stay RAW_NOT_NORMALIZED. Missing/invalid values are never zero-filled; an observed
  literal 0 is valid. No skill, win-rate or per-minute conversion is performed.
- The returned dict is a local research artifact (it carries match IDs for leak audits) and
  must not be exported to public files or the web.
- ``maximum_games=20`` / ``minimum_games=5`` are the extractor's research specification, not
  values selected for predictive performance.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from types import MappingProxyType

from ops.audit_performance_coverage import (
    INVALID_KINDS,
    METRICS,
    MISSING_KINDS,
    ROLES,
    UNIT_STATUS,
    classify_value,
)

ARTIFACT_TYPE = "pregame-player-history-extract"
AVAILABILITY_BASIS = "observed_at_plus_fixed_publication_delay_assumption"
TARGET_ROSTER_BASIS = "known_target_roster_assumption"
SORT_KEY = "(observed_at, match_id)"
CLAIMS = (
    "LOCAL_RESEARCH_ONLY_NOT_FOR_EXPORT",
    "SIMULATED_AVAILABILITY_NOT_ACTUAL_PUBLICATION_TIME",
    "SNAPSHOT_RETRIEVED_AT_NOT_USED_OR_BACKDATED",
    "TARGET_ROSTER_IS_CALLER_ASSUMPTION",
    "TARGET_MATCH_EXCLUDED",
    "NO_MODEL_NO_LABELS_NO_OUTCOME",
    "NO_STRENGTH_OR_WINRATE_INFERENCE",
    "UNITS_RAW_NOT_NORMALIZED",
    "MISSING_IS_NOT_ZERO",
    "OBSERVED_ZERO_IS_VALID",
    "DUPLICATE_MATCH_OBSERVATIONS_ALL_EXCLUDED",
    "LIMITS_ARE_RESEARCH_SPEC_NOT_PERFORMANCE_TUNED",
)

MEAN_COMPUTED = "computed"
MEAN_INSUFFICIENT = "insufficient_valid_values"
MEAN_NONFINITE = "nonfinite_mean_not_reported"


# --------------------------------------------------------------------------------------------
# Validation helpers


def _require_id(name: str, value: object) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"{name} must be a non-empty string without surrounding whitespace")
    return value


def _require_role(value: object) -> str:
    if not isinstance(value, str) or value not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    return value


def _require_aware(name: str, value: object) -> datetime:
    if not isinstance(value, datetime):
        raise TypeError(f"{name} must be a datetime")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value


def _require_positive_int(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int (bool is rejected)")
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------------------------
# Public types


@dataclass(frozen=True)
class HistoryObservation:
    """One player's raw metrics from one past match. ``metrics`` values are raw strings/None."""

    match_id: str
    player_id: str
    role: str
    patch_id: str
    observed_at: datetime
    metrics: Mapping[str, str | None] = field(hash=False)

    def __post_init__(self) -> None:
        _require_id("match_id", self.match_id)
        _require_id("player_id", self.player_id)
        _require_role(self.role)
        _require_id("patch_id", self.patch_id)
        _require_aware("observed_at", self.observed_at)
        if not isinstance(self.metrics, Mapping):
            raise TypeError("metrics must be a mapping of metric name -> raw string or None")
        copied: dict[str, str | None] = {}
        for key, value in self.metrics.items():
            if key not in METRICS:
                # Also guards against outcome/name columns (e.g. "result") being passed in.
                raise ValueError(f"unknown metric key: {key!r}")
            if value is not None and not isinstance(value, str):
                raise TypeError(f"metric {key!r} must be a raw string or None")
            copied[key] = value
        # Defensive read-only copy: the caller's mapping is never referenced or mutated.
        object.__setattr__(self, "metrics", MappingProxyType(copied))


@dataclass(frozen=True)
class HistoryQuery:
    """Which player/role/patch to collect for, before ``cutoff``, excluding the target match."""

    target_match_id: str
    player_id: str
    role: str
    patch_id: str
    cutoff: datetime

    def __post_init__(self) -> None:
        _require_id("target_match_id", self.target_match_id)
        _require_id("player_id", self.player_id)
        _require_role(self.role)
        _require_id("patch_id", self.patch_id)
        _require_aware("cutoff", self.cutoff)


@dataclass(frozen=True)
class HistoryConfig:
    publication_delay: timedelta = timedelta(hours=24)
    maximum_games: int = 20
    minimum_games: int = 5

    def __post_init__(self) -> None:
        if not isinstance(self.publication_delay, timedelta):
            raise TypeError("publication_delay must be a timedelta")
        if self.publication_delay <= timedelta(0):
            raise ValueError("publication_delay must be strictly positive")
        _require_positive_int("maximum_games", self.maximum_games)
        _require_positive_int("minimum_games", self.minimum_games)
        if self.minimum_games > self.maximum_games:
            raise ValueError("minimum_games must be <= maximum_games")


# --------------------------------------------------------------------------------------------
# Aggregation


def _safe_mean(values: list[float]) -> float | None:
    """Mean of finite floats without overflow; None if the result cannot be finite."""
    count = len(values)
    try:
        total = math.fsum(values)
        if math.isfinite(total):
            return total / count
    except OverflowError:
        pass
    try:
        mean = math.fsum(value / count for value in values)
    except OverflowError:
        return None
    return mean if math.isfinite(mean) else None


def _metric_summary(used: list[HistoryObservation], metric: str, minimum: int) -> dict:
    counts: Counter = Counter()
    valid_values: list[float] = []
    for observation in used:
        present = metric in observation.metrics
        raw = observation.metrics.get(metric)
        status = classify_value(raw, metric, column_present=present)
        counts[status] += 1
        if status == "valid":
            valid_values.append(float((raw or "").strip()))
    missing = {kind: counts.get(kind, 0) for kind in MISSING_KINDS}
    invalid = {kind: counts.get(kind, 0) for kind in INVALID_KINDS}
    valid_count = counts.get("valid", 0)
    if valid_count < minimum:
        mean, status = None, MEAN_INSUFFICIENT
    else:
        mean = _safe_mean(valid_values)
        status = MEAN_COMPUTED if mean is not None else MEAN_NONFINITE
    return {
        "unit": UNIT_STATUS,
        "valid_count": valid_count,
        "missing_count": sum(missing.values()),
        "missing": missing,
        "invalid_count": sum(invalid.values()),
        "invalid": invalid,
        "mean_raw": mean,
        "mean_status": status,
    }


def extract_player_history(
    observations: Iterable[HistoryObservation],
    query: HistoryQuery,
    config: HistoryConfig | None = None,
) -> dict:
    """Return the latest eligible raw history for ``query``. Inputs are never mutated."""
    if not isinstance(query, HistoryQuery):
        raise TypeError("query must be a HistoryQuery")
    config = HistoryConfig() if config is None else config
    if not isinstance(config, HistoryConfig):
        raise TypeError("config must be a HistoryConfig")
    items = tuple(observations)
    for item in items:
        if not isinstance(item, HistoryObservation):
            raise TypeError("observations must be HistoryObservation instances")

    # Scope: exact player_id + role only. Other players/roles never influence this query.
    scoped = [o for o in items if o.player_id == query.player_id and o.role == query.role]
    target_excluded = sum(o.match_id == query.target_match_id for o in scoped)
    scoped = [o for o in scoped if o.match_id != query.target_match_id]

    # Decide availability before resolving duplicates: not-yet-available revisions must not
    # erase history that was eligible at the cutoff (a subtle form of future information).
    delay = config.publication_delay
    available = [o for o in scoped if o.observed_at + delay <= query.cutoff]
    not_yet_available = len(scoped) - len(available)
    scoped = available

    # Drop every available copy of a duplicate match; no correction priority is guessed.
    by_match: dict[str, int] = defaultdict(int)
    for observation in scoped:
        by_match[observation.match_id] += 1
    duplicate_ids = {match_id for match_id, n in by_match.items() if n > 1}
    duplicate_observations = sum(by_match[m] for m in duplicate_ids)
    scoped = [o for o in scoped if o.match_id not in duplicate_ids]

    patch_mismatch = sum(o.patch_id != query.patch_id for o in scoped)
    scoped = [o for o in scoped if o.patch_id == query.patch_id]

    eligible = scoped

    eligible.sort(key=lambda o: (o.observed_at, o.match_id))
    used = eligible[-config.maximum_games :]
    beyond_maximum = len(eligible) - len(used)

    latest_available = _iso(used[-1].observed_at + delay) if used else None
    return {
        "artifact_type": ARTIFACT_TYPE,
        "local_research_only": True,
        "publication_permitted": False,
        "claims": list(CLAIMS),
        "availability_basis": AVAILABILITY_BASIS,
        "target_roster_basis": TARGET_ROSTER_BASIS,
        "unit": UNIT_STATUS,
        "query": {
            "target_match_id": query.target_match_id,
            "player_id": query.player_id,
            "role": query.role,
            "patch_id": query.patch_id,
            "cutoff": _iso(query.cutoff),
        },
        "config": {
            "publication_delay_seconds": delay.total_seconds(),
            "maximum_games": config.maximum_games,
            "minimum_games": config.minimum_games,
        },
        "selection_order": SORT_KEY,
        "games_used": len(used),
        "sample": {
            "games_used": len(used),
            "minimum_games": config.minimum_games,
            "below_minimum_games": len(used) < config.minimum_games,
        },
        "used_match_ids": [o.match_id for o in used],
        "latest_simulated_available_at": latest_available,
        "exclusions": {
            "target_match_observations": target_excluded,
            "duplicate_match_ids": len(duplicate_ids),
            "duplicate_match_observations": duplicate_observations,
            "patch_mismatch": patch_mismatch,
            "not_yet_available_at_cutoff": not_yet_available,
            "beyond_maximum_games": beyond_maximum,
        },
        "metrics": {
            metric: _metric_summary(used, metric, config.minimum_games) for metric in METRICS
        },
    }
