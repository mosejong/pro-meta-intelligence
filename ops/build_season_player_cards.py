"""Build compact season cards offline from policy-gated, verified career archives."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from ops.player_career_archive import DEFAULT_ARCHIVE, ROOT, build_archive_history, inspect_plan
from pro_meta_intelligence.ingestion.oe_download import archive_for_year

DEFAULT_FEED = ROOT / "web/public/feed/current.json"
DEFAULT_OUTPUT = ROOT / "web/public/history/season-player-cards.json"
NUGURI_ID = "oe:player:f17b90d1dd0f1814bb1f82f77c2f861"
LEAGUES = {"LCK", "LPL", "LEC", "LCS", "MSI", "WLDs"}
ROLES = {"top": "TOP", "jng": "JUNGLE", "mid": "MID", "bot": "BOTTOM", "sup": "SUPPORT"}
MAX_OUTPUT_BYTES = 3_000_000


def canonical_json(value: object) -> bytes:
    """Canonical UTF-8 JSON: sorted keys, compact separators, literal Unicode."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def transform_career_history(career: dict) -> dict:
    """Transform validated career aggregates, including the reference season."""
    cutoff = datetime.fromisoformat(career["cutoff"])
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        raise ValueError("cutoff must be timezone aware")
    sources = career["sources"]
    loaded = {source["season"] for source in sources}
    cards = []
    for player in career["players"]:
        for season in player["seasons"]:
            if season["status"] != "OBSERVED":
                continue
            for chapter in season["chapters"]:
                identity = [
                    player["source_id"],
                    player["player_id"],
                    season["season"],
                    chapter["team_id"],
                    ROLES[chapter["role"]],
                ]
                cards.append(
                    {
                        "id": hashlib.sha256(canonical_json(identity)).hexdigest(),
                        "source_id": player["source_id"],
                        "player_id": player["player_id"],
                        "player_name": player["observed_names"][0],
                        "season": season["season"],
                        "team_id": chapter["team_id"],
                        "team_names": sorted(chapter["team_names"]),
                        "role": ROLES[chapter["role"]],
                        "game_count": chapter["games"],
                        "champions": [
                            {"champion_id": champion, "games": games}
                            for champion, games in sorted(chapter["champion_counts"].items())
                        ],
                        "patches": sorted(chapter["patches"]),
                        "source_hashes": sorted(
                            {
                                source["content_hash"]
                                for source in sources
                                if source["season"] == season["season"]
                            }
                        ),
                    }
                )
    cards.sort(
        key=lambda card: (
            card["source_id"],
            card["player_id"],
            card["season"],
            card["team_id"],
            card["role"],
        )
    )
    return {
        "artifact_type": "season-player-cards",
        "schema_version": 1,
        "cutoff": career["cutoff"],
        "catalog_id": hashlib.sha256(canonical_json(cards)).hexdigest(),
        "seasons": [
            {"season": year, "status": "LOADED" if year in loaded else "NOT_LOADED"}
            for year in range(2014, 2027)
        ],
        "sources": sources,
        "cards": cards,
    }


def discover_candidate_ids(
    feed: dict, archive_dir: Path, *, cutoff: datetime, candidate_years: tuple[int, ...] = (2022,)
) -> tuple[str, ...]:
    """Discover identities only; all appearance counts come from the career builder."""
    if not candidate_years or any(
        type(year) is not int or not 2014 <= year <= 2026 for year in candidate_years
    ):
        raise ValueError("candidate years must be between 2014 and 2026")
    ids = {NUGURI_ID}

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "player_profiles":
                    profiles = child.values() if isinstance(child, dict) else child
                    ids.update(profile["player_id"] for profile in profiles)
                else:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(feed["opponent_prep"])
    _, inspection = inspect_plan(archive_dir, now=cutoff)
    for year in sorted(set(candidate_years)):
        for snapshot in archive_for_year(inspection, year).snapshots:
            if snapshot.retrieved_at > cutoff:
                continue
            with snapshot.data_path.open(encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    if (
                        row.get("year") == str(year)
                        and row.get("league") in LEAGUES
                        and row.get("position") in ROLES
                        and row.get("playerid")
                    ):
                        ids.add(row["playerid"])
    return tuple(sorted(ids))


def build(
    archive_dir: Path, feed_path: Path, output: Path, *, candidate_years: tuple[int, ...] = (2022,)
) -> dict:
    cutoff = datetime.now(UTC)
    feed = json.loads(feed_path.read_text(encoding="utf-8"))
    ids = discover_candidate_ids(feed, archive_dir, cutoff=cutoff, candidate_years=candidate_years)
    career = build_archive_history(
        archive_dir,
        player_ids=ids,
        cutoff=cutoff,
        reference_season=2026,
        reference_patch=feed["opponent_prep"]["patch_id"],
    )
    catalog = transform_career_history(career)
    payload = canonical_json(catalog) + b"\n"
    if len(payload) > MAX_OUTPUT_BYTES:
        raise ValueError("season cards exceed the 3MB public budget")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".season-cards-", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {
        "output": str(output),
        "bytes": len(payload),
        "candidates": len(ids),
        "cards": len(catalog["cards"]),
        "coverage": career["coverage"],
        "sources": catalog["sources"],
        "seasons": catalog["seasons"],
        "nuguri_games": sum(
            card["game_count"] for card in catalog["cards"] if card["player_id"] == NUGURI_ID
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--feed", type=Path, default=DEFAULT_FEED)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--candidate-season",
        type=int,
        action="append",
        choices=range(2014, 2027),
        help=(
            "Discover stable player IDs from this archived season "
            "(repeatable; default 2022). No collection."
        ),
    )
    args = parser.parse_args()
    print(
        json.dumps(
            build(
                args.archive_dir,
                args.feed,
                args.output,
                candidate_years=tuple(args.candidate_season or (2022,)),
            ),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
