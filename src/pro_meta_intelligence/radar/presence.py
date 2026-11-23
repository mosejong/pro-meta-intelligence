"""Same-patch pick/ban presence known at a cutoff (input for practice-opponent bans)."""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from pro_meta_intelligence.leakage import filter_available
from pro_meta_intelligence.models import DraftAction, MatchRecord, PickBanEvent

PRESENCE_LIMIT = 60


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
    for event in filter_available(draft_events, cutoff):
        if event.match_id in known:
            (picks if event.action is DraftAction.PICK else bans)[event.champion_id] += 1
    ordered = sorted(set(picks) | set(bans), key=lambda c: (-(picks[c] + bans[c]), c))
    return {
        "patch_id": patch_id,
        "cutoff": cutoff.isoformat(),
        "match_count": len(known),
        "champions": [
            {"champion_id": c, "picks": picks[c], "bans": bans[c]} for c in ordered[:limit]
        ],
    }
