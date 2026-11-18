import { championAssetId } from "./champion-assets";
import { applyDraftSelection, buildDraftAgentFrame, nextDraftTurn, type DraftSelection, type DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import type { SeasonHistory } from "./player-season-history";
import { soloRoleCandidates, canCoverRoles } from "./solo-role-candidates";
import { SHARE_CHAMPIONS } from "./share-champion-ids";

export type SoloDraftSuggestion = {
  champion_id: string;
  role_supported?: boolean;
  reason: string;
  source: "TEAM_RECORD" | "PLAYER_SEASON" | "RADAR" | "FALLBACK";
};

export type SoloDraftInput = {
  seasonHistory?: SeasonHistory | null;
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  selections: DraftSelection[];
  previousPicks: string[];
  firstPickSide: DraftSide;
  manualSide: DraftSide;
};

const canonicalIds = new Map(SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
function canonical(value: unknown): string | undefined {
  return typeof value === "string" ? canonicalIds.get(championAssetId(value).toLowerCase()) : undefined;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const observedRoles = new Set(["TOP", "JUNGLE", "MID", "BOTTOM", "ADC", "SUPPORT"]);

/** Deterministic public-record practice opponent; does not assign champion roles. */
export function suggestSoloDraftTurn(input: SoloDraftInput): SoloDraftSuggestion | null {
  const { report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide } = input;
  if (!blueTeam || !redTeam || !blueTeam.team_id || !redTeam.team_id || blueTeam.team_id === redTeam.team_id ||
    !["BLUE", "RED"].includes(firstPickSide) || !["BLUE", "RED"].includes(manualSide) ||
    !Array.isArray(selections) || selections.length > 20 || !Array.isArray(previousPicks)) return null;
  const locks = previousPicks.map(canonical);
  if (locks.some(id => !id)) return null;
  const previous = locks as string[];
  let replay: DraftSelection[] = [];
  for (const selection of selections) {
    const expected = nextDraftTurn(replay, firstPickSide);
    const id = canonical(selection?.champion_id);
    if (!expected || !id || selection.turn !== replay.length + 1 || selection.side !== expected.side ||
      selection.kind !== expected.kind || selection.phase !== expected.phase || selection.slot !== expected.slot) return null;
    const next = applyDraftSelection(replay, id, previous, firstPickSide);
    if (next === replay) return null;
    replay = next;
  }
  const turn = nextDraftTurn(replay, firstPickSide);
  if (!turn || turn.side === manualSide) return null;
  const acting = turn.side === "BLUE" ? blueTeam : redTeam;
  const opposing = turn.side === "BLUE" ? redTeam : blueTeam;
  const target = turn.kind === "BAN" ? opposing : acting;
  const available = (id: string) => applyDraftSelection(replay, id, previous, firstPickSide) !== replay;
  const frame = buildDraftAgentFrame(report, blueTeam, redTeam, replay, previous, firstPickSide);
  const priorities = [...target.priority_picks].sort((a, b) => b.game_rate - a.game_rate ||
    b.phase_1_count - a.phase_1_count || compare(canonical(a.champion_id) ?? a.champion_id, canonical(b.champion_id) ?? b.champion_id));
  const priorityIds = new Set(priorities.map(p => canonical(p.champion_id)).filter(Boolean));

  // A strict hint requires all observed team rows to agree on one recognized role.
  const strictRole = (id: string): string | null => {
    const rows = acting.priority_picks.filter(p => canonical(p.champion_id) === id);
    const roles = new Set(rows.map(p => p.role === "ADC" ? "BOTTOM" : p.role));
    const role = rows[0]?.role === "ADC" ? "BOTTOM" : rows[0]?.role;
    return roles.size === 1 && role && observedRoles.has(role) ? role : null;
  };
  const covered = new Set(replay.filter(s => s.side === turn.side && s.kind === "PICK").map(s => strictRole(s.champion_id)).filter(Boolean));
  const repeatsRole = (id: string) => { const role = strictRole(id); return role !== null && covered.has(role); };
  const records = [...new Set([
    ...frame.options.map(o => canonical(o.champion_id)).filter((id): id is string => !!id && priorityIds.has(id)),
    ...priorities.map(p => canonical(p.champion_id)).filter((id): id is string => !!id),
  ])].filter(available);
  const roleCandidates = soloRoleCandidates(acting, report, input.seasonHistory);
  const picked = replay.filter(s => s.side === turn.side && s.kind === "PICK").map(s => s.champion_id);
  const candidateById = new Map(roleCandidates.map(row => [row.champion_id, row]));
  const metaRows = report.entries.filter(e => e.eligible_for_review).sort((a, b) => a.rank - b.rank || compare(a.champion_id, b.champion_id));
  const metaIds = [...new Set(metaRows.map(e => canonical(e.champion_id)).filter((id): id is string => !!id))];
  const metaSet = new Set(metaIds);
  const rolePool = [...roleCandidates, ...metaRows.flatMap(e => {
    const id = canonical(e.champion_id), role = e.role === "ADC" ? "BOTTOM" : e.role;
    return id && observedRoles.has(role) ? [{ champion_id: id, roles: [role as import("./roster-scenario").RosterRole], score: 0, season: false }] : [];
  })];
  // Current review-eligible meta first; season familiarity is a separate fallback, never patch strength.
  const expanded = [...new Set([...records.filter(id => metaSet.has(id)), ...metaIds, ...records, ...roleCandidates.map(row => row.champion_id)])].filter(available);
  const roleFeasible = (id: string) => canCoverRoles(picked, rolePool, id);
  const record = turn.kind === "PICK" ? expanded.find(roleFeasible) ?? records.find(id => !repeatsRole(id)) ?? expanded[0] : records[0];
  const finish = (choice: SoloDraftSuggestion): SoloDraftSuggestion => {
    if (turn.kind !== "PICK") return choice;
    const supported = roleFeasible(choice.champion_id);
    return { ...choice, role_supported: supported, reason: supported ? choice.reason : `${choice.reason} 남은 후보의 포지션 근거가 부족해 조합 구성을 보장하지 않습니다.` };
  };
  if (record && turn.kind === "PICK" && metaSet.has(record) && !priorityIds.has(record)) return finish({
    champion_id: record, source: "RADAR", reason: "현재 레이더의 검토 가능 메타와 남은 포지션을 참고한 연습 픽입니다. 선수의 실제 선택을 예측하지 않습니다.",
  });
  if (record && turn.kind === "PICK" && candidateById.get(record)?.season) return finish({
    champion_id: record, source: "PLAYER_SEASON", reason: "현재 관측 선수의 같은 팀·시즌 역할별 기록과 남은 포지션을 참고한 연습 픽입니다. 시즌 기록은 현재 패치의 강함을 뜻하지 않습니다.",
  });
  if (record) return finish({ champion_id: record, source: "TEAM_RECORD", reason: turn.kind === "BAN"
    ? "상대 팀의 공개 우선 픽 기록을 바탕으로 한 연습 밴입니다."
    : "행동 팀의 공개 우선 픽 기록을 바탕으로 한 연습 픽입니다." });
  const radar = [...new Set([
    ...frame.options.map(o => canonical(o.champion_id)),
    ...report.entries.filter(e => e.eligible_for_review).sort((a, b) => a.rank - b.rank || compare(canonical(a.champion_id) ?? a.champion_id, canonical(b.champion_id) ?? b.champion_id)).map(e => canonical(e.champion_id)),
  ])].find((id): id is string => !!id && available(id));
  if (radar) return finish({ champion_id: radar, source: "RADAR", reason: "공개 레이더의 검토 가능 후보를 사용한 연습 선택입니다." });
  const fallback = [...canonicalIds.values()].sort(compare).find(available);
  return fallback ? finish({ champion_id: fallback, source: "FALLBACK", reason: "남은 기록 후보가 없어 고정 챔피언 목록 순서로 선택했습니다." }) : null;
}
