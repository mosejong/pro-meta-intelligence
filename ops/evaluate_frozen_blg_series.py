"""Outcome-only replay: never rebuild or fit the pre-match scouting pack."""

import hashlib
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction
from pro_meta_intelligence.sources import SourceRegistry

ROOT = Path(__file__).resolve().parents[1]


def main():
    fetched = json.loads(
        (ROOT / "outputs/matchday-fetch-20261111.json").read_text(encoding="utf-8")
    )
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        Path(fetched["raw_data_path"]),
        retrieved_at=datetime.fromisoformat(fetched["retrieved_at"]),
        source_timezone="UTC",
    )
    pack_path = ROOT / "web/app/scouting/t1-vs-blg.json"
    raw = pack_path.read_bytes()
    pack = json.loads(raw)
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
    assert datetime.fromisoformat(pack["cutoff"]) < games[0].observed_at
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
    out = ROOT / "outputs/t1-blg-frozen-evaluation.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"totals": dict(total), "games": [row["hits"] for row in rows]}))


if __name__ == "__main__":
    main()
