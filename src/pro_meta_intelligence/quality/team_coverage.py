"""Join accepted games back to provider observations without relaxing import validation."""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirImport


def audit_team_coverage(path: Path, imported: OracleElixirImport, team_names: tuple[str, ...]):
    observed = defaultdict(dict)
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            # Player rows preserve team names even when the provider omitted team rows.
            name = row.get("teamname", "").strip()
            if name not in team_names:
                continue
            key = (row.get("league", "").strip(), row.get("gameid", "").strip())
            if not all(key):
                continue
            observed[name][key] = row.get("date", "")
    accepted = {match.match_id for match in imported.matches}
    issues = {issue.game_key: issue.code for issue in imported.report.issues}
    teams = {}
    for name in team_names:
        reasons = Counter()
        missing = []
        leagues = defaultdict(lambda: {"observed": 0, "accepted": 0})
        for (league, game_id), observed_at in sorted(observed[name].items()):
            good = f"oe:{league}:{game_id}" in accepted
            leagues[league]["observed"] += 1
            leagues[league]["accepted"] += int(good)
            if not good:
                reason = issues.get(f"{league}:{game_id}", "DETAIL_NOT_RETAINED")
                reasons[reason] += 1
                missing.append(
                    {
                        "game_key": f"{league}:{game_id}",
                        "reason": reason,
                        "provider_date": observed_at,
                    }
                )
        count = len(observed[name])
        teams[name] = {
            "observed_games": count,
            "accepted_games": count - len(missing),
            "excluded_games": len(missing),
            "excluded_rate": round(len(missing) / count, 4) if count else None,
            "exclusion_reasons": dict(reasons),
            "leagues": dict(leagues),
            "excluded_game_details": missing,
        }
    return {
        "artifact_type": "team-import-coverage",
        "source_version": imported.report.source_version,
        "retrieved_at": imported.report.retrieved_at.isoformat(),
        "teams": teams,
        "boundary": "Coverage within this provider file, not completeness of a team's season. "
        "Raw dates are provider-local observations. No rejected game is used in tendencies.",
    }
