"""Outcome-only replay: never rebuild or fit the pre-match scouting pack.

The pre-match pack is an explicit, hash-pinned input. The current web pack is never used
implicitly, because a refreshed pack contains the very games being scored.
"""

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction
from pro_meta_intelligence.sources import SourceRegistry

ROOT = Path(__file__).resolve().parents[1]


def load_frozen_pack(path: Path, expected_sha256: str) -> tuple[bytes, dict]:
    raw = path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected_sha256.lower():
        raise ValueError(f"frozen pack hash mismatch: {actual}")
    return raw, json.loads(raw)


def require_pre_match(pack: dict, first_game_at: datetime) -> None:
    if datetime.fromisoformat(pack["cutoff"]) >= first_game_at:
        raise ValueError("pack cutoff is not before the first scored game; not a pre-match pack")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frozen-pack", type=Path, required=True, help="pre-match BLG pack")
    parser.add_argument("--pack-sha256", required=True, help="hash recorded when it was frozen")
    parser.add_argument(
        "--fetch-record", type=Path, default=ROOT / "outputs/matchday-fetch-20261111.json"
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if args.output.exists():
        raise SystemExit("output exists; evaluation results are not overwritten")
    raw, pack = load_frozen_pack(args.frozen_pack, args.pack_sha256)
    fetched = json.loads(args.fetch_record.read_text(encoding="utf-8"))
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        Path(fetched["raw_data_path"]),
        retrieved_at=datetime.fromisoformat(fetched["retrieved_at"]),
        source_timezone="UTC",
    )
    games = sorted(
        [
            m
            for m in imported.matches
            if {m.blue_team_name, m.red_team_name} == {"T1", "Bilibili Gaming"}
            and "2026-11-08T22:00:00" <= m.observed_at.isoformat() < "2026-11-09T10:00:00"
        ],
        key=lambda m: (m.observed_at, m.match_id),
    )
    assert len(games) == 4, f"Expected four provider games, found {len(games)}"
    require_pre_match(pack, games[0].observed_at)
    events = defaultdict(list)
    for event in imported.draft_events:
        events[event.match_id].append(event)
    expected = {g["role"]: g["champions"] for g in pack["levers"]["expected_picks"]}
    meta = next(g for g in pack["league_meta"] if g["group"] == "INTERNATIONAL")
    pools = {g["role"]: g["champions"] for g in pack["target"]["player_pools"]}
    season = {g["role"]: g for g in pack["target"].get("season_tendencies", [])}
    locked = set()
    rows = []
    total = defaultdict(int)
    for index, game in enumerate(games, 1):
        tid = game.blue_team_id if game.blue_team_name == "Bilibili Gaming" else game.red_team_id
        all_events = events[game.match_id]
        mine = [e for e in all_events if e.team_id == tid]
        picks = sorted([e for e in mine if e.action is DraftAction.PICK], key=lambda e: e.sequence)
        assert len(picks) == 5
        assert not locked.intersection(
            e.champion_id for e in all_events if e.action is DraftAction.PICK
        )

        def available(items):
            return [c["champion_id"] for c in items if c["champion_id"] not in locked][:6]

        details = []
        counts = defaultdict(int)
        for pick in picks:
            candidates = available(expected[pick.role])
            role_meta = available(meta["role_picks"][pick.role])
            player_pool = available(pools[pick.role])
            observed = season.get(pick.role, {})
            season_pick = next(
                (c for c in observed.get("champions", []) if c["champion_id"] == pick.champion_id),
                None,
            )
            counts["expected"] += pick.champion_id in candidates
            counts["role_meta"] += pick.champion_id in role_meta
            counts["player_pool"] += pick.champion_id in player_pool
            counts["top_one"] += bool(candidates and pick.champion_id == candidates[0])
            details.append(
                {
                    "role": pick.role,
                    "player": pick.player_name,
                    "actual": pick.champion_id,
                    "candidates": candidates,
                    "hit": pick.champion_id in candidates,
                    "prior_season_games": season_pick["season_games"] if season_pick else 0,
                    "player_id_matches": observed.get("player_id") == pick.player_id,
                }
            )
        bans = [e.champion_id for e in mine if e.action is DraftAction.BAN and e.sequence <= 6]
        assert len(bans) == 3
        ban_candidates = available(pack["levers"]["expected_phase_one_bans"])
        counts["phase_one_bans"] = sum(c in ban_candidates for c in bans)
        deny = available(pack["levers"]["deny_comfort"])
        counts["deny_hits_game"] = int(any(e.champion_id in deny for e in picks))
        for k, v in counts.items():
            total[k] += v
        rows.append(
            {
                "game": index,
                "match_id": game.match_id,
                "T1_won": game.winner_team_id != tid,
                "BLG_phase_one_bans": bans,
                "ban_candidates": ban_candidates,
                "hits": dict(counts),
                "picks": details,
            }
        )
        locked.update(e.champion_id for e in all_events if e.action is DraftAction.PICK)
    report = {
        "artifact_type": "frozen-pack-series-evaluation",
        "provider_source_hash": fetched["content_hash"],
        "pack_path": args.frozen_pack.as_posix(),
        "pack_sha256": hashlib.sha256(raw).hexdigest(),
        "pack_cutoff": pack["cutoff"],
        "games": rows,
        "totals": dict(total),
        "denominators": {
            "expected": 20,
            "role_meta": 20,
            "player_pool": 20,
            "top_one": 20,
            "phase_one_bans": 12,
            "deny_hits_game": 4,
        },
        "boundary": "Frozen pre-series top-six role coverage. Prior-series picks removed; "
        "current-game bans not used. No outcome fitting or causal draft-win claim. "
        "The frozen pack predates the T1 and BLG quarterfinals.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"totals": dict(total), "games": [row["hits"] for row in rows]}))


if __name__ == "__main__":
    main()
