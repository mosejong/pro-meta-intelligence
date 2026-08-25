import { buildFallbackCreatorTopic, type CreatorTopic } from "./creator-storyboard";
import type { OpponentTeam, RadarEntry, RadarReport } from "./radar-types";

export type T1CreatorAngle = {
  angle_type: "DIRECT_PUBLIC_OVERLAP";
  target_team_id: string;
  target_team_name: string;
  target_sample_game_count: number;
  observed_game_count: number;
  observed_game_rate: number;
  observed_players: string[];
  target_evidence_ids: string[];
  global_evidence_ids: string[];
  topic: CreatorTopic;
  boundary: string;
};

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function points(value: number) {
  const amount = value * 100;
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toFixed(1)}pp`;
}

function findTargetTeam(report: RadarReport, targetTeamName: string) {
  const normalized = targetTeamName.trim().toLocaleLowerCase("en-US");
  return (report.opponent_prep?.teams ?? []).find((team) => (
    team.team_name.toLocaleLowerCase("en-US") === normalized ||
    team.team_name_aliases.some((alias) => alias.toLocaleLowerCase("en-US") === normalized)
  ));
}

function observedPlayers(team: OpponentTeam, entry: RadarEntry) {
  return (team.player_profiles ?? [])
    .filter((player) => player.role === entry.role && player.champions.some((champion) => champion.champion_id === entry.champion_id))
    .map((player) => player.player_name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right));
}

function buildAngleTopic(report: RadarReport, team: OpponentTeam, entry: RadarEntry, gameCount: number, gameRate: number, targetEvidenceIds: string[]) {
  const base = buildFallbackCreatorTopic(report, entry);
  const role = roleLabels[entry.role] ?? entry.role;
  const targetClaim = {
    claim_id: `${team.team_name}:${entry.champion_id}:${entry.role}:public-games`,
    metric: "target_team_public_game_rate",
    value: gameRate,
    text: `${team.team_name}의 최근 공개 ${team.game_count}경기에서 ${entry.champion_id} ${role}은 ${gameCount}경기(${percent(gameRate)}) 관측됐다.`,
  };
  const titleCandidates = [
    `${team.team_name}이 실제로 꺼낸 ${entry.champion_id} ${role}, 메타 신호와 어디서 겹치나`,
    `${team.team_name} ${entry.champion_id} ${role} ${gameCount}경기: 공개 데이터로 확인한 것과 모르는 것`,
    `${entry.champion_id} ${role}은 ${team.team_name} 준비 후보인가? 글로벌 변화 ${points(entry.metrics.demand_velocity)}`,
  ];
  return {
    ...base,
    title_candidates: titleCandidates,
    thumbnail_copy: [`${team.team_name} × ${entry.champion_id}`, `공개 ${gameCount}경기`],
    hook: `${team.team_name}의 최근 공개 경기에서 ${entry.champion_id} ${role}이 관측됐습니다. 같은 패치의 글로벌 변화와 정확히 겹치는 부분만 확인하겠습니다.`,
    approved_claims: [...base.approved_claims, targetClaim],
    counterpoint: `${base.counterpoint} 또한 ${team.team_name} 공개 ${team.game_count}경기는 스크림 준비, 다음 경기 의도, 내부 우선순위를 보여주지 않는다.`,
    chapter_outline: base.chapter_outline.map((chapter) => chapter.chapter === "WHAT CHANGED"
      ? { ...chapter, uses: [...chapter.uses, targetClaim.claim_id] }
      : chapter.chapter === "WHY IT MAY MATTER"
        ? { ...chapter, uses: [...chapter.uses, targetClaim.claim_id] }
        : chapter),
    short_summary: `${targetClaim.text} ${base.approved_claims[0].text} 다만 ${base.counterpoint}`,
    quality_flags: [...base.quality_flags, ...team.quality_flags.map((flag) => `TARGET_${flag}`)],
    evidence_event_ids: [...new Set([...base.evidence_event_ids, ...targetEvidenceIds])],
  } satisfies CreatorTopic;
}

export function buildT1CreatorAngles(report: RadarReport, targetTeamName = "T1"): T1CreatorAngle[] {
  const team = findTargetTeam(report, targetTeamName);
  if (!team) return [];
  return team.priority_picks.flatMap((pick) => {
    if (!pick.role) return [];
    const entry = report.entries.find((candidate) => (
      candidate.eligible_for_review &&
      candidate.champion_id === pick.champion_id &&
      candidate.role === pick.role
    ));
    if (!entry) return [];
    const players = observedPlayers(team, entry);
    const topic = buildAngleTopic(report, team, entry, pick.game_count, pick.game_rate, pick.evidence_event_ids);
    return [{
      angle_type: "DIRECT_PUBLIC_OVERLAP" as const,
      target_team_id: team.team_id,
      target_team_name: team.team_name,
      target_sample_game_count: team.game_count,
      observed_game_count: pick.game_count,
      observed_game_rate: pick.game_rate,
      observed_players: players,
      target_evidence_ids: [...pick.evidence_event_ids],
      global_evidence_ids: [...entry.evidence_event_ids],
      topic,
      boundary: `${team.team_name} 공개 픽과 글로벌 Radar의 직접 중복만 보여줍니다. 스크림, 다음 경기 출전, 선수 숙련도 또는 코칭스태프 의도는 추정하지 않습니다.`,
    }];
  }).sort((left, right) => (
    right.observed_game_count - left.observed_game_count ||
    (right.topic.approved_claims.find((claim) => claim.metric === "demand_velocity")?.value ?? 0) -
      (left.topic.approved_claims.find((claim) => claim.metric === "demand_velocity")?.value ?? 0) ||
    left.topic.radar_rank - right.topic.radar_rank ||
    left.topic.candidate_id.localeCompare(right.topic.candidate_id)
  ));
}
