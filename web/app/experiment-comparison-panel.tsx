"use client";

import { useEffect, useRef, useState } from "react";
import { sameSimulationInput, type SimulationInputSnapshot } from "./simulation-scenario";
import { ASSUMPTION_FIELDS, CORE_TEAM_IDS, type AssumptionField, type ExperimentRun } from "./experiment-replay";
import { compareExperimentRuns, freezeBaseline, OUTCOME_STATS, type OutcomeStat } from "./experiment-comparison";
import { ExperimentBatchPanel } from "./experiment-batch-panel";
import { ExperimentComparisonSharePanel } from "./experiment-comparison-share-panel";
import "./experiment-comparison-panel.css";

type ExperimentComparisonPanelProps = {
  /** The replay panel's current frozen run (B candidate). */
  run: ExperimentRun;
  /** Minute of `run` currently on screen. */
  shownMinute: number;
  readyInput: SimulationInputSnapshot | null;
};

const fieldLabels: Record<AssumptionField, string> = { lane: "라인", tempo: "운영", teamfight: "한타" };
const statLabels: Record<OutcomeStat, string> = { gold: "모델 자원", kills: "모델 킬", objectives: "추상 오브젝트", base: "기지 내구도" };
const reasonLabel = { BASE_DESTROYED: "기지 내구도 0", TIME_LIMIT: "시간 제한" } as const;
const signed = (value: number) => value > 0 ? `+${value.toLocaleString("ko-KR")}` : value.toLocaleString("ko-KR");

/** Team label by source ID; the ID is added when two teams share a display name. */
function labeler(names: { sourceId: string; name: string }[]) {
  return (sourceId: string) => {
    const name = names.find((team) => team.sourceId === sourceId)?.name ?? sourceId;
    return names.filter((team) => team.name === name).length > 1 ? `${name} (${sourceId})` : name;
  };
}

/**
 * Optional A/B of two explicit assumption runs, collapsed by default. A lives only in this
 * component's memory; keeping, replacing or clearing it never changes the draft, run or playback.
 */
