"""Prepare first-set draft holdouts from verified, time-separated local OE captures."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import SOURCE_ID, OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction, PickBanEvent
from pro_meta_intelligence.opponent.brief import OpponentPrepBuilder, OpponentPrepConfig
from pro_meta_intelligence.radar import LeagueRegionMap, MetaRadar, MetaRadarConfig
from pro_meta_intelligence.sources import SnapshotArchive, SourceRegistry

PICK_TURNS = dict(enumerate((7, 8, 9, 10, 11, 12, 17, 18, 19, 20), 1))
BAN_TURNS = dict(enumerate((1, 2, 3, 4, 5, 6, 13, 14, 15, 16), 1))
BLUE_TURNS = {1, 3, 5, 7, 10, 11, 14, 16, 18, 19}


def ordered_draft(events: list[PickBanEvent]) -> list[dict] | None:
    """OE sequences picks and bans separately; never interpret role order as pick order."""
    if len(events) != 20:
        return None
    first_picks = [
        event for event in events if event.action is DraftAction.PICK and event.sequence == 1
    ]
    if len(first_picks) != 1:
        return None
    first_side = first_picks[0].side.value
    ordered = {}
    for event in events:
        mapping = PICK_TURNS if event.action is DraftAction.PICK else BAN_TURNS
        turn = mapping.get(event.sequence)
        if turn is None or turn in ordered:
            return None
        expected_side = (
            first_side if turn in BLUE_TURNS else ("RED" if first_side == "BLUE" else "BLUE")
        )
        if event.side.value != expected_side:
            return None
        ordered[turn] = event
    counters: Counter = Counter()
    result = []
    for turn, event in sorted(ordered.items()):
        key = (event.side.value, event.action.value)
        counters[key] += 1
        result.append(
            {
                "turn": turn,
                "side": key[0],
                "kind": key[1],
                "slot": counters[key],
                "phase": 1 if turn <= 12 else 2,
                "champion_id": event.champion_id,
            }
        )
    return result


def first_game_ids(path: Path) -> set[str]:
    """Require every provider row to identify game 1, without guessing series grouping."""
    numbers: dict[str, set[str]] = defaultdict(set)
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            key = f"oe:{row['league'].strip()}:{row['gameid'].strip()}"
            numbers[key].add(row["game"].strip())
    return {key for key, values in numbers.items() if values == {"1"}}


def prepare_dataset(archive_root: Path, *, observed_after: datetime | None = None) -> dict:
    if observed_after is not None and observed_after.utcoffset() is None:
        raise ValueError("observed_after must include a timezone")
    inspection = SnapshotArchive(archive_root).inspect(SOURCE_ID)
    if inspection.issues:
        raise ValueError("archive integrity check failed; repair the archive before evaluation")
    captures = sorted(inspection.snapshots, key=lambda item: (item.retrieved_at, item.content_hash))
    if len(captures) < 2:
        raise ValueError(
            "at least two verified captures are required; do not backdate availability"
        )
    if len({item.retrieved_at for item in captures}) != len(captures):
        raise ValueError("ambiguous simultaneous captures")
    adapter = OracleElixirCSVAdapter(SourceRegistry.load_default())
    imports = [
        adapter.import_file(
            item.data_path,
            retrieved_at=item.retrieved_at,
            source_timezone="UTC",
            source_uri=item.final_url,
        )
        for item in captures
    ]
    outcome_capture, outcome = captures[-1], imports[-1]
    first_games = first_game_ids(outcome_capture.data_path)
    by_match: dict[str, list[PickBanEvent]] = defaultdict(list)
    for event in outcome.draft_events:
        by_match[event.match_id].append(event)
    exclusions: Counter = Counter()
    coverage = {}

    def exclude(reason, groups):
        exclusions[reason] += 1
        for group in groups:
            group["exclusions"][reason] += 1

    snapshots = {}
    matches = []
    regions = LeagueRegionMap.load_default()
    for match in sorted(outcome.matches, key=lambda item: (item.observed_at, item.match_id)):
        labels = [f"LEAGUE:{match.league}"]
        if "T1" in {match.blue_team_name, match.red_team_name}:
            labels.append("TEAM:T1")
        groups = []
        for label in labels:
            group = coverage.setdefault(
                label,
                {
                    "imported_matches": 0,
                    "eligible_matches": 0,
                    "exclusions": Counter(),
                    "first_observed_at": match.observed_at.isoformat(),
                    "last_observed_at": match.observed_at.isoformat(),
                },
            )
            group["imported_matches"] += 1
            group["last_observed_at"] = match.observed_at.isoformat()
            groups.append(group)
        if observed_after is not None and match.observed_at <= observed_after:
            exclude("BEFORE_OR_AT_HOLDOUT_BOUNDARY", groups)
            continue
        if match.match_id not in first_games:
            exclude("NOT_CONFIRMED_FIRST_SET", groups)
            continue
        prior = [
            index
            for index, item in enumerate(captures[:-1])
            if item.retrieved_at < match.observed_at
        ]
        if not prior:
            exclude("NO_EARLIER_CAPTURE", groups)
            continue
        index = prior[-1]
        capture, imported = captures[index], imports[index]
        if capture.content_hash == outcome_capture.content_hash:
            exclude("NO_DISTINCT_OUTCOME_SOURCE", groups)
            continue
        if any(item.match_id == match.match_id for item in imported.matches):
            raise ValueError("target match is already present in the candidate source")
        selections = ordered_draft(by_match[match.match_id])
        if selections is None:
            exclude("INCOMPLETE_OR_NONSTANDARD_DRAFT", groups)
            continue
        snapshot_id = f"{capture.content_hash}:{match.patch_id}"
        if snapshot_id not in snapshots:
            try:
                report = (
                    MetaRadar()
                    .build(
                        imported.matches,
                        imported.draft_events,
                        MetaRadarConfig(cutoff=capture.retrieved_at, patch_id=match.patch_id),
                        regions,
                    )
                    .to_dict()
                )
                report["opponent_prep"] = (
                    OpponentPrepBuilder()
                    .build(
                        imported.matches,
                        imported.draft_events,
                        OpponentPrepConfig(cutoff=capture.retrieved_at, patch_id=match.patch_id),
                    )
                    .to_dict()
                )
            except ValueError as error:
                if "patch" not in str(error) or "no matches" not in str(error):
                    raise
                exclude("NO_SAME_PATCH_TRAINING", groups)
                continue
            snapshots[snapshot_id] = {
                "id": snapshot_id,
                "cutoff": capture.retrieved_at.isoformat(),
                "source_hash": capture.content_hash,
                "report": report,
            }
        teams = {
            team["team_id"] for team in snapshots[snapshot_id]["report"]["opponent_prep"]["teams"]
        }
        if not {match.blue_team_id, match.red_team_id} <= teams:
            exclude("TEAM_WITHOUT_PRIOR_SAME_PATCH_EVIDENCE", groups)
            continue
        for group in groups:
            group["eligible_matches"] += 1
        matches.append(
            {
                "snapshot_id": snapshot_id,
                "match_id": match.match_id,
                "game_number": 1,
                "first_pick_side": selections[0]["side"],
                "league": match.league,
                "patch_id": match.patch_id,
                "observed_at": match.observed_at.isoformat(),
                "outcome_retrieved_at": outcome_capture.retrieved_at.isoformat(),
                "outcome_source_hash": outcome_capture.content_hash,
                "blue_team_id": match.blue_team_id,
                "red_team_id": match.red_team_id,
                "selections": selections,
            }
        )
    return {
        "schema_version": "1",
        "artifact_type": "draft-historical-dataset",
        "fixture_only": False,
        "scope": "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
        "snapshots": list(snapshots.values()),
        "matches": matches,
        "audit": {
            "verified_capture_count": len(captures),
            "observed_after": observed_after.isoformat() if observed_after else None,
            "outcome_imported_matches": len(outcome.matches),
            "outcome_rejected_matches": outcome.report.rejected_game_count,
            "eligible_matches": len(matches),
            "exclusions": dict(sorted(exclusions.items())),
            "coverage": {
                label: {**group, "exclusions": dict(sorted(group["exclusions"].items()))}
                for label, group in sorted(coverage.items())
            },
            "first_capture_at": captures[0].retrieved_at.isoformat(),
            "last_capture_at": outcome_capture.retrieved_at.isoformat(),
        },
        "boundary": "Local normalized evaluation inputs only. No inferred series grouping or "
        "backdated availability; later sets and counterfactual choices are not evaluated.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--observed-after", type=datetime.fromisoformat)
    args = parser.parse_args()
    dataset = prepare_dataset(args.archive, observed_after=args.observed_after)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(dataset, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )
    print(json.dumps(dataset["audit"], sort_keys=True))


if __name__ == "__main__":
    main()
