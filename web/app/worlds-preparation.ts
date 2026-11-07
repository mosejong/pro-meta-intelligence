import type { OpponentTeam, RadarReport } from "./radar-types";
import { championAssetId } from "./champion-assets";

// Human-reviewed official snapshot, not inferred from power rankings or regional standings.
export const WORLDS_2026 = {
  checked_on: "2026-09-15",
  qualification_checked_on: "2026-09-21",
  start_date: "2026-10-15",
  end_date: "2026-11-14",
  schedule_source: "https://lolesports.com/en-GB",
  qualification_source: "https://lolesports.com/en-US/tournament/115660540725177488/overview",
  first_selection_source: "https://lolesports.com/en-AU/news/season-start-2026-lol-esports",
  rules_source: "https://cdn.sanity.io/files/dsfx7636/news_live/faa5ce974e58615911fbee931c6123e2785a8b46.pdf",
  rules_version: "1.01",
  patch: "26.20",
  draft_rules: "FIRST_SELECTION_VERIFIED_FEARLESS_PENDING",
  teams: [
    { code: "T1", league: "LCK", names: ["T1"] },
    { code: "GEN", league: "LCK", names: ["Gen.G", "GEN"] },
    { code: "HLE", league: "LCK", names: ["Hanwha Life Esports", "HLE"] },
    { code: "DK", league: "LCK", names: ["Dplus Kia", "DK"] },
    { code: "CFO", league: "LCP", names: ["CTBC Flying Oyster", "CFO"] },
    { code: "MVK", league: "LCP", names: ["MVK Esports", "MVK"] },
    { code: "TSW", league: "LCP", names: ["Team Secret Whales", "TSW"] },
    { code: "BLG", league: "LPL", names: ["Bilibili Gaming", "BLG"] },
    { code: "TES", league: "LPL", names: ["Top Esports", "TES"] },
    { code: "AL", league: "LPL", names: ["Anyone's Legend", "AL"] },
    { code: "G2", league: "LEC", names: ["G2 Esports", "G2"] },
    { code: "KC", league: "LEC", names: ["Karmine Corp", "KC"] },
    { code: "MKOI", league: "LEC", names: ["Movistar KOI", "MKOI"] },
    { code: "IG", league: "LPL", names: ["Invictus Gaming", "IG"] },
    { code: "LYON", league: "LCS", names: ["LYON"] },
  ],
  // Press-reported draw after the Swiss stage; official bracket page was not directly retrievable.
  // Results are never inferred: a pairing only says who meets whom and when.
  knockout_checked_on: "2026-11-03",
  knockout_source: "https://www.strafe.com/news/read/worlds-2026-playoffs-bracket-schedule-start-times-and-format/",
  quarterfinals: [
    { start_at: "2026-11-03T22:00:00Z", teams: ["TES", "IG"] },
    { start_at: "2026-11-04T22:00:00Z", teams: ["GEN", "LYON"] },
    { start_at: "2026-11-05T22:00:00Z", teams: ["DK", "BLG"] },
    { start_at: "2026-11-06T22:00:00Z", teams: ["T1", "KC"] },
  ],
  semifinal_dates: ["2026-11-07", "2026-11-08"],
  final_date: "2026-11-14",
} as const;

export type WorldsStage = "QUARTERFINAL" | "OUT_OF_KNOCKOUTS";

// Fixed KST (UTC+9, no daylight saving) so server and browser render the same text.
export function formatKst(isoUtc: string) {
  const kst = new Date(Date.parse(isoUtc) + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${kst.getUTCMonth() + 1}.${kst.getUTCDate()} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())} KST`;
}

export function worldsQuarterfinalFor(code: string) {
  const match = WORLDS_2026.quarterfinals.find((item) => (item.teams as readonly string[]).includes(code));
  if (!match) return null;
  return { start_at: match.start_at, opponent: match.teams[0] === code ? match.teams[1] : match.teams[0] };
}

const roles = [
  ["TOP", "탑"], ["JUNGLE", "정글"], ["MID", "미드"], ["BOTTOM", "바텀"], ["SUPPORT", "서포터"],
] as const;

// Descriptive team evidence only: never changes the frozen prediction experiment.
export function worldsRoleCoverage(team: OpponentTeam | null) {
  return roles.map(([role, label]) => {
    const champions = new Map<string, { champion_id: string; evidence: Set<string>; sources: Set<string> }>();
    const add = (id: string, games: number, evidence: string[], source: string) => {
      const cited = evidence.filter((event) => event.trim());
      if (!(games > 0) || !cited.length || !id.trim()) return;
      const canonical = championAssetId(id.trim());
      const key = canonical.toLowerCase();
      const champion = champions.get(key) ?? { champion_id: canonical, evidence: new Set<string>(), sources: new Set<string>() };
      // Preserve one stable display ID even when input rows have mixed casing.
      if (canonical < champion.champion_id) champion.champion_id = canonical;
      cited.forEach((event) => champion.evidence.add(event.trim()));
      champion.sources.add(source);
      champions.set(key, champion);
    };
    for (const profile of team?.player_profiles ?? []) {
      if (profile.role !== role) continue;
      for (const pick of profile.champions) add(pick.champion_id, pick.game_count, pick.evidence_event_ids, "선수별 기록");
    }
    for (const pick of team?.priority_picks ?? []) {
      if (pick.role === role) add(pick.champion_id, pick.game_count, pick.evidence_event_ids, "팀 주요 픽");
    }
    for (const game of team?.recent_games ?? []) {
      for (const pick of game.picks) {
        if (pick.role === role && pick.evidence_event_id) add(pick.champion_id, 1, [pick.evidence_event_id], "최근 경기");
      }
    }
    return { role, label, champion_count: champions.size,
      champions: [...champions.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([, champion]) => ({ champion_id: champion.champion_id,
          evidence_count: champion.evidence.size, sources: [...champion.sources].sort() })),
    };
  });
}

export function buildWorldsPreparation(report: RadarReport) {
  const normalize = (name: string) => name.trim().toUpperCase();
  const teams = report.opponent_prep?.teams ?? [];
  return WORLDS_2026.teams.map((qualified) => {
    // On the Worlds patch a qualified team's games are labelled WLDs, not its home league.
    const matches = teams.filter((team) => (team.leagues.includes(qualified.league) || team.leagues.includes("WLDs")) &&
      qualified.names.some((name) => normalize(name) === normalize(team.team_name)));
    // An ambiguous identity never silently picks one feed row or an academy team.
    const team: OpponentTeam | null = matches.length === 1 ? matches[0] : null;
    const quarterfinal = worldsQuarterfinalFor(qualified.code);
    const stage: WorldsStage = quarterfinal ? "QUARTERFINAL" : "OUT_OF_KNOCKOUTS";
    return { ...qualified, team, sample: team?.game_count ?? 0, stage, quarterfinal,
      first_picks: team?.priority_picks.slice(0, 3).map((pick) => pick.champion_id) ?? [],
      role_coverage: worldsRoleCoverage(team),
    };
  });
}
