"""Equal-budget, chronological season/recent player-pick comparison (offline research)."""

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.models import DraftAction
from pro_meta_intelligence.sources import SourceRegistry

TEAMS = {
    "T1",
    "Karmine Corp",
    "Top Esports",
    "Invictus Gaming",
    "Gen.G",
    "LYON",
    "Dplus Kia",
    "Bilibili Gaming",
}


def ranking(counts):
    return sorted(counts, key=lambda c: (-counts[c], c))


def metrics(rows):
    n = len(rows)
    return {
        "picks": n,
        **{
            f"top{k}": round(sum(0 < r <= k for r in rows) / n, 4) if n else None for k in (1, 3, 6)
        },
        "mrr": round(sum(1 / r for r in rows if r) / n, 4) if n else None,
    }


def select_external_teams(matches, minimum_games=20):
    """Freeze cohort on first-half domestic appearances, never evaluation outcomes."""
    counts = Counter()
    for match in matches:
        if match.observed_at.month < 7 and match.league in {"LCK", "LPL", "LEC", "LCS", "LCP"}:
            counts.update(name for name in (match.blue_team_name, match.red_team_name) if name)
    return frozenset(
        name for name, count in counts.items() if count >= minimum_games and name not in TEAMS
    )


def evaluate(matches, events, team_names=None):
    team_names = TEAMS if team_names is None else frozenset(team_names)
    by_match = defaultdict(list)
    for e in events:
        if e.action is DraftAction.PICK:
            by_match[e.match_id].append(e)
    games = sorted(matches, key=lambda m: (m.observed_at, m.match_id))
    history = []
    team_history = defaultdict(list)
    season_counts = defaultdict(Counter)
    meta_counts = defaultdict(Counter)
    pending = 0
    results = defaultdict(list)
    audit = []
    # Freeze each calendar day's information; this avoids learning from an earlier set
    # that a once-daily source could not yet have published. No inferred series locks.
    for game in games:
        cutoff = game.observed_at.replace(hour=0, minute=0, second=0, microsecond=0)
        while pending < len(games) and games[pending].observed_at + timedelta(hours=24) < cutoff:
            published = games[pending]
            history.append(published)
            year = published.observed_at.year
            for tid in (published.blue_team_id, published.red_team_id):
                team_history[(year, tid)].append(published)
            for event in by_match[published.match_id]:
                meta_counts[(year, published.patch_id, event.role)][event.champion_id] += 1
                if event.player_id:
                    season_counts[(year, event.player_id, event.role)][event.champion_id] += 1
            pending += 1
        if game.observed_at.month < 7:
            continue
        for team_id, name in (
            (game.blue_team_id, game.blue_team_name),
            (game.red_team_id, game.red_team_name),
        ):
            if name not in team_names:
                continue
            past = team_history[(game.observed_at.year, team_id)]
            recent_ids = {m.match_id for m in past[-40:]}
            # Player ID rather than display name; preserve records across team transfers.
            for actual in by_match[game.match_id]:
                if actual.team_id != team_id or not actual.player_id:
                    continue
                season = season_counts[(game.observed_at.year, actual.player_id, actual.role)]
                meta = meta_counts[(game.observed_at.year, game.patch_id, actual.role)]
                recent = Counter()
                for old in past[-40:]:
                    for e in by_match[old.match_id]:
                        if e.role != actual.role:
                            continue
                        if e.player_id == actual.player_id:
                            if old.match_id in recent_ids:
                                recent[e.champion_id] += 1
                if not season or not recent:
                    continue

                def share(c, counter):
                    return counter[c] / max(1, counter.total())

                models = {
                    "recent40": ranking(recent),
                    "season": ranking(season),
                    "patch_role_meta": ranking(meta),
                }
                for label, a, b in (
                    ("recent75_meta25", recent, meta),
                    ("season75_meta25", season, meta),
                    ("recent75_season25", recent, season),
                ):
                    models[label] = ranking(
                        {c: 0.75 * share(c, a) + 0.25 * share(c, b) for c in a.keys() | b.keys()}
                    )
                ranks = {}
                for model, order in models.items():
                    rank = order.index(actual.champion_id) + 1 if actual.champion_id in order else 0
                    ranks[model] = rank
                    for scope in (
                        "ALL",
                        f"month:{game.observed_at:%Y-%m}",
                        f"team:{name}",
                        f"league:{game.league}",
                        f"role:{actual.role}",
                    ):
                        results[(scope, model)].append(rank)
                audit.append(
                    dict(
                        match_id=game.match_id,
                        team=name,
                        role=actual.role,
                        player_id=actual.player_id,
                        actual=actual.champion_id,
                        cutoff=cutoff.isoformat(),
                        ranks=ranks,
                    )
                )
    return {
        "status": "EXPLORATORY_NOT_INDEPENDENT_VALIDATION",
        "evaluated_teams": sorted(team_names),
        "protocol": "2026 July onward, calendar-day freeze, simulated publication +24h, "
        "same observations and top1/3/6 budgets for every model. "
        "No current-draft or Fearless filtering; no ban-opportunity rates. "
        "Selected teams only; actual player IDs and roles are known at evaluation time.",
        "scores": {
            scope: {model: metrics(rows) for (s, model), rows in results.items() if s == scope}
            for scope in sorted({s for s, _ in results})
        },
        "audit": audit,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--external-teams",
        action="store_true",
        help="First-half major-league teams outside original eight; at least 20 games",
    )
    args = parser.parse_args()
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        args.input, retrieved_at=datetime.fromisoformat(args.retrieved_at), source_timezone="UTC"
    )
    cohort = select_external_teams(imported.matches) if args.external_teams else TEAMS
    report = evaluate(imported.matches, imported.draft_events, cohort)
    report["cohort_selection"] = (
        "Outside original eight; at least 20 Jan-Jun games in LCK/LPL/LEC/LCS/LCP"
        if args.external_teams
        else "Original eight teams"
    )
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report["scores"].get("ALL", {})))
