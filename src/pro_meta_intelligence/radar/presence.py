"""Same-patch pick/ban presence known at a cutoff (input for practice-opponent bans)."""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from pro_meta_intelligence.leakage import filter_available
from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent

PRESENCE_LIMIT = 60
ROLES = frozenset({"TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"})


def patch_presence(
    matches: tuple[MatchRecord, ...] | list[MatchRecord],
    draft_events: tuple[PickBanEvent, ...] | list[PickBanEvent],
    *,
    cutoff: datetime,
    patch_id: str,
    limit: int = PRESENCE_LIMIT,
) -> dict:
    """Counts picks and bans per champion over same-patch matches available at ``cutoff``."""
    known = {
        match.match_id for match in filter_available(matches, cutoff) if match.patch_id == patch_id
    }
    picks: Counter = Counter()
    bans: Counter = Counter()
    roles: dict[str, Counter] = {}
    for event in filter_available(draft_events, cutoff):
        if event.match_id not in known:
            continue
        if event.action is DraftAction.PICK:
            picks[event.champion_id] += 1
            if event.role in ROLES:
                roles.setdefault(event.champion_id, Counter())[event.role] += 1
        else:
            bans[event.champion_id] += 1
    ordered = sorted(set(picks) | set(bans), key=lambda c: (-(picks[c] + bans[c]), c))
    return {
        "patch_id": patch_id,
        "cutoff": cutoff.isoformat(),
        "match_count": len(known),
        "champions": [
            {
                "champion_id": c,
                "picks": picks[c],
                "bans": bans[c],
                "roles": [
                    {"role": role, "picks": count}
                    for role, count in sorted(
                        roles.get(c, Counter()).items(), key=lambda x: (-x[1], x[0])
                    )
                ],
            }
            for c in ordered[:limit]
        ],
    }