export function ExperimentComparisonPanel({ run, shownMinute, readyInput }: ExperimentComparisonPanelProps) {
  const [baseline, setBaseline] = useState<ExperimentRun | null>(null);
  const [message, setMessage] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const complete = shownMinute >= run.endMinute;
  const isBaseline = baseline?.runId === run.runId;

  // The pressed button may disappear; focus moves to the rendered status message instead of the page.
  useEffect(() => { if (focusRequest) statusRef.current?.focus(); }, [focusRequest]);

  function keep() {
    const kept = freezeBaseline(run, shownMinute);
    if (!kept.ok) { setMessage(kept.message); return; }
    setBaseline(kept.baseline);
    setMessage(`실행 #${kept.baseline.runId}을 기준 A로 보관했습니다. 가정값을 바꿔 새로 실행한 뒤 끝까지 재생하면 비교합니다.`);
    setFocusRequest((n) => n + 1);
  }
  function clear() {
    setBaseline(null);
    setMessage("기준 A를 해제했습니다. 현재 밴픽·실행·재생은 그대로입니다.");
    setFocusRequest((n) => n + 1);
  }

  const comparison = baseline && !isBaseline ? compareExperimentRuns(baseline, run, shownMinute) : null;
  const label = labeler(CORE_TEAM_IDS.map((core) => run.teams[core]));
  const baselineLabel = baseline ? labeler(CORE_TEAM_IDS.map((core) => baseline.teams[core])) : label;
  const bIsEarlier = readyInput ? !sameSimulationInput(run.snapshot, readyInput) : true;

  return <details className="experiment-comparison">
    <summary>가정 비교 (기준 A ↔ 실행 B){baseline ? ` · 기준 A 실행 #${baseline.runId}` : ""}</summary>
    <div className="experiment-comparison-body">
      <p className="experiment-comparison-boundary" role="note">같은 밴픽·로스터·역할·자료·재현 번호에서 가정값만 바꾼 두 실행의 <b>모델 내부 차이</b>입니다. 실제 승률·선수 기여도·인과 효과가 아니며, 두 실행은 이 브라우저 화면에만 있어 페이지를 떠나면 사라지며, 비교 요약 글만 복사할 수 있습니다.</p>

      <div className="experiment-comparison-actions">
        {!baseline && <button type="button" disabled={!complete} onClick={keep}>이 실행을 비교 기준 A로 보관</button>}
        {baseline && !isBaseline && <button type="button" disabled={!complete} onClick={keep}>현재 실행 #{run.runId}로 기준 A 바꾸기</button>}
        {baseline && <button type="button" onClick={clear}>기준 A 해제</button>}
      </div>
      {!complete && (!baseline || !isBaseline) && <p className="experiment-comparison-hint">현재 실행을 끝까지 재생하면 {baseline ? "기준을 바꾸거나 결과를 비교할" : "기준 A로 보관할"} 수 있습니다.</p>}
      <p ref={statusRef} tabIndex={-1} className="experiment-comparison-status" role="status">{message}</p>

      {baseline && <div className="experiment-comparison-baseline">
        <h4>기준 A · 실행 #{baseline.runId} · 재현 번호 {baseline.seed}</h4>
        <ul>{CORE_TEAM_IDS.map((core) => {
          const team = baseline.teams[core];
          return <li key={core}><b>{baselineLabel(team.sourceId)}</b> {ASSUMPTION_FIELDS.map((field) => `${fieldLabels[field]} ${team.assumptions[field]}`).join(" · ")}</li>;
        })}</ul>
      </div>}

      {baseline && isBaseline && <p className="experiment-comparison-hint">현재 실행이 기준 A입니다. 가정값을 바꾸고 같은 재현 번호로 새로 실행하면 실행 B로 비교합니다.</p>}

      {comparison && <section className="experiment-comparison-result" aria-label={`기준 A 실행 #${baseline!.runId}와 실행 B #${run.runId} 비교`}>
        <h4>실행 B · #{run.runId}{bIsEarlier ? " · 기존 실행끼리 비교 (B 실행 뒤 현재 밴픽 입력이 바뀌었습니다)" : ""}</h4>
        {!comparison.ok ? <div className="experiment-comparison-refused" role="alert">
          <p>같은 조건이 아니어서 비교하지 않습니다.</p>
          <ul>{comparison.refusals.map((refusal) => <li key={refusal.code}>{refusal.message}</li>)}</ul>
        </div> : <>
          <p className="experiment-comparison-kind">
            {comparison.changeKind === "NONE" ? "가정 변경 없음 · 같은 가정·재현 번호이므로 모델 결과 차이는 0입니다."
              : comparison.changeKind === "SINGLE" ? `가정 1개 변경: ${label(comparison.changes[0].sourceId)} ${fieldLabels[comparison.changes[0].field]} ${comparison.changes[0].a} → ${comparison.changes[0].b}`
              : `가정 ${comparison.changes.length}개 변경 · 여러 가정을 함께 바꿨으므로 차이를 한 가정 탓으로 나눌 수 없습니다.`}
          </p>
          <div className="experiment-comparison-scroll">
            <table>
              <caption>가정값 (A → B)</caption>
              <thead><tr><th scope="col">팀</th>{ASSUMPTION_FIELDS.map((field) => <th key={field} scope="col">{fieldLabels[field]}</th>)}</tr></thead>
              <tbody>{comparison.teams.map((team) => <tr key={team.sourceId} data-source-id={team.sourceId}>
                <th scope="row">{label(team.sourceId)}</th>
                {ASSUMPTION_FIELDS.map((field) => {
                  const cell = team.fields[field];
                  return <td key={field} data-changed={cell.changed || undefined}>{cell.changed ? `${cell.a} → ${cell.b}` : `${cell.a} (같음)`}</td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
          {comparison.outcome ? <div className="experiment-comparison-scroll">
            <table data-testid="experiment-comparison-outcome">
              <caption>가정에 따른 모델 내부 차이 (B − A)</caption>
              <thead><tr><th scope="col">팀</th>{OUTCOME_STATS.map((stat) => <th key={stat} scope="col">{statLabels[stat]}</th>)}</tr></thead>
              <tbody>{comparison.outcome.teams.map((team) => <tr key={team.sourceId} data-source-id={team.sourceId}>
                <th scope="row">{label(team.sourceId)}</th>
                {OUTCOME_STATS.map((stat) => <td key={stat} data-stat={stat}>{team.a[stat].toLocaleString("ko-KR")} → {team.b[stat].toLocaleString("ko-KR")} <small>({signed(team.delta[stat])})</small></td>)}
              </tr>)}</tbody>
            </table>
            <p>모델 종료: A {comparison.outcome.end.a.minute}분 {reasonLabel[comparison.outcome.end.a.reason]} → B {comparison.outcome.end.b.minute}분 {reasonLabel[comparison.outcome.end.b.reason]} ({signed(comparison.outcome.end.minuteDelta)}분). 모델 자원은 실제 골드가 아닙니다.</p>
          </div> : <p className="experiment-comparison-pending">실행 B 재생이 끝나면 결과 비교를 표시합니다.</p>}
        </>}
      </section>}

      {baseline && <ExperimentComparisonSharePanel baseline={baseline} run={run} shownMinute={shownMinute} />}

      {baseline && <ExperimentBatchPanel baseline={baseline} run={run} shownMinute={shownMinute}
        ready={!isBaseline && !!comparison?.ok && !!comparison.outcome} label={label} />}
    </div>
  </details>;
}

export default ExperimentComparisonPanel;
