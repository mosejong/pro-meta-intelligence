import type { OpponentTeam, RadarReport } from "./radar-types";

// Human-reviewed official snapshot, not inferred from power rankings or regional standings.
export const WORLDS_2026 = {
  checked_on: "2026-09-15",
  start_date: "2026-10-15",
  end_date: "2026-11-14",
  schedule_source: "https://lolesports.com/en-GB",
  qualification_source: "https://lolesports.com/ko-KR/tournament/115660540725177488/overview",
  first_selection_source: "https://lolesports.com/en-AU/news/season-start-2026-lol-esports",
  rules_source: "https://cdn.sanity.io/files/dsfx7636/news_live/faa5ce974e58615911fbee931c6123e2785a8b46.pdf",
  rules_version: "1.01",
  patch: "26.20",
  draft_rules: "FIRST_SELECTION_VERIFIED_FEARLESS_PENDING",
  teams: [
    { code: "T1", league: "LCK", names: ["T1"] },
    { code: "GEN", league: "LCK", names: ["Gen.G", "GEN"] },
    { code: "HLE", league: "LCK", names: ["Hanwha Life Esports", "HLE"] },
    { code: "CFO", league: "LCP", names: ["CTBC Flying Oyster", "CFO"] },
    { code: "MVK", league: "LCP", names: ["MVK Esports", "MVK"] },
    { code: "TSW", league: "LCP", names: ["Team Secret Whales", "TSW"] },
    { code: "BLG", league: "LPL", names: ["Bilibili Gaming", "BLG"] },
  ],
} as const;

const roles = [
  ["TOP", "탑"], ["JUNGLE", "정글"], ["MID", "미드"], ["BOTTOM", "바텀"], ["SUPPORT", "서포터"],
] as const;

// Descriptive team evidence only: never changes the frozen prediction experiment.
export function worldsRoleCoverage(team: OpponentTeam | null) {
  return roles.map(([role, label]) => {
    const champions = new Set<string>();
    const add = (id: string, games: number, evidence: string[]) => {
      if (games > 0 && evidence.length > 0 && id.trim()) champions.add(id.trim().toLowerCase());
    };
    for (const profile of team?.player_profiles ?? []) {
      if (profile.role !== role) continue;
      for (const pick of profile.champions) add(pick.champion_id, pick.game_count, pick.evidence_event_ids);
    }
    for (const pick of team?.priority_picks ?? []) {
      if (pick.role === role) add(pick.champion_id, pick.game_count, pick.evidence_event_ids);
    }
    for (const game of team?.recent_games ?? []) {
      for (const pick of game.picks) {
        if (pick.role === role && pick.evidence_event_id) add(pick.champion_id, 1, [pick.evidence_event_id]);
      }
    }
    return { role, label, champion_count: champions.size };
  });
}

export function buildWorldsPreparation(report: RadarReport) {
  const normalize = (name: string) => name.trim().toUpperCase();
  const teams = report.opponent_prep?.teams ?? [];
  return WORLDS_2026.teams.map((qualified) => {
    const matches = teams.filter((team) => team.leagues.includes(qualified.league) &&
      qualified.names.some((name) => normalize(name) === normalize(team.team_name)));
    // An ambiguous identity never silently picks one feed row or an academy team.
    const team: OpponentTeam | null = matches.length === 1 ? matches[0] : null;
    return { ...qualified, team, sample: team?.game_count ?? 0,
      first_picks: team?.priority_picks.slice(0, 3).map((pick) => pick.champion_id) ?? [],
      role_coverage: worldsRoleCoverage(team),
    };
  });
}
