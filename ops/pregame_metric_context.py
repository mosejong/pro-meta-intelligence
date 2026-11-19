"""Describe where one player's pre-match golddiffat15 history mean sits among peers.

Local research helper only. It is NOT a strength estimate, win-rate, substitution effect,
era adjustment, model or feature admission:

- Metric is fixed to ``golddiffat15`` as a locally fixed research specification, set before this
  diagnostic and not chosen by looking at its performance. There was NO public or external
  preregistration. The underlying cohort has already been explored in earlier local research, so
  results here are not independent validation. Values stay RAW_NOT_NORMALIZED; no unit/formula
  check and no combination with other metrics is performed.
- Reference group: same league, same role, exact same patch. The target match is excluded for
  every player, and only rows with ``observed_at + publication_delay <= cutoff`` are used, from
  the very first step of peer discovery. Players seen only in the future or only in the target
  match therefore never affect candidate counts or results.
- The queried player is excluded from the reference. Every peer's history is obtained by calling
  the existing ``extract_player_history`` with the same target/role/patch/cutoff, so leakage,
  duplicate, window (latest 20) and minimum (5) behaviour is reused, not duplicated.
- Each peer contributes exactly one mean (equal weight) regardless of how many games it has.
- ``position_fraction`` = (peers below + 0.5 * exact ties) / eligible peers. It is a
  descriptive value in [0, 1], not a probability or skill percentile. No pooled mean, standard
  deviation, z-score, regression, label or result column is read or computed.
- The returned ``target.mean_raw`` is for internal research only and must never be exposed in a
  release, web page, CLI or serialized export. Per-peer values and IDs are never returned.
- "No support" (insufficient status) is not a zero or average skill statement.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta

from ops.audit_performance_coverage import UNIT_STATUS
from ops.pregame_player_history import (
    AVAILABILITY_BASIS,
    MEAN_COMPUTED,
    TARGET_ROSTER_BASIS,
    HistoryConfig,
    HistoryObservation,
    HistoryQuery,
    extract_player_history,
)

ARTIFACT_TYPE = "pregame-metric-context"
METRIC = "golddiffat15"
DEFAULT_DELAY = timedelta(hours=24)

STATUS_AVAILABLE = "descriptive_context_available"
STATUS_TARGET_INSUFFICIENT = "target_insufficient"
STATUS_PEERS_INSUFFICIENT = "peers_insufficient"

DELAY_CLAIM_DEFAULT = "SIMULATED_24H_NOT_ACTUAL_AVAILABILITY"
DELAY_CLAIM_CONFIGURED = "SIMULATED_CONFIGURED_DELAY_NOT_ACTUAL_AVAILABILITY"

_BASE_CLAIMS = (
    "NO_MODEL_NO_LABELS_NO_OUTCOME",
    "EXACT_LEAGUE_ROLE_PATCH_ONLY",
    "EACH_PEER_EQUAL_WEIGHT",
    "TARGET_PLAYER_EXCLUDED_FROM_REFERENCE",
    "LOCAL_RESEARCH_ONLY_NOT_FOR_EXPORT",
    "NOT_STRENGTH_OR_WINRATE_OR_FEATURE_ADMISSION",
)


def _require_league(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("league must be a string")
    if not value or value != value.strip():
        raise ValueError("league must be a non-empty string without surrounding whitespace")
    return value


@dataclass(frozen=True)
class ContextObservation:
    """A ``HistoryObservation`` tagged with its league."""

    league: str
    observation: HistoryObservation

    def __post_init__(self) -> None:
        _require_league(self.league)
        if not isinstance(self.observation, HistoryObservation):
            raise TypeError("observation must be a HistoryObservation")


def _target_metric(history: dict) -> dict:
    return history["metrics"][METRIC]


def build_metric_context(
    observations: Iterable[ContextObservation],
    query: HistoryQuery,
    *,
    league: str,
    config: HistoryConfig | None = None,
    minimum_peer_players: int = 5,
) -> dict:
    """Return a local descriptive position of the query player's golddiffat15 history mean."""
    if not isinstance(query, HistoryQuery):
        raise TypeError("query must be a HistoryQuery")
    _require_league(league)
    config = HistoryConfig() if config is None else config
    if not isinstance(config, HistoryConfig):
        raise TypeError("config must be a HistoryConfig")
    if isinstance(minimum_peer_players, bool) or not isinstance(minimum_peer_players, int):
        raise TypeError("minimum_peer_players must be an int (bool is rejected)")
    if minimum_peer_players <= 0:
        raise ValueError("minimum_peer_players must be positive")
    if isinstance(observations, (str, bytes)):
        raise TypeError("observations must be an iterable of ContextObservation")
    items = tuple(observations)
    for item in items:
        if not isinstance(item, ContextObservation):
            raise TypeError("observations must be ContextObservation instances")

    # Exact league only; the extractor itself handles role/patch/target/availability/duplicates.
    in_league = tuple(item.observation for item in items if item.league == league)

    target_history = extract_player_history(in_league, query, config)
    target_entry = _target_metric(target_history)
    target_ok = target_entry["mean_status"] == MEAN_COMPUTED
    target_mean = target_entry["mean_raw"] if target_ok else None

    # Peer discovery applies role/patch/target-match/availability filters up front.
    delay = config.publication_delay
    candidate_ids = sorted(
        {
            o.player_id
            for o in in_league
            if o.player_id != query.player_id
            and o.role == query.role
            and o.patch_id == query.patch_id
            and o.match_id != query.target_match_id
            and o.observed_at + delay <= query.cutoff
        }
    )

    peer_means: list[float] = []
    for peer_id in candidate_ids:
        peer_query = HistoryQuery(
            target_match_id=query.target_match_id,
            player_id=peer_id,
            role=query.role,
            patch_id=query.patch_id,
            cutoff=query.cutoff,
        )
        entry = _target_metric(extract_player_history(in_league, peer_query, config))
        if entry["mean_status"] == MEAN_COMPUTED:
            peer_means.append(float(entry["mean_raw"]))

    eligible = len(peer_means)
    if not target_ok:
        status = STATUS_TARGET_INSUFFICIENT
    elif eligible < minimum_peer_players:
        status = STATUS_PEERS_INSUFFICIENT
    else:
        status = STATUS_AVAILABLE

    position: dict = {
        "less_count": None,
        "equal_count": None,
        "greater_count": None,
        "position_fraction": None,
        "reference_degenerate": None,
    }
    if status == STATUS_AVAILABLE and eligible > 0:
        less = sum(m < target_mean for m in peer_means)
        equal = sum(m == target_mean for m in peer_means)
        greater = sum(m > target_mean for m in peer_means)
        position = {
            "less_count": less,
            "equal_count": equal,
            "greater_count": greater,
            "position_fraction": (less + 0.5 * equal) / eligible,
            "reference_degenerate": len(set(peer_means)) == 1,
        }

    delay_claim = DELAY_CLAIM_DEFAULT if delay == DEFAULT_DELAY else DELAY_CLAIM_CONFIGURED
    return {
        "artifact_type": ARTIFACT_TYPE,
        "local_research_only": True,
        "publication_permitted": False,
        "claims": [*_BASE_CLAIMS, delay_claim],
        "metric": METRIC,
        "unit": UNIT_STATUS,
        "status": status,
        "query_context": {
            "league": league,
            "role": query.role,
            "patch_id": query.patch_id,
            "cutoff": target_history["query"]["cutoff"],
        },
        "config": {
            "publication_delay_seconds": delay.total_seconds(),
            "maximum_games": config.maximum_games,
            "minimum_games": config.minimum_games,
            "minimum_peer_players": minimum_peer_players,
        },
        "history_delay_basis": AVAILABILITY_BASIS,
        "known_roster_assumption": TARGET_ROSTER_BASIS,
        "target": {
            "valid_count": target_entry["valid_count"],
            "games_used": target_history["games_used"],
            "mean_raw": target_mean,
            "mean_raw_internal_research_only": True,
        },
        "peers": {
            "candidate_count": len(candidate_ids),
            "eligible_count": eligible,
            "insufficient_count": len(candidate_ids) - eligible,
        },
        "position": position,
    }
