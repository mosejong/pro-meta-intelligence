"""Provisional post-match replay of a frozen pre-match pack; no fitting or refresh."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "web/app/scouting/t1-vs-kc.json"
ROLES = ("TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT")
# Secondary-source transcriptions, role order above. Not an official/provider-validated feed.
# https://pem.lol/worlds/2026/matches/karmine-corp-vs-t1-2026-11-06?game=1 (through 4)
# Role assignments cross-checked against https://lolgrade.com/matches/90000093;
# that site's win labels conflict with its series score and are deliberately not used.
GAMES = [
    (["Rumble", "Lee Sin", "Syndra", "Ezreal", "Leona"],
     ["Ornn", "Jarvan IV", "Viktor", "Yunara", "Lulu"],
     ["Nocturne", "Renata Glasc", "Galio"]),
    (["Ambessa", "Pantheon", "Orianna", "Tristana", "Rell"],
     ["Olaf", "Trundle", "Cassiopeia", "Kai'Sa", "Nautilus"],
     ["Vi", "Qiyana", "Nocturne"]),
    (["K'Sante", "Xin Zhao", "Anivia", "Ashe", "Seraphine"],
     ["Jayce", "Sejuani", "Taliyah", "Zeri", "Yuumi"],
     ["Vi", "Qiyana", "Nocturne"]),
    (["Renekton", "Wukong", "Ahri", "Xayah", "Rakan"],
     ["Camille", "Nocturne", "Annie", "Miss Fortune", "Neeko"],
     ["Vi", "Qiyana", "Caitlyn"]),
]


def main():
    raw = PACK.read_bytes()
    pack = json.loads(raw)
    assert pack["cutoff"] < "2026-11-06T22:00:00", "Pack must predate series"
    groups = pack["levers"]["expected_picks"]
    pools = {g["role"]: [c["champion_id"] for c in g["champions"]]
             for g in pack["target"]["player_pools"]}
    meta = next(g for g in pack["league_meta"] if g["group"] == "INTERNATIONAL")
    locked = set()
    rows = []
    totals = dict.fromkeys(("expected", "role_meta", "raw_pool", "bans"), 0)
    for number, (kc, t1, bans) in enumerate(GAMES, 1):
        assert len(set(kc + t1)) == 10
        assert not locked.intersection(kc + t1), "Illegal Fearless reuse"
        available = lambda xs: [c for c in xs if c not in locked][:6]
        hits = {k: [] for k in ("expected", "role_meta", "raw_pool")}
        details = []
        for role, actual in zip(ROLES, kc, strict=True):
            group = next(g for g in groups if g["role"] == role)
            candidates = available([c["champion_id"] for c in group["champions"]])
            role_candidates = available([c["champion_id"] for c in meta["role_picks"][role]])
            hits["expected"].append(actual in candidates)
            hits["role_meta"].append(actual in role_candidates)
            hits["raw_pool"].append(actual in available(pools[role]))
            details.append(dict(role=role, actual=actual, candidates=candidates,
                                hit=actual in candidates))
        ban_candidates = available([c["champion_id"] for c in
                                    pack["levers"]["expected_phase_one_bans"]])
        counts = {k: sum(v) for k, v in hits.items()}
        counts["bans"] = sum(c in ban_candidates for c in bans)
        for k, v in counts.items():
            totals[k] += v
        rows.append(dict(game=number, hits=counts, picks=details,
                         actual_phase_one_bans=bans, ban_candidates=ban_candidates))
        locked.update(kc + t1)
    report = dict(status="PROVISIONAL_SECONDARY_SOURCE", pack_cutoff=pack["cutoff"],
                  pack_sha256=hashlib.sha256(raw).hexdigest(), games=rows, totals=totals,
                  denominators=dict(expected=20, role_meta=20, raw_pool=20, bans=12),
                  boundary="Top-six role coverage, not top-one accuracy or draft win probability. "
                  "Frozen weights; no outcome-based tuning. Confirm against official VOD/OE.")
    out = ROOT / "outputs/t1-kc-20261107-provisional.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(dict(totals=totals, games=[r["hits"] for r in rows])))


if __name__ == "__main__":
    main()
