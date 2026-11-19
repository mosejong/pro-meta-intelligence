import type { DraftSelection } from "./draft-agent";
import { roleLabel } from "./champion-roles";
import type { RosterRole } from "./roster-scenario";
import type { SoloDraftEvidence, SoloDraftExplainedChoice, SoloDraftExplanation } from "./solo-draft";
import "./solo-draft-explanation.css";

/** In-memory record of the last real auto choice; never persisted or shared. */
export type SoloAutoRecord = {
  turn: number;
  champion_id: string;
  reason: string;
  /** Champion ids of the selections before this choice (the "just before" state). */
  prefix: string[];
  context: string;
  explanation: SoloDraftExplanation | null;
};

export function soloAutoContext(blueId: string | undefined, redId: string | undefined, firstPickSide: string, manualSide: string, previousPicks: string[]): string {
  return JSON.stringify([blueId ?? "", redId ?? "", firstPickSide, manualSide, previousPicks]);
}

/** True only when the current draft still contains this choice on top of the same prefix/context. */
export function soloAutoRecordMatches(record: SoloAutoRecord | null, selections: DraftSelection[], context: string): record is SoloAutoRecord {
  if (!record || record.context !== context || selections.length < record.turn || record.prefix.length !== record.turn - 1) return false;
  const chosen = selections[record.turn - 1];
  if (!chosen || chosen.turn !== record.turn || chosen.champion_id !== record.champion_id) return false;
  return record.prefix.every((id, index) => selections[index]?.champion_id === id);
}

const evidenceLabel = (evidence: SoloDraftEvidence, team: string): string => ({
  TEAM_PRIORITY: `${team}의 공개 우선 픽 기록`,
  PLAYER_CURRENT: `${team} 현재 관측 선수의 공개 기록`,
  PLAYER_SEASON: "같은 팀 현재 관측 선수 시즌 기록",
  RADAR_META: "현재 레이더 검토 가능 메타",
  RADAR_FRAME: "공개 레이더 후보",
  FALLBACK: "대체 규칙: 사용할 기록 후보 없음 · 고정 챔피언 목록 순서",
})[evidence];

function ChoiceLine({ choice, kind, team, nameOf }: { choice: SoloDraftExplainedChoice; kind: "BAN" | "PICK"; team: string; nameOf: (id: string) => string }) {
  const roles = choice.inferred_roles.map(role => roleLabel[role as RosterRole] ?? role);
  return <>
    <strong>{nameOf(choice.champion_id)}</strong> · {evidenceLabel(choice.evidence, team)}
    {kind === "PICK" && <> · {roles.length ? `기록에서 추론한 포지션 후보 ${roles.join("/")}` : "추론 포지션 근거 없음"}</>}
    {kind === "PICK" && choice.role_supported === false && <> · <em>포지션 근거 부족: 조합 구성을 보장하지 않음</em></>}
  </>;
}

const teamLabel = (e: SoloDraftExplanation) => `${e.record_scope === "OPPOSING_TEAM" ? "상대 팀" : "행동 팀"}(${e.record_team})`;

/** One-line summary of a recorded auto choice (shared by the last-choice line and the review list). */
export function SoloAutoSummary({ record }: { record: SoloAutoRecord }) {
  const e = record.explanation;
  // With an explanation, the summary is derived from the evidence that actually produced the choice;
  // the legacy suggestion reason (unchanged API) is only shown when no explanation exists.
  return e
    ? <>연습 {e.kind === "BAN" ? "밴" : "픽"} · 근거: {evidenceLabel(e.selected.evidence, teamLabel(e))}. 실제 선택을 예측하지 않습니다.
        {e.selected.evidence === "PLAYER_SEASON" && " 시즌 기록은 현재 패치의 강함을 뜻하지 않습니다."}
        {e.kind === "PICK" && e.selected.role_supported === false && <> <em>포지션 근거 부족: 조합 구성을 보장하지 않음</em></>}</>
    : <>{record.reason}</>;
}

export function SoloDraftExplanationPanel({ record, nameOf }: { record: SoloAutoRecord; nameOf: (id: string) => string }) {
  const e = record.explanation;
  return <div className="solo-explain">
    <p className="solo-draft-last" role="status">마지막 상대 선택 · {nameOf(record.champion_id)} · <SoloAutoSummary record={record} /></p>
    {e && <details>
      <summary>선택 이유와 다른 후보</summary>
      <SoloDraftExplanationBody explanation={e} nameOf={nameOf} />
    </details>}
  </div>;
}

/** Read-only body of a frozen pre-choice explanation. */
export function SoloDraftExplanationBody({ explanation: e, nameOf }: { explanation: SoloDraftExplanation; nameOf: (id: string) => string }) {
  const team = teamLabel(e);
  // Evidence that actually produced the shown candidates; lookup targets without rows are not listed here.
  const used = [...new Set([e.selected, ...e.alternatives].map(c => c.evidence))].filter(x => x !== "FALLBACK");
  if (e.kind === "PICK" && e.season_evidence && !used.includes("PLAYER_SEASON")) used.push("PLAYER_SEASON");
  return <>
      <p>{e.turn}번째 차례({e.kind === "BAN" ? "밴" : "픽"}) 선택 직전 상태 기준입니다. 연습용 규칙 설명이며 실제 대응·상성 우위·승률 예측이 아닙니다.</p>
      <p>확인 대상(조회 범위이며 선택 순서가 아님) · {team} 공개 우선 픽 기록 · {e.kind === "PICK" ? "현재 레이더 메타 · 현재 관측 선수 기록 · 기준이 맞는 현재 선수 시즌 기록" : "공개 레이더 후보"}</p>
      <p>근거 범위 · {used.length ? used.map(x => evidenceLabel(x, team)).join(" · ") : "사용할 수 있는 기록 없음"}</p>
      {e.kind === "PICK" && !e.season_evidence && <p>기준이 맞는 시즌 선수 기록을 확인하지 못해(미수신·기준 불일치·선수 미일치 포함) 시즌 기록은 반영되지 않았습니다. 시즌 사용 경험이 없다는 뜻이 아닙니다.</p>}
      {e.kind === "PICK" && <p>포지션은 공개 기록에서 추론한 후보이며 사용자가 지정한 포지션이 아닙니다.</p>}
      <p>선택 · <ChoiceLine choice={e.selected} kind={e.kind} team={team} nameOf={nameOf} /></p>
      {e.alternatives.length ? <>
        <p>같은 직전 상태에서 앞 후보를 제외하면 같은 규칙이 고르는 합법 후보</p>
        <ol>{e.alternatives.map(choice => <li key={choice.champion_id}><ChoiceLine choice={choice} kind={e.kind} team={team} nameOf={nameOf} /></li>)}</ol>
      </> : <p>같은 규칙으로 고를 다른 합법 후보가 없습니다.</p>}
  </>;
}
