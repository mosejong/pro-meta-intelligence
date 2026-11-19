"""Minimum observed win/loss baselines for 2026 pro matches (offline research only).

This tool answers one narrow question: what accuracy floor must any later model beat when it is
scored on real observed outcomes under a simulated 24h publication delay? It compares exactly
three fixed baselines -- a constant 0.5, a Laplace-smoothed blue-side rate, and a team-ID Elo --
using nothing but team IDs, sides, timestamps and winners. It does not read rosters, players,
champions, in-game stats, KDA or gold, does not tune anything per epoch, and has no UI effect.

Simulated availability: a target game at time ``t`` may only use outcomes of games whose
``observed_at + publication_delay <= t``. The adapter's real ``available_at`` is the retrieval
time of the local CSV; this experiment does NOT reproduce what was actually available back then.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pro_meta_intelligence.models import MatchRecord

REPO_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_OUTPUT_ROOT = REPO_ROOT / "web" / "public"
SOURCE_TIMEZONE = "UTC"
MODELS = ("fixed_half", "blue_laplace", "team_elo")
COHORTS = ("all_targets", "both_teams_min_prior_games")
CLAIMS = {
    "NO_UI_EFFECT": True,
    "NOT_CAUSAL_DRAFT_VALUE": True,
    "NOT_A_RELEASED_PREDICTOR": True,
}
_SHA256 = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True, slots=True)
class BaselineConfig:
    season_year: int = 2026
    leagues: frozenset[str] = field(
        default_factory=lambda: frozenset(
            {"LCK", "LPL", "LEC", "LCS", "LCP", "WLDs", "MSI", "FST", "EWC"}
        )
    )
    evaluation_start: datetime = datetime(2026, 7, 1, tzinfo=UTC)
    publication_delay: timedelta = timedelta(hours=24)
    elo_initial: float = 1500.0
    elo_k: float = 20.0
    elo_scale: float = 400.0
    mature_min_prior_games: int = 5
    logloss_epsilon: float = 1e-12

    def __post_init__(self) -> None:
        if self.evaluation_start.tzinfo is None or self.evaluation_start.utcoffset() is None:
            raise ValueError("evaluation_start must be timezone-aware")
        if self.publication_delay <= timedelta(0):
            raise ValueError("publication_delay must be positive so same-time games never leak")
        if not 0 < self.logloss_epsilon < 0.5:
            raise ValueError("logloss_epsilon must be in (0, 0.5)")

    def describe(self) -> dict:
        return {
            "season_year_by_observed_at_utc": self.season_year,
            "leagues": sorted(self.leagues),
            "evaluation_start": _iso(self.evaluation_start),
            "warmup": "in-scope games observed before evaluation_start (never scored)",
            "publication_delay_hours": self.publication_delay.total_seconds() / 3600,
            "elo": {"initial": self.elo_initial, "k": self.elo_k, "scale": self.elo_scale},
            "blue_laplace": "(published_blue_wins + 1) / (published_games + 2)",
            "mature_min_prior_games_per_team": self.mature_min_prior_games,
            "logloss_epsilon": self.logloss_epsilon,
            "join_key": "team_id only (team names are ignored)",
            "per_epoch_retuning": False,
        }


DEFAULT_CONFIG = BaselineConfig()


@dataclass(frozen=True, slots=True)
class Prediction:
    match_id: str
    league: str
    observed_at: datetime
    blue_won: int
    probabilities: Mapping[str, float]
    blue_prior_games: int
    red_prior_games: int
    mature: bool


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _aware(value: object) -> bool:
    return (
        isinstance(value, datetime) and value.tzinfo is not None and value.utcoffset() is not None
    )


def _hash_hex(value: str) -> str | None:
    normalized = value.removeprefix("sha256:")
    return normalized if _SHA256.fullmatch(normalized) else None


def _record_issue(record: MatchRecord, expected_hash: str | None) -> str | None:
    if not _aware(record.observed_at) or not _aware(record.available_at):
        return "naive_timestamp"
    if record.available_at < record.observed_at:
        return "available_before_observed"
    if not (record.match_id and record.blue_team_id and record.red_team_id):
        return "blank_identifier"
    if record.blue_team_id == record.red_team_id:
        return "same_team_both_sides"
    if record.winner_team_id not in (record.blue_team_id, record.red_team_id):
        return "winner_not_participant"
    if expected_hash is not None:
        digest = _hash_hex(expected_hash)
        if digest is None or _hash_hex(record.provenance.content_hash) != digest:
            return "provenance_hash_mismatch"
    return None


def clean_records(
    records: Iterable[MatchRecord],
    config: BaselineConfig = DEFAULT_CONFIG,
    *,
    expected_hash: str | None = None,
) -> tuple[tuple[MatchRecord, ...], dict[str, int]]:
    """Deduplicate, validate and scope records without mutating the input.

    A match ID that appears with differing content is excluded entirely (every copy); an exact
    duplicate is kept once. Returned records are sorted by (observed_at, match_id).
    """
    reasons: Counter[str] = Counter()
    by_id: dict[str, list[MatchRecord]] = defaultdict(list)
    for record in records:
        by_id[record.match_id].append(record)

    survivors: list[MatchRecord] = []
    for copies in by_id.values():
        first = copies[0]
        if any(copy != first for copy in copies[1:]):
            reasons["conflicting_duplicate_id_records"] += len(copies)
            reasons["conflicting_duplicate_ids"] += 1
            continue
        if len(copies) > 1:
            reasons["exact_duplicate_records_collapsed"] += len(copies) - 1
        issue = _record_issue(first, expected_hash)
        if issue is not None:
            reasons[issue] += 1
            continue
        if first.observed_at.astimezone(UTC).year != config.season_year:
            reasons["out_of_season"] += 1
            continue
        if first.league not in config.leagues:
            reasons["league_out_of_scope"] += 1
            continue
        survivors.append(first)

    survivors.sort(key=lambda r: (r.observed_at.astimezone(UTC), r.match_id))
    return tuple(survivors), dict(sorted(reasons.items()))


def elo_expected(blue_rating: float, red_rating: float, scale: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((red_rating - blue_rating) / scale))


def simulate(
    games: Sequence[MatchRecord], config: BaselineConfig = DEFAULT_CONFIG
) -> tuple[Prediction, ...]:
    """Walk the cleaned timeline and emit predictions for evaluation-window games only.

    Every in-scope game (warmup included) gets an Elo expectation frozen at its own observed_at.
    When its result becomes public (observed_at + delay), ratings move by K * (y - frozen_p).
    A game's own winner is read only when its result is published or as its scoring label.
    """
    ordered = sorted(games, key=lambda r: (r.observed_at.astimezone(UTC), r.match_id))
    ratings: dict[str, float] = defaultdict(lambda: config.elo_initial)
    team_games: Counter[str] = Counter()
    frozen_p: dict[str, float] = {}
    published_games = 0
    published_blue_wins = 0
    cursor = 0
    predictions: list[Prediction] = []

    index = 0
    while index < len(ordered):
        now = ordered[index].observed_at.astimezone(UTC)
        group_end = index
        while group_end < len(ordered) and ordered[group_end].observed_at.astimezone(UTC) == now:
            group_end += 1

        while cursor < len(ordered):
            done = ordered[cursor]
            if done.observed_at.astimezone(UTC) + config.publication_delay > now:
                break
            assert done.observed_at.astimezone(UTC) < now, "same-time result must never leak"
            y = 1 if done.winner_team_id == done.blue_team_id else 0
            delta = config.elo_k * (y - frozen_p[done.match_id])
            ratings[done.blue_team_id] += delta
            ratings[done.red_team_id] -= delta
            team_games[done.blue_team_id] += 1
            team_games[done.red_team_id] += 1
            published_games += 1
            published_blue_wins += y
            cursor += 1

        for game in ordered[index:group_end]:
            p_elo = elo_expected(
                ratings[game.blue_team_id], ratings[game.red_team_id], config.elo_scale
            )
            frozen_p[game.match_id] = p_elo
            if now < config.evaluation_start:
                continue
            blue_prior = team_games[game.blue_team_id]
            red_prior = team_games[game.red_team_id]
            probabilities = {
                "fixed_half": 0.5,
                "blue_laplace": (published_blue_wins + 1) / (published_games + 2),
                "team_elo": p_elo,
            }
            for value in probabilities.values():
                _require_probability(value)
            predictions.append(
                Prediction(
                    match_id=game.match_id,
                    league=game.league,
                    observed_at=now,
                    blue_won=1 if game.winner_team_id == game.blue_team_id else 0,
                    probabilities=probabilities,
                    blue_prior_games=blue_prior,
                    red_prior_games=red_prior,
                    mature=min(blue_prior, red_prior) >= config.mature_min_prior_games,
                )
            )
        index = group_end
    return tuple(predictions)


def _require_probability(value: float) -> None:
    if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise ValueError(f"probability must be finite and within [0, 1]: {value!r}")


def score(pairs: Sequence[tuple[float, int]], epsilon: float = 1e-12) -> dict:
    """Brier, clamped log loss and half-credit accuracy for (probability, label) pairs."""
    n = len(pairs)
    if n == 0:
        return {
            "n": 0,
            "brier": None,
            "logloss": None,
            "accuracy_with_half_credit_ties": None,
            "tie_count": 0,
        }
    brier = logloss = accuracy = 0.0
    ties = 0
    for p, y in pairs:
        _require_probability(p)
        if y not in (0, 1):
            raise ValueError("label must be 0 or 1")
        brier += (p - y) ** 2
        clamped = min(max(p, epsilon), 1.0 - epsilon)
        logloss -= math.log(clamped) if y else math.log(1.0 - clamped)
        if p == 0.5:
            ties += 1
            accuracy += 0.5
        elif (p > 0.5) == bool(y):
            accuracy += 1.0
    return {
        "n": n,
        "brier": round(brier / n, 6),
        "logloss": round(logloss / n, 6),
        "accuracy_with_half_credit_ties": round(accuracy / n, 6),
        "tie_count": ties,
    }


def summarize(predictions: Sequence[Prediction], config: BaselineConfig = DEFAULT_CONFIG) -> dict:
    cohorts: dict[str, list[Prediction]] = {
        "all_targets": list(predictions),
        "both_teams_min_prior_games": [p for p in predictions if p.mature],
    }
    out: dict = {}
    for cohort, members in cohorts.items():
        leagues = sorted({p.league for p in members})
        entry = {
            "sample_size": len(members),
            "overall": {
                model: score(
                    [(p.probabilities[model], p.blue_won) for p in members], config.logloss_epsilon
                )
                for model in MODELS
            },
            "by_league": {},
        }
        for league in leagues:
            subset = [p for p in members if p.league == league]
            entry["by_league"][league] = {
                "sample_size": len(subset),
                **{
                    model: score(
                        [(p.probabilities[model], p.blue_won) for p in subset],
                        config.logloss_epsilon,
                    )
                    for model in MODELS
                },
            }
        out[cohort] = entry
    return out


def assess(
    records: Iterable[MatchRecord],
    config: BaselineConfig = DEFAULT_CONFIG,
    *,
    expected_hash: str | None = None,
) -> dict:
    games, reasons = clean_records(records, config, expected_hash=expected_hash)
    predictions = simulate(games, config)
    warmup = sum(1 for g in games if g.observed_at.astimezone(UTC) < config.evaluation_start)
    window = (
        {
            "first_target_observed_at": _iso(predictions[0].observed_at),
            "last_target_observed_at": _iso(predictions[-1].observed_at),
        }
        if predictions
        else {"first_target_observed_at": None, "last_target_observed_at": None}
    )
    return {
        "status": "EVALUATED" if predictions else "NO_EVALUATION_TARGETS",
        "config": config.describe(),
        "in_scope_games": len(games),
        "warmup_games": warmup,
        "target_games": len(predictions),
        "evaluation_window": window,
        "exclusion_reasons": reasons,
        "cohorts": summarize(predictions, config),
    }


def validate_output_path(output: Path) -> Path:
    resolved = output.resolve()
    if resolved.is_relative_to(FORBIDDEN_OUTPUT_ROOT.resolve()):
        raise ValueError("refusing to write research output inside web/public")
    parts = [part.lower() for part in resolved.parts]
    if any(a == "web" and b == "public" for a, b in zip(parts, parts[1:], strict=False)):
        raise ValueError("refusing to write research output inside a web/public directory")
    if resolved.suffix.lower() != ".json":
        raise ValueError("output must be a .json report")
    if resolved.exists():
        raise ValueError("output already exists; choose a new path to preserve prior reports")
    return resolved


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True, help="ISO-8601 with timezone")
    parser.add_argument("--content-hash", required=True, help="expected sha256 hex of --input")
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    expected = args.content_hash.strip().lower()
    if not _SHA256.fullmatch(expected):
        raise SystemExit("--content-hash must be a 64-character sha256 hex digest")
    retrieved_at = datetime.fromisoformat(args.retrieved_at.replace("Z", "+00:00"))
    if not _aware(retrieved_at):
        raise SystemExit("--retrieved-at must include a timezone")
    try:
        output = validate_output_path(args.output)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    source = args.input.resolve(strict=True)
    actual = _sha256(source)
    if actual != expected:
        raise SystemExit("input sha256 does not match --content-hash; refusing to run")

    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        source, retrieved_at=retrieved_at, source_timezone=SOURCE_TIMEZONE
    )
    if _hash_hex(imported.report.content_hash) != expected:
        raise SystemExit("adapter content hash differs from the verified sha256; refusing to run")

    result = assess(imported.matches, expected_hash=expected)
    report = {
        "kind": "match_baseline_research",
        "claims": CLAIMS,
        "source": {
            "source_hash_sha256": expected,
            "retrieved_at": _iso(retrieved_at),
            "source_timezone": SOURCE_TIMEZONE,
            "adapter_imported_games": imported.report.imported_game_count,
            "adapter_rejected_games": imported.report.rejected_game_count,
            "adapter_issue_counts": dict(imported.report.issue_counts),
        },
        "availability_assumption": (
            "Simulated: a target at t uses only results with observed_at + delay <= t. The "
            "adapter's available_at equals the local retrieval time; this run does not "
            "reproduce what was actually public at the time."
        ),
        **result,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({"output": str(output), "target_games": result["target_games"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
