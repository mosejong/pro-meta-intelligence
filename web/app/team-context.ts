import type { OpponentChampionTendency, OpponentTeam, RadarReport } from "./radar-types";

export type OpponentPriorityTier = "P1" | "P2" | "P3";

export type OpponentPriority = {
  team: OpponentTeam;
  score: number;
  tier: OpponentPriorityTier;
  shared_leagues: string[];
  contested_picks: OpponentChampionTendency[];
  meta_overlaps: OpponentChampionTendency[];
  reasons: string[];
  components: {
    same_league: number;
    global_meta_overlap: number;
    contested_picks: number;
    sample_quality: number;
    evidence_penalty: number;
  };
};

export type TeamContext = {
  my_team: OpponentTeam;
  opponent_priorities: OpponentPriority[];
};

function pickKey(pick: Pick<OpponentChampionTendency, "champion_id" | "role">) {
  return `${pick.champion_id}::${pick.role ?? "UNKNOWN"}`;
}

function priorityTier(score: number): OpponentPriorityTier {
  if (score >= 60) return "P1";
  if (score >= 40) return "P2";
  return "P3";
}

function qualityPenalty(team: OpponentTeam) {
  let penalty = 0;
  if (team.quality_flags.includes("LOW_MATCH_SAMPLE")) penalty -= 12;
  if (team.quality_flags.includes("INCOMPLETE_BAN_EVIDENCE")) penalty -= 6;
  return penalty;
}

export function scoreOpponent(
  report: RadarReport,
  myTeam: OpponentTeam,
  opponent: OpponentTeam,
): OpponentPriority {
  const maximumGames = Math.max(report.opponent_prep?.config.maximum_games_per_team ?? 1, 1);
  const sharedLeagues = myTeam.leagues.filter((league) => opponent.leagues.includes(league)).sort();
  const ownPickKeys = new Set(myTeam.priority_picks.map(pickKey));
  const radarRanks = new Map(
    report.entries
      .filter((entry) => entry.eligible_for_review && entry.rank <= 50)
      .map((entry) => [`${entry.champion_id}::${entry.role}`, entry.rank]),
  );
  const contestedPicks = opponent.priority_picks.filter((pick) => ownPickKeys.has(pickKey(pick)));
  const metaOverlaps = opponent.priority_picks.filter((pick) => radarRanks.has(pickKey(pick)));
  const metaOverlapScore = metaOverlaps.reduce((sum, pick) => {
    const rank = radarRanks.get(pickKey(pick)) ?? 51;
    return sum + (rank <= 10 ? 8 : rank <= 25 ? 6 : 4);
  }, 0);
  const components = {
    same_league: sharedLeagues.length ? 30 : 0,
    global_meta_overlap: Math.min(metaOverlapScore, 24),
    contested_picks: Math.min(contestedPicks.length * 6, 18),
    sample_quality: Math.round(Math.min(opponent.game_count / maximumGames, 1) * 18),
    evidence_penalty: qualityPenalty(opponent),
  };
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0)));
  const reasons: string[] = [];
  if (sharedLeagues.length) reasons.push(`${sharedLeagues.join("/")} 동일 리그`);
  if (contestedPicks.length) reasons.push(`${contestedPicks.slice(0, 2).map((pick) => pick.champion_id).join(" · ")} 픽 충돌`);
  if (metaOverlaps.length) reasons.push(`상승 메타 ${metaOverlaps.length}개 겹침`);
  reasons.push(`${opponent.game_count}경기 공개 표본`);
  if (components.evidence_penalty < 0) reasons.push("표본 경고 감점");

  return {
    team: opponent,
    score,
    tier: priorityTier(score),
    shared_leagues: sharedLeagues,
    contested_picks: contestedPicks,
    meta_overlaps: metaOverlaps,
    reasons: reasons.slice(0, 3),
    components,
  };
}

export function buildTeamContext(report: RadarReport, myTeamId: string): TeamContext | null {
  const teams = report.opponent_prep?.teams ?? [];
  const myTeam = teams.find((team) => team.team_id === myTeamId);
  if (!myTeam) return null;

  const opponentPriorities = teams
    .filter((team) => team.team_id !== myTeam.team_id)
    .map((team) => scoreOpponent(report, myTeam, team))
    .sort((left, right) => (
      right.score - left.score ||
      right.team.game_count - left.team.game_count ||
      left.team.team_name.localeCompare(right.team.team_name)
    ));

  return { my_team: myTeam, opponent_priorities: opponentPriorities };
}
