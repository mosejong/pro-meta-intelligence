import type {
  OpponentChampionTendency,
  OpponentPlayerProfile,
  OpponentTeam,
  RadarReport,
  ScheduleEvent,
  ScheduleParticipant,
} from "./radar-types";

const LANE_ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"] as const;
export type LaneRole = typeof LANE_ROLES[number];

export type ConfirmedLaneSignal = {
  champion_id: string;
  own_game_rate: number | null;
  opponent_game_rate: number | null;
  opponent_ban_rate: number | null;
  evidence_ids: string[];
};

export type ConfirmedLaneCollision = {
  role: LaneRole;
  review_rank: number;
  review_score: number;
  review_tier: "P1" | "P2" | "P3";
  components: {
    shared_pool: number;
    ban_pressure: number;
    opponent_priority: number;
    phase_one_pressure: number;
  };
  own_players: Array<{ player_id: string; player_name: string; game_count: number }>;
  opponent_players: Array<{ player_id: string; player_name: string; game_count: number }>;
  contested: ConfirmedLaneSignal[];
  protect: ConfirmedLaneSignal[];
  opponent_priority: ConfirmedLaneSignal[];
  reasons: string[];
  staff_questions: string[];
  evidence_ids: string[];
};

export type ConfirmedOpponentMatchup = {
  schema_version: "1";
  artifact_type: "confirmed-opponent-lane-report";
  status: "READY" | "LIMITED";
  fixture_event_id: string;
  own_team: { team_id: string; team_name: string; game_count: number };
  opponent: { team_id: string; team_name: string; game_count: number };
  priority_lane_order: LaneRole[];
  lanes: ConfirmedLaneCollision[];
  quality: {
    own_current_player_count: number;
    opponent_current_player_count: number;
    lanes_with_player_names: number;
    lanes_with_draft_signals: number;
    limitations: string[];
  };
  evidence: {
    match_ids: string[];
    draft_event_ids: string[];
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  boundary: string;
};

function normalizedIdentity(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/(?:esports|gaming|team)$/u, "");
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function currentPlayers(team: OpponentTeam, role: LaneRole) {
  return (team.player_profiles ?? [])
    .filter((player) => player.roster_status === "CURRENT" && player.role === role)
    .sort((left, right) => right.game_count - left.game_count || left.player_name.localeCompare(right.player_name));
}

function lanePicks(team: OpponentTeam, role: LaneRole) {
  return team.priority_picks
    .filter((pick) => pick.role === role)
    .sort((left, right) => right.game_rate - left.game_rate || left.champion_id.localeCompare(right.champion_id));
}

function publicPlayers(players: OpponentPlayerProfile[]) {
  return players.map((player) => ({
    player_id: player.player_id,
    player_name: player.player_name,
    game_count: player.game_count,
  }));
}

function signalFrom(
  championId: string,
  own: OpponentChampionTendency | null,
  opponent: OpponentChampionTendency | null,
  ban: OpponentChampionTendency | null,
): ConfirmedLaneSignal {
  return {
    champion_id: championId,
    own_game_rate: own?.game_rate ?? null,
    opponent_game_rate: opponent?.game_rate ?? null,
    opponent_ban_rate: ban?.game_rate ?? null,
    evidence_ids: unique([
      ...(own?.evidence_event_ids ?? []),
      ...(opponent?.evidence_event_ids ?? []),
      ...(ban?.evidence_event_ids ?? []),
    ]),
  };
}

function reviewTier(score: number) {
  if (score >= 60) return "P1" as const;
  if (score >= 30) return "P2" as const;
  return "P3" as const;
}

function buildLaneCollision(
  ownTeam: OpponentTeam,
  opponent: OpponentTeam,
  role: LaneRole,
): Omit<ConfirmedLaneCollision, "review_rank"> {
  const ownPicks = lanePicks(ownTeam, role);
  const opponentPicks = lanePicks(opponent, role);
  const ownByChampion = new Map(ownPicks.map((pick) => [pick.champion_id, pick]));
  const opponentBans = new Map(opponent.frequent_bans.map((ban) => [ban.champion_id, ban]));
  const contested = opponentPicks
    .filter((pick) => ownByChampion.has(pick.champion_id))
    .map((pick) => signalFrom(pick.champion_id, ownByChampion.get(pick.champion_id) ?? null, pick, null));
  const protect = ownPicks
    .filter((pick) => opponentBans.has(pick.champion_id))
    .map((pick) => signalFrom(pick.champion_id, pick, null, opponentBans.get(pick.champion_id) ?? null));
  const opponentPriority = opponentPicks
    .filter((pick) => !ownByChampion.has(pick.champion_id))
    .slice(0, 3)
    .map((pick) => signalFrom(pick.champion_id, null, pick, null));

  const sharedPoolRate = Math.max(0, ...contested.map((item) => ((item.own_game_rate ?? 0) + (item.opponent_game_rate ?? 0)) / 2));
  const protectRate = Math.max(0, ...protect.map((item) => ((item.own_game_rate ?? 0) + (item.opponent_ban_rate ?? 0)) / 2));
  const opponentPickRate = Math.max(0, ...opponentPicks.map((pick) => pick.game_rate));
  const opponentPhaseOneCount = Math.max(0, ...opponentPicks.map((pick) => pick.phase_1_count));
  const components = {
    shared_pool: contested.length ? Math.round(Math.min(35, 15 + sharedPoolRate * 20)) : 0,
    ban_pressure: protect.length ? Math.round(Math.min(30, 12 + protectRate * 18)) : 0,
    opponent_priority: opponentPicks.length ? Math.round(Math.min(25, 8 + opponentPickRate * 17)) : 0,
    phase_one_pressure: opponentPhaseOneCount ? Math.min(10, 4 + opponentPhaseOneCount * 2) : 0,
  };
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  const reasons = [
    ...(contested.length ? [`동일 역할 공통 챔피언 ${contested.map((item) => item.champion_id).join(" · ")}`] : []),
    ...(protect.length ? [`상대 밴과 겹치는 우리 픽 ${protect.map((item) => item.champion_id).join(" · ")}`] : []),
    ...(opponentPicks[0] ? [`상대 역할 1순위 ${opponentPicks[0].champion_id} ${(opponentPicks[0].game_rate * 100).toFixed(0)}% 관측`] : []),
    ...(!ownPicks.length || !opponentPicks.length ? ["한쪽 역할별 공개 픽 표본이 부족해 팀 단위 신호만 사용"] : []),
  ];
  const staffQuestions = [
    ...(contested[0] ? [`${contested[0].champion_id} 우선권을 선픽·교환·포기 중 어느 조건으로 처리할지 정했는가?`] : []),
    ...(protect[0] ? [`${protect[0].champion_id}이 닫혀도 같은 조합 기능을 유지하는 대체 픽이 있는가?`] : []),
    ...(opponentPriority[0] ? [`${opponentPriority[0].champion_id}을 허용했을 때 라인과 조합 단위 응답을 검증했는가?`] : []),
    ...(!contested.length && !protect.length && !opponentPriority.length ? ["현재 공개 표본에서 직접 충돌은 없지만 새 패치 픽이 추가되는지 확인할 것."] : []),
  ];
  const evidenceIds = unique([
    ...contested.flatMap((item) => item.evidence_ids),
    ...protect.flatMap((item) => item.evidence_ids),
    ...opponentPriority.flatMap((item) => item.evidence_ids),
  ]);
  return {
    role,
    review_score: score,
    review_tier: reviewTier(score),
    components,
    own_players: publicPlayers(currentPlayers(ownTeam, role)),
    opponent_players: publicPlayers(currentPlayers(opponent, role)),
    contested,
    protect,
    opponent_priority: opponentPriority,
    reasons,
    staff_questions: staffQuestions.slice(0, 3),
    evidence_ids: evidenceIds,
  };
}

function teamForParticipant(report: RadarReport, participant: ScheduleParticipant | null) {
  if (!participant) return null;
  const identities = [participant.name, participant.code].map(normalizedIdentity).filter(Boolean);
  return (report.opponent_prep?.teams ?? []).find((team) => (
    [team.team_name, ...team.team_name_aliases]
      .map(normalizedIdentity)
      .some((identity) => identities.includes(identity))
  )) ?? null;
}

export function buildConfirmedOpponentMatchup(
  report: RadarReport,
  target: OpponentTeam,
  ownTeam: OpponentTeam | undefined,
  fixture: ScheduleEvent | null,
  relationship: string,
  otherParticipant: ScheduleParticipant | null,
): ConfirmedOpponentMatchup | null {
  if (!ownTeam || !fixture || !otherParticipant) return null;
  const opponent = relationship === "CONFIRMED_HEAD_TO_HEAD"
    ? target
    : relationship === "TARGET_AS_OWN_TEAM"
      ? teamForParticipant(report, otherParticipant)
      : null;
  if (!opponent || opponent.team_id === ownTeam.team_id) return null;

  const ranked = LANE_ROLES
    .map((role) => buildLaneCollision(ownTeam, opponent, role))
    .sort((left, right) => right.review_score - left.review_score || LANE_ROLES.indexOf(left.role) - LANE_ROLES.indexOf(right.role))
    .map((lane, index) => ({ ...lane, review_rank: index + 1 }));
  const ownPlayerCount = (ownTeam.player_profiles ?? []).filter((player) => player.roster_status === "CURRENT").length;
  const opponentPlayerCount = (opponent.player_profiles ?? []).filter((player) => player.roster_status === "CURRENT").length;
  const limitations = [
    ...(ownPlayerCount < 5 ? [`${ownTeam.team_name} 최근 관측 선수 프로필이 5명 미만입니다.`] : []),
    ...(opponentPlayerCount < 5 ? [`${opponent.team_name} 최근 관측 선수 프로필이 5명 미만입니다.`] : []),
    "역할별 점수는 공개 픽 겹침·상대 밴·우선 픽·1페이즈 빈도를 합친 검토 순서이며 승률 예측이 아닙니다.",
  ];
  return {
    schema_version: "1",
    artifact_type: "confirmed-opponent-lane-report",
    status: ownPlayerCount >= 5 && opponentPlayerCount >= 5 ? "READY" : "LIMITED",
    fixture_event_id: fixture.event_id,
    own_team: { team_id: ownTeam.team_id, team_name: ownTeam.team_name, game_count: ownTeam.game_count },
    opponent: { team_id: opponent.team_id, team_name: opponent.team_name, game_count: opponent.game_count },
    priority_lane_order: ranked.map((lane) => lane.role),
    lanes: ranked,
    quality: {
      own_current_player_count: ownPlayerCount,
      opponent_current_player_count: opponentPlayerCount,
      lanes_with_player_names: ranked.filter((lane) => lane.own_players.length > 0 && lane.opponent_players.length > 0).length,
      lanes_with_draft_signals: ranked.filter((lane) => lane.evidence_ids.length > 0).length,
      limitations,
    },
    evidence: {
      match_ids: unique([...ownTeam.evidence.match_ids, ...opponent.evidence.match_ids]),
      draft_event_ids: unique(ranked.flatMap((lane) => lane.evidence_ids)),
      source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
    },
    boundary: "Confirmed official fixture plus public professional-match evidence. Lane review scores prioritize staff review; they do not predict lane outcome, player form, or draft intent.",
  };
}
