"""Exploratory offline check: does draft (champion) information add predictive value over team Elo?

This is a fixed-design walk-forward experiment, not a product feature and not a trained package
model. It reads only the approved local Oracle's Elixir archive snapshot (no network), verifies it
against its archive metadata, and imports it through the existing policy-gated adapter.

Timing rules
------------
* Every game is predicted strictly before its ``observed_at`` using only labels whose *simulated*
  publication time (``observed_at + 24h``) is strictly earlier than that cutoff. Games sharing a
  timestamp can never see each other's labels.
* The source's real ``available_at`` is the bulk retrieval time of the whole file, so it is NOT a
  historical availability record. The simulated publication time is kept in a separate field and
  the source provenance is never rewritten.

Models (hyperparameters are frozen; no search is performed)
-----------------------------------------------------------
* Elo: start 1500, K 20, scale 400, no side advantage, keyed by stable team ID.
* Elo+draft: ``sigmoid(logit(p_elo) + sum(blue champion w) - sum(red champion w))`` with online
  logistic SGD (lr 0.03, per-update L2 decay 0.9999 on the champions in that game).

Run from the repository root: ``python -m ops.draft_outcome_baseline``.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import random
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent, Side

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "oracles-elixir-match-data"
RAW_DIR = ROOT / "outputs" / "oracles-elixir" / "raw" / SOURCE_ID
APPROVED_HASH = "fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de"
APPROVED_RETRIEVED_AT = datetime(2026, 11, 11, 2, 19, 29, 155420, tzinfo=UTC)
DEFAULT_CSV = RAW_DIR / f"{APPROVED_HASH}.csv"
DEFAULT_META = RAW_DIR / f"{APPROVED_HASH}.20261111T021929155420Z.meta.json"
DEFAULT_OUTPUT = ROOT / "outputs" / "draft-outcome-baseline-20261117.json"

ARTIFACT_TYPE = "draft-outcome-baseline-experiment"
SCHEMA_VERSION = "1"

# ---- Frozen experiment design (do not tune after looking at results) -------------------------
SEASON = "2026"
EVALUATION_START = datetime(2026, 8, 1, tzinfo=UTC)
PUBLICATION_DELAY = timedelta(hours=24)
ELO_INITIAL = 1500.0
ELO_K = 20.0
ELO_SCALE = 400.0
ELO_SIDE_ADVANTAGE = 0.0
DRAFT_LEARNING_RATE = 0.03
DRAFT_L2_FACTOR = 0.9999
LOGLOSS_EPSILON = 1e-12
BOOTSTRAP_REPLICATES = 1000
BOOTSTRAP_SEED = 20261117
MINIMUM_BOOTSTRAP_DAYS = 10
MINIMUM_SEGMENT_GAMES = 30
FOCUS_LEAGUES = ("WLDs", "LCK", "LEC", "LPL")
TEAM_SIZE = 5

LN10 = math.log(10.0)


@dataclass(frozen=True, slots=True)
class FrozenParameters:
    season: str = SEASON
    evaluation_start: str = EVALUATION_START.isoformat()
    publication_delay_hours: float = PUBLICATION_DELAY.total_seconds() / 3600
    elo_initial: float = ELO_INITIAL
    elo_k: float = ELO_K
    elo_scale: float = ELO_SCALE
    elo_side_advantage: float = ELO_SIDE_ADVANTAGE
    draft_learning_rate: float = DRAFT_LEARNING_RATE
    draft_l2_factor: float = DRAFT_L2_FACTOR
    logloss_epsilon: float = LOGLOSS_EPSILON
    bootstrap_replicates: int = BOOTSTRAP_REPLICATES
    bootstrap_seed: int = BOOTSTRAP_SEED
    minimum_bootstrap_days: int = MINIMUM_BOOTSTRAP_DAYS
    minimum_segment_games: int = MINIMUM_SEGMENT_GAMES

    def to_dict(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in self.__slots__}


FROZEN = FrozenParameters()


@dataclass(frozen=True, slots=True)
class GameSample:
    match_id: str
    league: str
    patch_id: str
    observed_at: datetime
    blue_team_id: str
    red_team_id: str
    blue_win: bool
    blue_champions: tuple[str, ...]
    red_champions: tuple[str, ...]
    # Real provenance: bulk retrieval time of the whole file (not historical availability).
    source_available_at: datetime

    @property
    def simulated_label_available_at(self) -> datetime:
        return self.observed_at + PUBLICATION_DELAY


@dataclass(frozen=True, slots=True)
class GamePrediction:
    sample: GameSample
    elo_logit: float
    p_elo: float
    p_draft: float
    evaluated: bool
    labels_known_at_prediction: int


@dataclass(slots=True)
class WalkForwardResult:
    predictions: list[GamePrediction]
    labels_applied: int
    labels_pending_at_end: int
    final_ratings: dict[str, float] = field(default_factory=dict)
    final_weights: dict[str, float] = field(default_factory=dict)


# ---- Sample preparation ----------------------------------------------------------------------


def prepare_samples(
    matches: Iterable[MatchRecord],
    draft_events: Iterable[PickBanEvent],
    *,
    season: str = SEASON,
) -> tuple[list[GameSample], dict[str, int]]:
    """Keep only season games with two distinct teams, a valid winner and 5 unique picks a side.

    Only team IDs, side, winner, league, patch, time and picked champions are kept. Players,
    roles and in-game statistics are deliberately dropped.
    """

    picks: dict[str, list[PickBanEvent]] = defaultdict(list)
    for event in draft_events:
        if event.action is DraftAction.PICK:
            picks[event.match_id].append(event)
    exclusions: Counter[str] = Counter()
    samples: list[GameSample] = []
    seen: set[str] = set()
    for match in matches:
        reason, sample = _validate(match, picks.get(match.match_id, ()), season, seen)
        seen.add(match.match_id)
        if reason is not None:
            exclusions[reason] += 1
            continue
        assert sample is not None
        samples.append(sample)
    return samples, dict(sorted(exclusions.items()))


def _validate(
    match: MatchRecord,
    events: Sequence[PickBanEvent],
    season: str,
    seen: set[str],
) -> tuple[str | None, GameSample | None]:
    if match.match_id in seen:
        return "DUPLICATE_MATCH_ID", None
    if match.tournament.split(" ", 1)[0] != season:
        return "OUTSIDE_SEASON", None
    blue, red = match.blue_team_id.strip(), match.red_team_id.strip()
    if not blue or not red:
        return "MISSING_TEAM_ID", None
    if blue == red:
        return "SAME_TEAM_BOTH_SIDES", None
    winner = match.winner_team_id.strip()
    if winner not in (blue, red):
        return "WINNER_NOT_A_PARTICIPANT", None
    by_side: dict[Side, list[str]] = {Side.BLUE: [], Side.RED: []}
    for event in sorted(events, key=lambda item: item.sequence):
        expected_team = blue if event.side is Side.BLUE else red
        if event.team_id.strip() != expected_team:
            return "PICK_TEAM_MISMATCH", None
        champion = event.champion_id.strip()
        if not champion:
            return "BLANK_CHAMPION", None
        by_side[event.side].append(champion)
    for side in (Side.BLUE, Side.RED):
        if len(by_side[side]) != TEAM_SIZE:
            return f"{side.value}_PICK_COUNT_NOT_5", None
        if len({value.casefold() for value in by_side[side]}) != TEAM_SIZE:
            return "DUPLICATE_CHAMPION_WITHIN_TEAM", None
    blue_keys = {value.casefold() for value in by_side[Side.BLUE]}
    if blue_keys & {value.casefold() for value in by_side[Side.RED]}:
        return "CHAMPION_ON_BOTH_TEAMS", None
    return None, GameSample(
        match_id=match.match_id,
        league=match.league,
        patch_id=match.patch_id,
        observed_at=match.observed_at,
        blue_team_id=blue,
        red_team_id=red,
        blue_win=winner == blue,
        blue_champions=tuple(by_side[Side.BLUE]),
        red_champions=tuple(by_side[Side.RED]),
        source_available_at=match.available_at,
    )


# ---- Models ----------------------------------------------------------------------------------


def sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exp = math.exp(value)
    return exp / (1.0 + exp)


def elo_logit(blue_rating: float, red_rating: float) -> float:
    """logit of the Elo blue-win probability 1 / (1 + 10^((R_red - R_blue - adv) / scale))."""

    return (blue_rating - red_rating + ELO_SIDE_ADVANTAGE) * LN10 / ELO_SCALE


def _champion_key(name: str) -> str:
    return name.casefold()


def _draft_margin(sample: GameSample, weights: dict[str, float]) -> float:
    blue = sum(weights.get(_champion_key(name), 0.0) for name in sample.blue_champions)
    red = sum(weights.get(_champion_key(name), 0.0) for name in sample.red_champions)
    return blue - red


def run_walk_forward(
    samples: Sequence[GameSample],
    *,
    evaluation_start: datetime = EVALUATION_START,
) -> WalkForwardResult:
    """Predict every game in time order, then queue its label for the simulated publication time.

    A queued label is applied only when ``observed_at + 24h`` is strictly earlier than the cutoff
    of the game being predicted. When applied:

    * Elo moves by ``K * (y - p_elo)`` with ``p_elo`` the stored prediction-time Elo probability.
    * Champion weights use the prediction-time Elo logit and the game's own picks with the
      weights current at application time: ``p = sigmoid(elo_logit_pred + margin)``,
      ``err = y - p``; each pick's weight is multiplied by the L2 factor, then moves by
      ``+lr * err`` (blue) or ``-lr * err`` (red).
    """

    ordered = sorted(samples, key=lambda item: (item.observed_at, item.match_id))
    ratings: dict[str, float] = {}
    weights: dict[str, float] = {}
    pending: list[tuple[datetime, datetime, str, int]] = []
    predictions: list[GamePrediction] = []
    applied = 0

    def apply(index: int) -> None:
        prediction = predictions[index]
        sample = prediction.sample
        outcome = 1.0 if sample.blue_win else 0.0
        delta = ELO_K * (outcome - prediction.p_elo)
        ratings[sample.blue_team_id] = ratings.get(sample.blue_team_id, ELO_INITIAL) + delta
        ratings[sample.red_team_id] = ratings.get(sample.red_team_id, ELO_INITIAL) - delta
        probability = sigmoid(prediction.elo_logit + _draft_margin(sample, weights))
        error = outcome - probability
        for names, sign in ((sample.blue_champions, 1.0), (sample.red_champions, -1.0)):
            for name in names:
                key = _champion_key(name)
                weights[key] = weights.get(key, 0.0) * DRAFT_L2_FACTOR + sign * (
                    DRAFT_LEARNING_RATE * error
                )

    for sample in ordered:
        cutoff = sample.observed_at
        while pending and pending[0][0] < cutoff:
            _, _, _, index = heapq.heappop(pending)
            apply(index)
            applied += 1
        logit = elo_logit(
            ratings.get(sample.blue_team_id, ELO_INITIAL),
            ratings.get(sample.red_team_id, ELO_INITIAL),
        )
        predictions.append(
            GamePrediction(
                sample=sample,
                elo_logit=logit,
                p_elo=sigmoid(logit),
                p_draft=sigmoid(logit + _draft_margin(sample, weights)),
                evaluated=sample.observed_at >= evaluation_start,
                labels_known_at_prediction=applied,
            )
        )
        heapq.heappush(
            pending,
            (
                sample.simulated_label_available_at,
                sample.observed_at,
                sample.match_id,
                len(predictions) - 1,
            ),
        )
    return WalkForwardResult(
        predictions=predictions,
        labels_applied=applied,
        labels_pending_at_end=len(pending),
        final_ratings=dict(ratings),
        final_weights=dict(weights),
    )


# ---- Metrics ---------------------------------------------------------------------------------


def logloss(probability: float, outcome: bool) -> float:
    clamped = min(max(probability, LOGLOSS_EPSILON), 1.0 - LOGLOSS_EPSILON)
    return -math.log(clamped if outcome else 1.0 - clamped)


def brier(probability: float, outcome: bool) -> float:
    return (probability - (1.0 if outcome else 0.0)) ** 2


def correct(probability: float, outcome: bool) -> float:
    """1 if the favored side won, 0 if it lost, 0.5 for an exact 50% call."""

    if probability == 0.5:
        return 0.5
    return 1.0 if (probability > 0.5) == outcome else 0.0


MODEL_PROBABILITY = {
    "coin_50": lambda prediction: 0.5,
    "elo": lambda prediction: prediction.p_elo,
    "elo_draft": lambda prediction: prediction.p_draft,
}


def summarize(predictions: Sequence[GamePrediction]) -> dict[str, Any]:
    n = len(predictions)
    result: dict[str, Any] = {"games": n}
    if n == 0:
        return result
    result["blue_win_rate"] = round(sum(p.sample.blue_win for p in predictions) / n, 6)
    for name, probability_of in MODEL_PROBABILITY.items():
        probabilities = [(probability_of(p), p.sample.blue_win) for p in predictions]
        result[name] = {
            "accuracy": round(sum(correct(q, y) for q, y in probabilities) / n, 6),
            "logloss": round(sum(logloss(q, y) for q, y in probabilities) / n, 6),
            "brier": round(sum(brier(q, y) for q, y in probabilities) / n, 6),
        }
    result["draft_minus_elo"] = {
        metric: round(result["elo_draft"][metric] - result["elo"][metric], 6)
        for metric in ("accuracy", "logloss", "brier")
    }
    result["sufficient_sample"] = n >= MINIMUM_SEGMENT_GAMES
    return result


def paired_daily_bootstrap(predictions: Sequence[GamePrediction]) -> dict[str, Any]:
    """Mean per-game (draft - elo) loss difference with a day-cluster bootstrap 95% interval.

    Days are UTC calendar days of ``observed_at``; whole days are resampled so games from the same
    day stay together. The interval is descriptive of this data only.
    """

    days: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for prediction in predictions:
        outcome = prediction.sample.blue_win
        days[prediction.sample.observed_at.astimezone(UTC).date().isoformat()].append(
            (
                logloss(prediction.p_draft, outcome) - logloss(prediction.p_elo, outcome),
                brier(prediction.p_draft, outcome) - brier(prediction.p_elo, outcome),
            )
        )
    keys = sorted(days)
    clusters = [
        (len(days[key]), sum(item[0] for item in days[key]), sum(item[1] for item in days[key]))
        for key in keys
    ]
    games = sum(item[0] for item in clusters)
    result: dict[str, Any] = {"days": len(keys), "games": games}
    if games == 0:
        return result
    result["mean_logloss_difference"] = round(sum(item[1] for item in clusters) / games, 6)
    result["mean_brier_difference"] = round(sum(item[2] for item in clusters) / games, 6)
    if len(keys) < MINIMUM_BOOTSTRAP_DAYS:
        result["bootstrap"] = None
        result["bootstrap_note"] = f"fewer than {MINIMUM_BOOTSTRAP_DAYS} days; no interval"
        return result
    rng = random.Random(BOOTSTRAP_SEED)
    log_stats: list[float] = []
    brier_stats: list[float] = []
    for _ in range(BOOTSTRAP_REPLICATES):
        draw = [clusters[rng.randrange(len(clusters))] for _ in clusters]
        count = sum(item[0] for item in draw)
        log_stats.append(sum(item[1] for item in draw) / count)
        brier_stats.append(sum(item[2] for item in draw) / count)
    result["bootstrap"] = {
        "replicates": BOOTSTRAP_REPLICATES,
        "seed": BOOTSTRAP_SEED,
        "logloss_difference_95": _percentile_interval(log_stats),
        "brier_difference_95": _percentile_interval(brier_stats),
    }
    return result


def _percentile_interval(values: list[float]) -> list[float]:
    ordered = sorted(values)
    last = len(ordered) - 1

    def quantile(q: float) -> float:
        position = q * last
        lower = math.floor(position)
        upper = math.ceil(position)
        fraction = position - lower
        return ordered[lower] * (1 - fraction) + ordered[upper] * fraction

    return [round(quantile(0.025), 6), round(quantile(0.975), 6)]


def _segment(predictions: Sequence[GamePrediction], key: str) -> list[dict[str, Any]]:
    groups: dict[str, list[GamePrediction]] = defaultdict(list)
    for prediction in predictions:
        groups[getattr(prediction.sample, key)].append(prediction)
    rows = []
    for name in sorted(groups, key=lambda value: (-len(groups[value]), value)):
        rows.append({key: name, **summarize(groups[name])})
    return rows


def build_report(
    samples: Sequence[GameSample],
    result: WalkForwardResult,
    *,
    evaluation_start: datetime = EVALUATION_START,
) -> dict[str, Any]:
    evaluated = [prediction for prediction in result.predictions if prediction.evaluated]
    warmup = len(result.predictions) - len(evaluated)
    focus: dict[str, Any] = {}
    for league in FOCUS_LEAGUES:
        subset = [prediction for prediction in evaluated if prediction.sample.league == league]
        focus[league] = {**summarize(subset), "paired_daily": paired_daily_bootstrap(subset)}
    observed = [sample.observed_at for sample in samples]
    evaluated_times = [prediction.sample.observed_at for prediction in evaluated]
    return {
        "artifact_type": ARTIFACT_TYPE,
        "schema_version": SCHEMA_VERSION,
        "status": "EXPLORATORY_OFFLINE_EXPERIMENT",
        "frozen_parameters": FROZEN.to_dict(),
        "data_window": {
            "first_observed_at": min(observed).isoformat() if observed else None,
            "last_observed_at": max(observed).isoformat() if observed else None,
            "evaluation_start": evaluation_start.isoformat(),
            "first_evaluated_at": min(evaluated_times).isoformat() if evaluated_times else None,
            "last_evaluated_at": max(evaluated_times).isoformat() if evaluated_times else None,
            "eligible_games": len(samples),
            "warmup_games": warmup,
            "evaluated_games": len(evaluated),
            "labels_applied_by_end": result.labels_applied,
            "labels_pending_at_end": result.labels_pending_at_end,
            "teams_rated": len(result.final_ratings),
            "champions_weighted": len(result.final_weights),
        },
        "timing_note": (
            "Labels become usable in this simulation at observed_at + 24h (strictly before the "
            "predicted game's observed_at). The source available_at is the single bulk retrieval "
            "time of the file and is not a record of historical availability; it was not altered."
        ),
        "overall": {**summarize(evaluated), "paired_daily": paired_daily_bootstrap(evaluated)},
        "focus_leagues": focus,
        "by_league": _segment(evaluated, "league"),
        "by_patch": _segment(evaluated, "patch_id"),
    }


# ---- Archive run -----------------------------------------------------------------------------


def run_archive(csv_path: Path, meta_path: Path) -> dict[str, Any]:
    # Reuse the existing archive verification and the policy-gated adapter; nothing is disabled.
    from ops.build_player_season_history import verify_archive
    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    archive = verify_archive(csv_path, meta_path)
    if archive["content_hash"] != f"sha256:{APPROVED_HASH}":
        raise ValueError("CSV is not the approved archive snapshot")
    retrieved_at = archive["retrieved_at"]
    assert isinstance(retrieved_at, datetime)
    if retrieved_at != APPROVED_RETRIEVED_AT:
        raise ValueError("archive retrieval time differs from the approved snapshot")
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        csv_path, retrieved_at=retrieved_at, source_timezone="UTC", issue_detail_limit=0
    )
    if imported.report.content_hash != archive["content_hash"]:
        raise ValueError("adapter hash differs from archive metadata")
    samples, exclusions = prepare_samples(imported.matches, imported.draft_events)
    result = run_walk_forward(samples)
    report = build_report(samples, result)
    report["source"] = {
        "source_id": SOURCE_ID,
        "content_hash": imported.report.content_hash,
        "retrieved_at": retrieved_at.isoformat(),
        "byte_length": imported.report.byte_length,
        "note": (
            "Single approved local archive snapshot; games up to its retrieval time only. "
            "It does not include later games."
        ),
    }
    report["filters"] = {
        "csv_rows": imported.report.row_count,
        "adapter_discovered_games": imported.report.discovered_game_count,
        "adapter_imported_games": imported.report.imported_game_count,
        "adapter_rejected_games": imported.report.rejected_game_count,
        "adapter_rejection_counts": dict(imported.report.issue_counts),
        "experiment_exclusion_counts": exclusions,
        "eligible_games": len(samples),
    }
    return dict(sorted(report.items()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    report = run_archive(args.csv, args.meta)
    text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding="utf-8", newline="\n")
    overall = report["overall"]
    print(json.dumps({"output": str(args.output), "overall": overall}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
