import { championKey } from "./champion-roles";
import type { SeasonHistory } from "./player-season-history";
import type { OpponentTeam, RadarReport } from "./radar-types";
import { soloRoleCandidates } from "./solo-role-candidates";

/** Evidence labels are not strength ratings or a counterpick model. Missing lists stay unknown. */
export function draftCandidateEvidence(report: RadarReport, team: OpponentTeam, id: string, history?: SeasonHistory | null) {
  const same = (value: string) => championKey(value) === championKey(id);
  const current = soloRoleCandidates(team, report).find(row => same(row.champion_id));
  const expanded = soloRoleCandidates(team, report, history).find(row => same(row.champion_id));
  const meta = report.entries.filter(row => same(row.champion_id) && row.eligible_for_review);
  const teamObserved = !!current;
  const seasonObserved = !!expanded?.season;
  const metaEligible = meta.length > 0;
  const category = metaEligible ? "META" : teamObserved || seasonObserved ? "OFF_META" : "EXPLORATORY";
  return {
    category,
    label: category === "META" ? "메타 검토 후보" : category === "OFF_META" ? "메타 밖 검토 후보" : "탐색 후보 · 근거 미확인",
    teamObserved,
    seasonObserved,
    metaEligible,
    roles: [...new Set([...(expanded?.roles ?? []), ...meta.map(row => row.role === "ADC" ? "BOTTOM" : row.role)])].sort(),
    boundary: category === "META" ? "레이더 표본 기준을 통과한 후보입니다. 해당 선수의 사용 경험이나 상성 우위를 뜻하지 않습니다." :
      "메타 밖 선택을 막지 않습니다. 조커픽 효과·상성·조합 우위는 검증되지 않았습니다.",
  };
}
