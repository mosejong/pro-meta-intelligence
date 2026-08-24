import type { OpponentChampionTendency, OpponentTeam, RadarReport, ScheduleEvent, ScheduleSnapshot } from "./radar-types";

export type OpponentPriorityTier = "P1" | "P2" | "P3";

export type OpponentPriority = {
  team: OpponentTeam;
  score: number;
  tier: OpponentPriorityTier;
  shared_leagues: string[];
  contested_picks: OpponentChampionTendency[];
  meta_overlaps: OpponentChampionTendency[];
  next_meeting: ScheduleEvent | null;
  days_until_meeting: number | null;
  reasons: string[];
  components: {
    same_league: number;
    global_meta_overlap: number;
    contested_picks: number;
    sample_quality: number;
    evidence_penalty: number;
    schedule_urgency: number;
  };
};

export type TeamContext = {
  my_team: OpponentTeam;
  schedule_status: "CONNECTED" | "NO_TEAM_FIXTURE" | "UNAVAILABLE";
  own_upcoming_events: ScheduleEvent[];
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

function normalizedIdentity(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/(?:esports|gaming|team)$/u, "");
}

function participantMatchesTeam(participant: { name: string; code: string }, team: OpponentTeam) {
  const candidates = [team.team_name, ...team.team_name_aliases]
    .map(normalizedIdentity)
    .filter(Boolean);
  const participantNames = [participant.name, participant.code]
    .map(normalizedIdentity)
    .filter(Boolean);
  return participantNames.some((name) => candidates.includes(name));
}

function eventIncludesTeam(event: ScheduleEvent, team: OpponentTeam) {
  return event.participants.some((participant) => participantMatchesTeam(participant, team));
}

function upcomingEvents(schedule: ScheduleSnapshot | null | undefined, referenceAt?: string | null) {
  if (!schedule) return [];
  const effectiveAt = Date.parse(referenceAt ?? schedule.retrieved_at);
  if (!Number.isFinite(effectiveAt)) return [];
  return schedule.events
    .filter((event) => Date.parse(event.start_at) >= effectiveAt)
    .sort((left, right) => Date.parse(left.start_at) - Date.parse(right.start_at));
}

function scheduleUrgency(
  event: ScheduleEvent | null,
  schedule: ScheduleSnapshot | null | undefined,
  referenceAt?: string | null,
) {
  if (!event || !schedule) return { score: 0, days: null };
  const elapsed = Date.parse(event.start_at) - Date.parse(referenceAt ?? schedule.retrieved_at);
  if (!Number.isFinite(elapsed) || elapsed < 0) return { score: 0, days: null };
  const days = Math.max(0, Math.ceil(elapsed / (24 * 60 * 60 * 1000)));
  if (days <= 3) return { score: 30, days };
  if (days <= 7) return { score: 24, days };
  if (days <= 14) return { score: 16, days };
  if (days <= 30) return { score: 8, days };
  return { score: 4, days };
}

export function scoreOpponent(
  report: RadarReport,
  myTeam: OpponentTeam,
  opponent: OpponentTeam,
  schedule?: ScheduleSnapshot | null,
  referenceAt?: string | null,
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
  const nextMeeting = upcomingEvents(schedule, referenceAt).find((event) => (
    eventIncludesTeam(event, myTeam) && eventIncludesTeam(event, opponent)
  )) ?? null;
  const urgency = scheduleUrgency(nextMeeting, schedule, referenceAt);
  const components = {
    same_league: sharedLeagues.length ? 30 : 0,
    global_meta_overlap: Math.min(metaOverlapScore, 24),
    contested_picks: Math.min(contestedPicks.length * 6, 18),
    sample_quality: Math.round(Math.min(opponent.game_count / maximumGames, 1) * 18),
    evidence_penalty: qualityPenalty(opponent),
    schedule_urgency: urgency.score,
  };
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0)));
  const reasons: string[] = [];
  if (nextMeeting && urgency.days !== null) reasons.push(`${urgency.days}일 후 공식 대진`);
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
    next_meeting: nextMeeting,
    days_until_meeting: urgency.days,
    reasons: reasons.slice(0, 3),
    components,
  };
}

export function buildTeamContext(
  report: RadarReport,
  myTeamId: string,
  schedule?: ScheduleSnapshot | null,
  referenceAt?: string | null,
): TeamContext | null {
  const teams = report.opponent_prep?.teams ?? [];
  const myTeam = teams.find((team) => team.team_id === myTeamId);
  if (!myTeam) return null;

  const ownUpcomingEvents = upcomingEvents(schedule, referenceAt).filter((event) => eventIncludesTeam(event, myTeam));
  const opponentPriorities = teams
    .filter((team) => team.team_id !== myTeam.team_id)
    .map((team) => scoreOpponent(report, myTeam, team, schedule, referenceAt))
    .sort((left, right) => (
      Number(Boolean(right.next_meeting)) - Number(Boolean(left.next_meeting)) ||
      (left.next_meeting && right.next_meeting
        ? Date.parse(left.next_meeting.start_at) - Date.parse(right.next_meeting.start_at)
        : 0) ||
      right.score - left.score ||
      right.team.game_count - left.team.game_count ||
      left.team.team_name.localeCompare(right.team.team_name)
    ));

  return {
    my_team: myTeam,
    schedule_status: schedule ? (ownUpcomingEvents.length ? "CONNECTED" : "NO_TEAM_FIXTURE") : "UNAVAILABLE",
    own_upcoming_events: ownUpcomingEvents,
    opponent_priorities: opponentPriorities,
  };
}
