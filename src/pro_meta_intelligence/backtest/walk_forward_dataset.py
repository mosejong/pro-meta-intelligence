"""Prepare a weekly walk-forward replay of first-set drafts from ONE pinned season capture.

Protocol: docs/benchmarks/DRAFT_RULE_WALK_FORWARD_PROTOCOL_2026-11-23.md (frozen before any run).

Unlike ``draft_dataset`` (which needs a physically earlier capture per target match and therefore
scores only a few dozen matches), this replays the whole season from a single capture with
**simulated availability**: every match/draft row is treated as known ``AVAILABILITY_LAG`` after
it was played. Target matches in week ``[W, W+7d)`` are scored against evidence built at cutoff
``W``, i.e. only rows played at or before ``W - AVAILABILITY_LAG``. This is a development replay,
not a claim about what a live system had at the time: late provider corrections to old rows are
visible. Every output carries that label.

Splits are assigned by the target match time and fixed in ``SPLITS``; the evaluator keeps the
HOLDOUT split sealed unless it is explicitly unsealed.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pro_meta_intelligence.backtest.draft_dataset import first_game_ids, ordered_draft
from pro_meta_intelligence.ingestion.oracles_elixir import SOURCE_ID, OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction
from pro_meta_intelligence.opponent.brief import OpponentPrepBuilder, OpponentPrepConfig
from pro_meta_intelligence.radar import LeagueRegionMap, MetaRadar, MetaRadarConfig
from pro_meta_intelligence.sources import SnapshotArchive, SourceRegistry

SCHEMA_VERSION = "1"
ARTIFACT_TYPE = "draft-walk-forward-dataset"
PROTOCOL_ID = "draft-rule-walk-forward-2026-11-23"
AVAILABILITY_LAG = timedelta(hours=24)
SEASON_START = datetime(2026, 1, 1, tzinfo=UTC)
SEASON_END = datetime(2027, 1, 1, tzinfo=UTC)
# Target-time split boundaries (inclusive start, exclusive end). Frozen by the protocol.
SPLITS = (
    ("DEV", SEASON_START, datetime(2026, 7, 1, tzinfo=UTC)),
    ("VALIDATION", datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 9, 1, tzinfo=UTC)),
    ("HOLDOUT", datetime(2026, 9, 1, tzinfo=UTC), SEASON_END),
)
# Windows whose matches were already inspected by earlier studies (reported separately in HOLDOUT).
INSPECTED_WINDOWS = (
    (
        "SEPTEMBER_2026_V2_REPLAY",
        datetime(2026, 9, 1, tzinfo=UTC),
        datetime(2026, 9, 16, tzinfo=UTC),
    ),
    (
        "NOVEMBER_2026_SOLO_RULE_DIAGNOSTIC",
        datetime(2026, 11, 4, 3, 3, 22, tzinfo=UTC),
        datetime(2026, 11, 11, 2, 19, 30, tzinfo=UTC),
    ),
)
MIN_SEASON_SHARE = 0.5  # separates the 2026 file from older annual files (share ~0)
FORBIDDEN_HASHES = frozenset(
    {"sha256:76b7cb8afc1c65c7e220053b1c5296c593e00c3a6dfaee4ef47373aa64b42a0a"}  # 2022 file
)
PRESENCE_LIMIT = 60
CLAIMS = (
    "SIMULATED_AVAILABILITY_NOT_LIVE_HISTORY",
    "SINGLE_CAPTURE_LATE_CORRECTIONS_VISIBLE",
    "FIRST_SET_ONLY_NO_FEARLESS_LOCKS",
    "CONCORDANCE_NOT_WIN_PREDICTION",
    "STATES_WITHIN_MATCH_CORRELATED",
)


def split_of(observed_at: datetime) -> str | None:
    for name, start, end in SPLITS:
        if start <= observed_at < end:
            return name
    return None


def inspected_window_of(observed_at: datetime) -> str | None:
    for name, start, end in INSPECTED_WINDOWS:
        if start <= observed_at < end:
            return name
    return None


def week_start(moment: datetime) -> datetime:
    """Monday 00:00 UTC of the week containing ``moment``."""
    day = moment.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return day - timedelta(days=day.weekday())


def simulate_availability(records, lag: timedelta = AVAILABILITY_LAG):
    """Treat each row as known ``lag`` after it was played (instead of at capture time)."""
    return tuple(replace(record, available_at=record.observed_at + lag) for record in records)


def season_share(matches) -> float:
    if not matches:
        return 0.0
    inside = sum(1 for match in matches if SEASON_START <= match.observed_at < SEASON_END)
    return inside / len(matches)


def select_outcome_capture(captures, adapter, outcome_hash: str | None):
    """Pinned hash, or the newest capture whose matches are (almost) all in the 2026 season."""
    candidates = sorted(
        captures, key=lambda item: (item.retrieved_at, item.content_hash), reverse=True
    )
    if outcome_hash is not None:
        candidates = [item for item in candidates if item.content_hash == outcome_hash]
        if not candidates:
            raise ValueError("pinned outcome capture is not in the archive")
    skipped = []
    for capture in candidates:
        if capture.content_hash in FORBIDDEN_HASHES:
            skipped.append({"content_hash": capture.content_hash, "reason": "FORBIDDEN"})
            continue
        imported = adapter.import_file(
            capture.data_path,
            retrieved_at=capture.retrieved_at,
            source_timezone="UTC",
            source_uri=capture.final_url,
        )
        share = season_share(imported.matches)
        if share >= MIN_SEASON_SHARE:
            return capture, imported, skipped
        skipped.append(
            {
                "content_hash": capture.content_hash,
                "reason": "NOT_2026_SEASON",
                "season_share": round(share, 4),
            }
        )
        if outcome_hash is not None:
            break
    raise ValueError("no 2026 season capture found in the archive")


def presence_table(matches, events, cutoff: datetime, patch_id: str) -> list[dict]:
    """Same-patch pick/ban counts known at ``cutoff`` (baseline input; never shown to the rules)."""
    known = {
        match.match_id
        for match in matches
        if match.patch_id == patch_id and match.available_at <= cutoff
    }
    picks: Counter = Counter()
    bans: Counter = Counter()
    for event in events:
        if event.match_id in known and event.available_at <= cutoff:
            (picks if event.action is DraftAction.PICK else bans)[event.champion_id] += 1
    champions = set(picks) | set(bans)
    ordered = sorted(
        champions, key=lambda champion: (-(picks[champion] + bans[champion]), champion)
    )
    return [
        {"champion_id": champion, "picks": picks[champion], "bans": bans[champion]}
        for champion in ordered[:PRESENCE_LIMIT]
    ]


def prepare_walk_forward(archive_root: Path, *, outcome_hash: str | None = None) -> dict:
    inspection = SnapshotArchive(archive_root).inspect(SOURCE_ID)
    if inspection.issues:
        raise ValueError("archive integrity check failed; repair the archive before evaluation")
    if not inspection.snapshots:
        raise ValueError("archive has no captures")
    adapter = OracleElixirCSVAdapter(SourceRegistry.load_default())
    capture, imported, skipped = select_outcome_capture(inspection.snapshots, adapter, outcome_hash)
    first_games = first_game_ids(capture.data_path)
    matches_all = simulate_availability(imported.matches)
    events_all = simulate_availability(imported.draft_events)
    by_match = defaultdict(list)
    for event in events_all:
        by_match[event.match_id].append(event)

    regions = LeagueRegionMap.load_default()
    exclusions: Counter = Counter()
    split_counts: dict[str, Counter] = defaultdict(Counter)
    snapshots: dict[str, dict] = {}
    failed_snapshots: set[str] = set()
    targets = []

    def exclude(reason: str, split: str | None) -> None:
        exclusions[reason] += 1
        split_counts[split or "OUT_OF_SEASON"][reason] += 1

    for match in sorted(matches_all, key=lambda item: (item.observed_at, item.match_id)):
        split = split_of(match.observed_at)
        if split is None:
            exclude("OUTSIDE_2026_SEASON", None)
            continue
        if match.match_id not in first_games:
            exclude("NOT_CONFIRMED_FIRST_SET", split)
            continue
        selections = ordered_draft(by_match[match.match_id])
        if selections is None:
            exclude("INCOMPLETE_OR_NONSTANDARD_DRAFT", split)
            continue
        cutoff = week_start(match.observed_at)
        snapshot_id = f"{cutoff.date().isoformat()}:{match.patch_id}"
        if snapshot_id in failed_snapshots:
            exclude("NO_SAME_PATCH_TRAINING", split)
            continue
        if snapshot_id not in snapshots:
            try:
                report = (
                    MetaRadar()
                    .build(
                        matches_all,
                        events_all,
                        MetaRadarConfig(cutoff=cutoff, patch_id=match.patch_id),
                        regions,
                    )
                    .to_dict()
                )
                report["opponent_prep"] = (
                    OpponentPrepBuilder()
                    .build(
                        matches_all,
                        events_all,
                        OpponentPrepConfig(cutoff=cutoff, patch_id=match.patch_id),
                    )
                    .to_dict()
                )
            except ValueError as error:
                if "no matches" not in str(error):
                    raise
                failed_snapshots.add(snapshot_id)
                exclude("NO_SAME_PATCH_TRAINING", split)
                continue
            snapshots[snapshot_id] = {
                "id": snapshot_id,
                "cutoff": cutoff.isoformat(),
                "evidence_played_at_or_before": (cutoff - AVAILABILITY_LAG).isoformat(),
                "patch_id": match.patch_id,
                "presence": presence_table(matches_all, events_all, cutoff, match.patch_id),
                "report": report,
            }
        teams = {
            team["team_id"] for team in snapshots[snapshot_id]["report"]["opponent_prep"]["teams"]
        }
        if not {match.blue_team_id, match.red_team_id} <= teams:
            exclude("TEAM_WITHOUT_PRIOR_SAME_PATCH_EVIDENCE", split)
            continue
        split_counts[split]["ELIGIBLE"] += 1
        targets.append(
            {
                "snapshot_id": snapshot_id,
                "split": split,
                "inspected_window": inspected_window_of(match.observed_at),
                "match_id": match.match_id,
                "game_number": 1,
                "first_pick_side": selections[0]["side"],
                "league": match.league,
                "patch_id": match.patch_id,
                "observed_at": match.observed_at.isoformat(),
                "blue_team_id": match.blue_team_id,
                "red_team_id": match.red_team_id,
                "selections": selections,
            }
        )

    # Drop snapshots that no eligible target uses (teams missing) to keep the file small.
    used = {target["snapshot_id"] for target in targets}
    return {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": ARTIFACT_TYPE,
        "protocol_id": PROTOCOL_ID,
        "fixture_only": False,
        "scope": "FIRST_SET_WALK_FORWARD_WEEKLY",
        "availability": {
            "mode": "SIMULATED_FROM_PLAYED_TIME",
            "lag_hours": AVAILABILITY_LAG.total_seconds() / 3600,
            "cutoff_rule": "Monday 00:00 UTC of the target match week",
        },
        "splits": [
            {"name": name, "start": start.isoformat(), "end": end.isoformat()}
            for name, start, end in SPLITS
        ],
        "inspected_windows": [
            {"name": name, "start": start.isoformat(), "end": end.isoformat()}
            for name, start, end in INSPECTED_WINDOWS
        ],
        "claims": list(CLAIMS),
        "outcome_source": {
            "content_hash": capture.content_hash,
            "retrieved_at": capture.retrieved_at.isoformat(),
            "skipped_captures": skipped,
        },
        "snapshots": [snapshot for key, snapshot in snapshots.items() if key in used],
        "matches": targets,
        "audit": {
            "verified_capture_count": len(inspection.snapshots),
            "outcome_imported_matches": len(imported.matches),
            "outcome_rejected_matches": imported.report.rejected_game_count,
            "eligible_matches": len(targets),
            "exclusions": dict(sorted(exclusions.items())),
            "by_split": {
                name: dict(sorted(counts.items())) for name, counts in sorted(split_counts.items())
            },
            "snapshot_count": len(used),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--outcome-hash", help="Pin the season capture (sha256:...). Default: newest 2026 capture."
    )
    args = parser.parse_args()
    dataset = prepare_walk_forward(args.archive, outcome_hash=args.outcome_hash)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(dataset, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )
    print(
        json.dumps(
            {"outcome_source": dataset["outcome_source"], **dataset["audit"]}, sort_keys=True
        )
    )


if __name__ == "__main__":
    main()
