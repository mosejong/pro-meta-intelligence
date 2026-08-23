import type { RadarEntry, RadarReport } from "./radar-types";

export type TeamDecision = "PRIORITY_REVIEW" | "WATCH" | "HOLD";

export type TeamDecisionCard = {
  entry: RadarEntry;
  decision: TeamDecision;
  decisionLabel: string;
  reason: string;
  counterEvidence: string;
  practiceQuestion: string;
  stopCondition: string;
};

function percentagePoint(value: number) {
  const amount = value * 100;
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toFixed(1)}pp`;
}

function regionName(region: string | null) {
  const labels: Record<string, string> = {
    BRAZIL: "브라질",
    CHINA: "중국",
    EMEA: "유럽권",
    KOREA: "한국",
    LATIN_AMERICA: "라틴",
    NORTH_AMERICA: "북미",
    PACIFIC: "태평양권",
  };
  return region ? (labels[region] ?? region) : null;
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

export function decisionFor(entry: RadarEntry): TeamDecision {
  if (!entry.eligible_for_review) return "HOLD";
  if (
    entry.metrics.demand_velocity >= 0.1 &&
    entry.metrics.pick_presence_delta > 0 &&
    entry.metrics.current_distinct_team_count >= 2
  ) return "PRIORITY_REVIEW";
  if (entry.metrics.demand_velocity > 0 || entry.metrics.pick_presence_delta > 0) return "WATCH";
  return "HOLD";
}

function counterEvidenceFor(entry: RadarEntry) {
  if (entry.quality_flags.length > 0) {
    return `품질 경고 ${entry.quality_flags.length}건이 남아 있어 숫자를 바로 전략 결론으로 쓰면 안 됩니다.`;
  }
  if (entry.metrics.team_concentration !== null && entry.metrics.team_concentration >= 0.5) {
    return `최근 픽의 ${(entry.metrics.team_concentration * 100).toFixed(0)}%가 한 팀에 집중되어 팀 특화 선택일 가능성이 있습니다.`;
  }
  const divergentRegion = regionName(entry.metrics.most_divergent_region);
  if (
    divergentRegion &&
    entry.metrics.regional_divergence !== null &&
    entry.metrics.regional_divergence >= 0.1
  ) {
    return `${divergentRegion} 편차가 ${(entry.metrics.regional_divergence * 100).toFixed(1)}pp로 커서 전 지역 공통 메타라고 단정할 수 없습니다.`;
  }
  return "공개 경기 채택만으로 조합 적합성, 선수 숙련도, 스크림 성공률은 확인할 수 없습니다.";
}

export function buildTeamDecisionCard(entry: RadarEntry): TeamDecisionCard {
  const decision = decisionFor(entry);
  const labels: Record<TeamDecision, string> = {
    PRIORITY_REVIEW: "우선 검토",
    WATCH: "추적",
    HOLD: "보류",
  };
  const region = regionName(entry.metrics.most_divergent_region);
  const regionContext = region ? ` ${region}의 편차 원인도 함께 확인합니다.` : "";

  return {
    entry,
    decision,
    decisionLabel: labels[decision],
    reason: `최근 ${entry.metrics.current_distinct_team_count}개 팀이 채택했고, 팀 수요 ${percentagePoint(entry.metrics.demand_velocity)} · 픽 점유율 ${percentagePoint(entry.metrics.pick_presence_delta)} 변화가 관측됐습니다.`,
    counterEvidence: counterEvidenceFor(entry),
    practiceQuestion: `${entry.champion_id} ${roleName(entry.role)}을 현재 주력 조합의 밴픽 순서를 무너뜨리지 않고 넣을 수 있는가?${regionContext}`,
    stopCondition: "두 번의 구조화된 테스트 후에도 픽 목적, 필요한 자원, 실패 시 복구 계획을 코칭스태프가 합의하지 못하면 이번 패치 큐에서 내립니다.",
  };
}

export function buildTeamBrief(report: RadarReport, limit = 5) {
  return report.entries
    .filter((entry) => entry.eligible_for_review)
    .slice(0, limit)
    .map(buildTeamDecisionCard);
}

export function serializeTeamBrief(report: RadarReport) {
  return {
    schema_version: "1",
    artifact_type: "team-decision-brief",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    boundary: "Public match evidence only. Player familiarity, scrim results, and team intent are not inferred.",
    decisions: buildTeamBrief(report).map(({ entry, ...card }) => ({
      champion_id: entry.champion_id,
      role: entry.role,
      rank: entry.rank,
      evidence_event_ids: entry.evidence_event_ids,
      ...card,
    })),
  };
}
