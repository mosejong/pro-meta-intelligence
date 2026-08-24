import type { OpponentTeam, RadarEntry, RadarReport, ScheduleSnapshot } from "./radar-types";
import { scoreOpponent } from "./team-context";
import { buildTeamBrief } from "./team-brief";

export type EmergencyQuality = "USABLE_WITH_LIMITS" | "LOW_SAMPLE" | "INCOMPLETE_EVIDENCE";

type BriefAlert = {
  type: "PICK" | "BAN" | "ROTATION";
  title: string;
  detail: string;
  evidence_ids: string[];
};

export type EmergencyBrief = {
  schema_version: "1";
  artifact_type: "match-day-emergency-brief";
  patch_id: string;
  cutoff: string;
  read_time_minutes: 3;
  opponent: {
    team_id: string;
    team_name: string;
    leagues: string[];
    game_count: number;
    evidence_quality: EmergencyQuality;
    quality_flags: string[];
  };
  own_team?: {
    team_id: string;
    team_name: string;
    leagues: string[];
    game_count: number;
  };
  priority_context?: {
    score: number;
    tier: "P1" | "P2" | "P3";
    shared_leagues: string[];
    contested_picks: string[];
    reasons: string[];
    schedule_urgency: number;
    next_meeting: {
      event_id: string;
      start_at: string;
      league: string;
      block: string;
      best_of: number | null;
    } | null;
  };
  headline: string;
  alerts: BriefAlert[];
  meta_overlaps: Array<{
    champion_id: string;
    role: string;
    opponent_game_rate: number;
    opponent_phase_1_count: number;
    radar_rank: number;
    radar_eligible: boolean;
    demand_velocity: number;
    review_level: "HIGH_REVIEW" | "REVIEW" | "CONTEXT_ONLY";
    evidence_ids: string[];
  }>;
  patch_review_queue: Array<{
    champion_id: string;
    role: string;
    decision: string;
    practice_question: string;
    counter_evidence: string;
    evidence_ids: string[];
  }>;
  staff_questions: string[];
  unknowns: string[];
  evidence: {
    opponent_match_ids: string[];
    opponent_draft_event_ids: string[];
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  boundary: string;
};

function rate(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function roleName(role: string) {
  const labels: Record<string, string> = {
    TOP: "탑",
    JUNGLE: "정글",
    MID: "미드",
    BOTTOM: "바텀",
    SUPPORT: "서포터",
  };
  return labels[role] ?? role;
}

function evidenceQuality(team: OpponentTeam): EmergencyQuality {
  if (team.quality_flags.includes("INCOMPLETE_BAN_EVIDENCE")) return "INCOMPLETE_EVIDENCE";
  if (team.quality_flags.includes("LOW_MATCH_SAMPLE")) return "LOW_SAMPLE";
  return "USABLE_WITH_LIMITS";
}

function radarKey(championId: string, role: string) {
  return `${championId}::${role}`;
}

function buildAlerts(team: OpponentTeam): BriefAlert[] {
  const alerts: BriefAlert[] = [];
  const pick = team.priority_picks[0];
  if (pick) {
    alerts.push({
      type: "PICK",
      title: `${pick.champion_id} ${roleName(pick.role ?? "UNKNOWN")} 우선 확인`,
      detail: `${team.game_count}경기 중 ${pick.game_count}경기(${rate(pick.game_rate)})에서 가져갔고, 1페이즈에 ${pick.phase_1_count}회 등장했습니다.`,
      evidence_ids: pick.evidence_event_ids,
    });
  }
  const ban = team.frequent_bans[0];
  const received = team.received_bans[0];
  if (ban || received) {
    alerts.push({
      type: "BAN",
      title: "밴 예산의 방향을 분리해 확인",
      detail: `상대가 자주 밴한 챔피언은 ${ban?.champion_id ?? "표본 없음"}, 상대에게 자주 들어온 밴은 ${received?.champion_id ?? "표본 없음"}입니다. 대상 밴이라는 인과는 확정하지 않습니다.`,
      evidence_ids: [...(ban?.evidence_event_ids ?? []), ...(received?.evidence_event_ids ?? [])],
    });
  }
  const rotation = team.first_rotations[0];
  if (rotation) {
    alerts.push({
      type: "ROTATION",
      title: `${rotation.side} 1차 로테이션 응답 점검`,
      detail: `${rotation.champions.join(" → ")} 순서가 ${rotation.game_count}회 관측됐습니다. 반복 횟수 이상의 의도는 추정하지 않습니다.`,
      evidence_ids: rotation.evidence_match_ids,
    });
  }
  return alerts;
}

function metaOverlaps(report: RadarReport, team: OpponentTeam) {
  const radarEntries = new Map<string, RadarEntry>(
    report.entries.map((entry) => [radarKey(entry.champion_id, entry.role), entry]),
  );
  return team.priority_picks
    .flatMap((pick) => {
      if (!pick.role) return [];
      const entry = radarEntries.get(radarKey(pick.champion_id, pick.role));
      if (!entry) return [];
      return [{
        champion_id: pick.champion_id,
        role: pick.role,
        opponent_game_rate: pick.game_rate,
        opponent_phase_1_count: pick.phase_1_count,
        radar_rank: entry.rank,
        radar_eligible: entry.eligible_for_review,
        demand_velocity: entry.metrics.demand_velocity,
        review_level: (
          entry.eligible_for_review && entry.rank <= 10
            ? "HIGH_REVIEW"
            : entry.eligible_for_review
              ? "REVIEW"
              : "CONTEXT_ONLY"
        ) as "HIGH_REVIEW" | "REVIEW" | "CONTEXT_ONLY",
        evidence_ids: Array.from(new Set([...pick.evidence_event_ids, ...entry.evidence_event_ids])).sort(),
      }];
    })
    .sort((left, right) => left.radar_rank - right.radar_rank || right.opponent_game_rate - left.opponent_game_rate)
    .slice(0, 3);
}

function staffQuestions(team: OpponentTeam, overlaps: ReturnType<typeof metaOverlaps>, myTeam?: OpponentTeam) {
  const pick = team.priority_picks[0];
  const ban = team.frequent_bans[0];
  const received = team.received_bans[0];
  const rotation = team.first_rotations[0];
  const ownPickKeys = new Set(myTeam?.priority_picks.map((item) => radarKey(item.champion_id, item.role ?? "UNKNOWN")) ?? []);
  const contested = team.priority_picks.filter((item) => ownPickKeys.has(radarKey(item.champion_id, item.role ?? "UNKNOWN")));
  return [
    pick
      ? `${pick.champion_id} 1페이즈 오픈 시 우리 응답 순서와 허용 가능한 교환은 무엇인가?`
      : "반복 픽 표본이 없을 때 어떤 기본 메타 응답을 유지할 것인가?",
    `상대의 ${ban?.champion_id ?? "표본 부족"} 밴과 ${received?.champion_id ?? "표본 부족"} 피밴을 구분하면 우리 밴 예산은 달라지는가?`,
    rotation
      ? `${rotation.champions.join(" → ")} 관측 순서가 다시 나오면 어느 시점에 계획을 전환할 것인가?`
      : "관측된 1차 로테이션이 없을 때 어떤 정보가 들어오기 전까지 기본 계획을 유지할 것인가?",
    contested.length
      ? `${myTeam?.team_name ?? "우리 팀"}과 ${contested.slice(0, 2).map((item) => item.champion_id).join(" / ")} 우선순위가 충돌한다. 선픽·교환·밴 중 어느 자원을 먼저 쓸 것인가?`
      : overlaps.length
      ? `${overlaps.map((item) => item.champion_id).join(" / ")}의 상대 선호와 글로벌 상승 신호가 겹친다. 표본 외에 추가 확인할 맥락은 무엇인가?`
      : "상대 선호와 글로벌 상승 신호의 직접 교집합이 없다. 억지로 연결하지 않고 무엇을 별도 추적할 것인가?",
  ];
}

function unknowns(team: OpponentTeam, myTeam?: OpponentTeam) {
  const items = [
    myTeam
      ? `${myTeam.team_name}의 공개 경기 성향만 연결했습니다. 선수 숙련도, 스크림 결과와 실제 밴픽 계획은 연결되지 않았습니다.`
      : "우리 팀 선수 숙련도, 스크림 결과와 실제 밴픽 계획은 연결되지 않았습니다.",
    "공개 경기의 밴 기록만으로 특정 선수나 전략을 겨냥한 의도를 확정할 수 없습니다.",
  ];
  if (team.quality_flags.includes("LOW_MATCH_SAMPLE")) {
    items.push("동일 패치 경기 표본이 3경기 미만이므로 빈도를 안정적인 성향으로 보지 않습니다.");
  }
  if (team.quality_flags.includes("INCOMPLETE_BAN_EVIDENCE")) {
    items.push("선택 경기 중 일부 밴 값이 누락되어 밴 빈도가 실제보다 낮을 수 있습니다.");
  }
  return items;
}

export function buildEmergencyBrief(
  report: RadarReport,
  team: OpponentTeam,
  myTeam?: OpponentTeam,
  schedule?: ScheduleSnapshot | null,
  referenceAt?: string | null,
): EmergencyBrief {
  const overlaps = metaOverlaps(report, team);
  const priority = myTeam && myTeam.team_id !== team.team_id
    ? scoreOpponent(report, myTeam, team, schedule, referenceAt)
    : null;
  const topPick = team.priority_picks[0];
  const patchQueue = buildTeamBrief(report, 3).map((card) => ({
    champion_id: card.entry.champion_id,
    role: card.entry.role,
    decision: card.decisionLabel,
    practice_question: card.practiceQuestion,
    counter_evidence: card.counterEvidence,
    evidence_ids: card.entry.evidence_event_ids,
  }));
  return {
    schema_version: "1",
    artifact_type: "match-day-emergency-brief",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    read_time_minutes: 3,
    opponent: {
      team_id: team.team_id,
      team_name: team.team_name,
      leagues: team.leagues,
      game_count: team.game_count,
      evidence_quality: evidenceQuality(team),
      quality_flags: team.quality_flags,
    },
    ...(myTeam ? {
      own_team: {
        team_id: myTeam.team_id,
        team_name: myTeam.team_name,
        leagues: myTeam.leagues,
        game_count: myTeam.game_count,
      },
    } : {}),
    ...(priority ? {
      priority_context: {
        score: priority.score,
        tier: priority.tier,
        shared_leagues: priority.shared_leagues,
        contested_picks: priority.contested_picks.map((item) => `${item.champion_id}::${item.role ?? "UNKNOWN"}`),
        reasons: priority.reasons,
        schedule_urgency: priority.components.schedule_urgency,
        next_meeting: priority.next_meeting ? {
          event_id: priority.next_meeting.event_id,
          start_at: priority.next_meeting.start_at,
          league: priority.next_meeting.league,
          block: priority.next_meeting.block,
          best_of: priority.next_meeting.best_of,
        } : null,
      },
    } : {}),
    headline: topPick
      ? `${myTeam ? `${myTeam.team_name} 기준 · ` : ""}${team.team_name}: ${topPick.champion_id} ${roleName(topPick.role ?? "UNKNOWN")} 우선순위와 밴 방향을 먼저 검토`
      : `${myTeam ? `${myTeam.team_name} 기준 · ` : ""}${team.team_name}: 반복 픽 표본 부족, 기본 메타 계획 유지`,
    alerts: buildAlerts(team),
    meta_overlaps: overlaps,
    patch_review_queue: patchQueue,
    staff_questions: staffQuestions(team, overlaps, myTeam),
    unknowns: unknowns(team, myTeam),
    evidence: {
      opponent_match_ids: team.evidence.match_ids,
      opponent_draft_event_ids: team.evidence.draft_event_ids,
      source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
    },
    boundary: "Public evidence review aid, not an automatic draft recommendation or claim about private team intent.",
  };
}
