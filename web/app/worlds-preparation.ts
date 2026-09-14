import type { OpponentTeam, RadarReport } from "./radar-types";

// Human-reviewed official snapshot, not inferred from power rankings or regional standings.
export const WORLDS_2026 = {
  checked_on: "2026-09-14",
  start_date: "2026-10-15",
  end_date: "2026-11-14",
  schedule_source: "https://lolesports.com/en-GB",
  qualification_source: "https://lolesports.com/ko-KR/tournament/115660540725177488/overview",
  first_selection_source: "https://lolesports.com/en-AU/news/season-start-2026-lol-esports",
  patch: null,
  draft_rules: "AWAITING_EVENT_RULE_VERIFICATION",
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
    };
  });
}
