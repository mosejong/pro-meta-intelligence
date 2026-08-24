import type { OpponentChampionTendency, OpponentTeam, RadarEntry, RadarReport } from "./radar-types";
import type { OpponentPriority } from "./team-context";

export type BattlecardSignal = {
  champion_id: string;
  role: string | null;
  own_game_rate: number | null;
  opponent_pick_rate: number | null;
  opponent_ban_rate: number | null;
  opponent_phase_1_count: number;
  radar_rank: number | null;
  radar_eligible: boolean | null;
  observation: string;
  staff_question: string;
  evidence_ids: string[];
};

export type BattlecardExchange = {
  own: BattlecardSignal;
  opponent: BattlecardSignal;
  staff_question: string;
  evidence_ids: string[];
};

export type MatchupBattlecard = {
  schema_version: "1";
  artifact_type: "public-draft-battlecard";
  patch_id: string;
  cutoff: string;
  own_team: { team_id: string; team_name: string; game_count: number };
  opponent: { team_id: string; team_name: string; game_count: number };
  priority_context: {
    score: number;
    tier: "P1" | "P2" | "P3";
    next_meeting_at: string | null;
    reasons: string[];
  } | null;
  evidence_quality: "OBSERVED" | "LOW_SAMPLE" | "INCOMPLETE";
  protect: BattlecardSignal[];
  contested: BattlecardSignal[];
  deny_review: BattlecardSignal[];
  exchange: BattlecardExchange | null;
  unknowns: string[];
  evidence: {
    match_ids: string[];
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  boundary: string;
};

function pickKey(pick: Pick<OpponentChampionTendency, "champion_id" | "role">) {
  return `${pick.champion_id}::${pick.role ?? "UNKNOWN"}`;
}

function radarKey(championId: string, role: string | null | undefined) {
  return `${championId}::${role ?? "UNKNOWN"}`;
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function percent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function signal(
  pick: OpponentChampionTendency,
  options: {
    ownRate?: number | null;
    opponentPickRate?: number | null;
    opponentBanRate?: number | null;
    radar?: RadarEntry | null;
    observation: string;
    question: string;
    extraEvidence?: string[];
  },
): BattlecardSignal {
  return {
    champion_id: pick.champion_id,
    role: pick.role ?? null,
    own_game_rate: options.ownRate ?? null,
    opponent_pick_rate: options.opponentPickRate ?? null,
    opponent_ban_rate: options.opponentBanRate ?? null,
    opponent_phase_1_count: pick.phase_1_count,
    radar_rank: options.radar?.rank ?? null,
    radar_eligible: options.radar?.eligible_for_review ?? null,
    observation: options.observation,
    staff_question: options.question,
    evidence_ids: unique([
      ...pick.evidence_event_ids,
      ...(options.radar?.evidence_event_ids ?? []),
      ...(options.extraEvidence ?? []),
    ]),
  };
}

function evidenceQuality(report: RadarReport, ownTeam: OpponentTeam, opponent: OpponentTeam) {
  const minimumGames = report.opponent_prep?.config.minimum_games_for_review ?? 3;
  if (
    ownTeam.quality_flags.includes("INCOMPLETE_BAN_EVIDENCE") ||
    opponent.quality_flags.includes("INCOMPLETE_BAN_EVIDENCE")
  ) return "INCOMPLETE" as const;
  if (
    ownTeam.game_count < minimumGames ||
    opponent.game_count < minimumGames ||
    ownTeam.quality_flags.includes("LOW_MATCH_SAMPLE") ||
    opponent.quality_flags.includes("LOW_MATCH_SAMPLE")
  ) return "LOW_SAMPLE" as const;
  return "OBSERVED" as const;
}

export function buildMatchupBattlecard(
  report: RadarReport,
  ownTeam: OpponentTeam,
  opponent: OpponentTeam,
  priority?: OpponentPriority | null,
): MatchupBattlecard {
  const ownPicks = new Map(ownTeam.priority_picks.map((pick) => [pickKey(pick), pick]));
  const opponentPicks = new Map(opponent.priority_picks.map((pick) => [pickKey(pick), pick]));
  const opponentBans = new Map(opponent.frequent_bans.map((pick) => [pick.champion_id, pick]));
  const radar = new Map(report.entries.map((entry) => [radarKey(entry.champion_id, entry.role), entry]));

  const contested = opponent.priority_picks
    .flatMap((pick) => {
      const ownPick = ownPicks.get(pickKey(pick));
      if (!ownPick) return [];
      const entry = radar.get(pickKey(pick));
      return [signal(pick, {
        ownRate: ownPick.game_rate,
        opponentPickRate: pick.game_rate,
        radar: entry,
        extraEvidence: ownPick.evidence_event_ids,
        observation: `${ownTeam.team_name} ${percent(ownPick.game_rate)} · ${opponent.team_name} ${percent(pick.game_rate)}에서 같은 역할로 관측`,
        question: `양 팀이 ${pick.champion_id} ${pick.role ?? "역할 미상"}을 원할 때 선픽, 교환, 포기 중 어느 조건을 선택할지 정했는가?`,
      })];
    })
    .sort((left, right) => (
      ((right.own_game_rate ?? 0) + (right.opponent_pick_rate ?? 0)) -
      ((left.own_game_rate ?? 0) + (left.opponent_pick_rate ?? 0)) ||
      left.champion_id.localeCompare(right.champion_id)
    ))
    .slice(0, 3);

  const protect = ownTeam.priority_picks
    .flatMap((pick) => {
      const ban = opponentBans.get(pick.champion_id);
      if (!ban) return [];
      const entry = radar.get(pickKey(pick));
      return [signal(pick, {
        ownRate: pick.game_rate,
        opponentBanRate: ban.game_rate,
        radar: entry,
        extraEvidence: ban.evidence_event_ids,
        observation: `${ownTeam.team_name} 픽 ${percent(pick.game_rate)} · ${opponent.team_name} 밴 ${percent(ban.game_rate)}로 관측`,
        question: `${pick.champion_id}이 닫힐 때 대체 픽과 조합 우선순위가 유지되는지 확인했는가?`,
      })];
    })
    .sort((left, right) => (
      ((right.own_game_rate ?? 0) + (right.opponent_ban_rate ?? 0)) -
      ((left.own_game_rate ?? 0) + (left.opponent_ban_rate ?? 0)) ||
      left.champion_id.localeCompare(right.champion_id)
    ))
    .slice(0, 3);

  const contestedKeys = new Set(contested.map((item) => radarKey(item.champion_id, item.role)));
  const denyReview = opponent.priority_picks
    .filter((pick) => !contestedKeys.has(pickKey(pick)))
    .map((pick) => {
      const entry = radar.get(pickKey(pick));
      return signal(pick, {
        opponentPickRate: pick.game_rate,
        radar: entry,
        observation: `${opponent.team_name} 픽 ${percent(pick.game_rate)} · 1페이즈 ${pick.phase_1_count}회${entry ? ` · 글로벌 레이더 #${entry.rank}` : ""}`,
        question: `${pick.champion_id}을 밴할지 단정하기 전에 오픈 시 응답과 허용 가능한 교환을 검증했는가?`,
      });
    })
    .sort((left, right) => {
      const leftRadar = left.radar_eligible ? Math.max(0, 51 - (left.radar_rank ?? 51)) : 0;
      const rightRadar = right.radar_eligible ? Math.max(0, 51 - (right.radar_rank ?? 51)) : 0;
      return (
        ((right.opponent_pick_rate ?? 0) * 100 + right.opponent_phase_1_count * 4 + rightRadar) -
        ((left.opponent_pick_rate ?? 0) * 100 + left.opponent_phase_1_count * 4 + leftRadar) ||
        left.champion_id.localeCompare(right.champion_id)
      );
    })
    .slice(0, 3);

  const ownExchangePick = ownTeam.priority_picks.find((pick) => !opponentPicks.has(pickKey(pick))) ?? null;
  const opponentExchangePick = opponent.priority_picks.find((pick) => !ownPicks.has(pickKey(pick))) ?? null;
  const exchange = ownExchangePick && opponentExchangePick
    ? (() => {
      const ownSignal = signal(ownExchangePick, {
        ownRate: ownExchangePick.game_rate,
        radar: radar.get(pickKey(ownExchangePick)),
        observation: `${ownTeam.team_name}에서 ${percent(ownExchangePick.game_rate)} 관측`,
        question: `${ownExchangePick.champion_id} 확보 조건을 유지할 수 있는가?`,
      });
      const opponentSignal = signal(opponentExchangePick, {
        opponentPickRate: opponentExchangePick.game_rate,
        radar: radar.get(pickKey(opponentExchangePick)),
        observation: `${opponent.team_name}에서 ${percent(opponentExchangePick.game_rate)} 관측`,
        question: `${opponentExchangePick.champion_id} 허용 시 준비한 응답이 있는가?`,
      });
      return {
        own: ownSignal,
        opponent: opponentSignal,
        staff_question: `${ownSignal.champion_id} 확보와 ${opponentSignal.champion_id} 허용을 맞바꾸는 시나리오가 실제 조합과 사이드 조건에서도 성립하는가?`,
        evidence_ids: unique([...ownSignal.evidence_ids, ...opponentSignal.evidence_ids]),
      };
    })()
    : null;

  const matchIds = unique([...ownTeam.evidence.match_ids, ...opponent.evidence.match_ids]);
  return {
    schema_version: "1",
    artifact_type: "public-draft-battlecard",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    own_team: { team_id: ownTeam.team_id, team_name: ownTeam.team_name, game_count: ownTeam.game_count },
    opponent: { team_id: opponent.team_id, team_name: opponent.team_name, game_count: opponent.game_count },
    priority_context: priority ? {
      score: priority.score,
      tier: priority.tier,
      next_meeting_at: priority.next_meeting?.start_at ?? null,
      reasons: priority.reasons,
    } : null,
    evidence_quality: evidenceQuality(report, ownTeam, opponent),
    protect,
    contested,
    deny_review: denyReview,
    exchange,
    unknowns: [
      "선수별 실제 챔피언 숙련도와 현재 컨디션은 공개 경기 집계에 포함되지 않았습니다.",
      "스크림 결과, 내부 우선순위와 당일 밴픽 계획은 연결되지 않았습니다.",
      "밴 빈도는 관측 사실이며 특정 선수나 전략을 겨냥했다는 의도는 추정하지 않습니다.",
    ],
    evidence: {
      match_ids: matchIds,
      source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
    },
    boundary: "Public draft evidence for staff review. This battlecard does not recommend an automatic pick or ban.",
  };
}
