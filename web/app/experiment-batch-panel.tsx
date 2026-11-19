"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ExperimentRun } from "./experiment-replay";
import {
  BATCH_DEFAULT_PAIRS,
  BATCH_MAX_PAIRS,
  batchMatchesTarget,
  parsePairCount,
  runExperimentBatch,
  type BatchResult,
  type Spread,
} from "./experiment-batch";
import { buildBatchSummaryText } from "./experiment-batch-summary";
import "./experiment-batch-panel.css";

/** Copy state tied to the exact result object and A/B ids it was made for. */
type CopyState = {
  status: "copying" | "copied" | "manual";
  result: BatchResult;
  baselineRunId: number;
  candidateRunId: number;
  text: string;
};

type ExperimentBatchPanelProps = {
  baseline: ExperimentRun;
  run: ExperimentRun;
  shownMinute: number;
  /** True only when the single A/B comparison is valid and B was played to its end. */
  ready: boolean;
  label: (sourceId: string) => string;
};

const num = (value: number) => value.toLocaleString("ko-KR");
const signed = (value: number) => value > 0 ? `+${num(value)}` : num(value);
const spread = (s: Spread) => `최소 ${signed(s.min)} · 중앙 ${signed(s.median)} · 최대 ${signed(s.max)}`;

/**
 * Explicit paired multi-seed batch for the current A/B pair. Computes only on button press; a kept
 * result is never recomputed when A or B changes, it is marked as belonging to another pair instead.
 */
export function ExperimentBatchPanel({ baseline, run, shownMinute, ready, label }: ExperimentBatchPanelProps) {
  const [pairsText, setPairsText] = useState(String(BATCH_DEFAULT_PAIRS));
  const [result, setResult] = useState<BatchResult | null>(null);
  const [message, setMessage] = useState("");
  const parsed = parsePairCount(pairsText);
  const matches = batchMatchesTarget(result, baseline.runId, run.runId);
  const [copy, setCopy] = useState<CopyState | null>(null);
  /** Bumped whenever A, B or the result changes and on unmount; a copy finishing later is ignored. */
  const copyToken = useRef(0);

  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [result, baseline.runId, run.runId]);

  // Only show a copy state made for exactly the current result and A/B (guards the render before the effect).
  const shownCopy = copy && result && matches && copy.result === result
    && copy.baselineRunId === baseline.runId && copy.candidateRunId === run.runId ? copy : null;

  async function copySummary() {
    if (!result || !matches) return;
    const text = buildBatchSummaryText(result, label);
    const token = ++copyToken.current;
    const base = { result, baselineRunId: baseline.runId, candidateRunId: run.runId, text };
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ ...base, status: "manual" }); return; }
    setCopy({ ...base, status: "copying" });
    let ok = false;
    try { await writeText(text); ok = true; } catch { ok = false; }
    if (copyToken.current !== token) return; // A/B/result changed or unmounted meanwhile.
    setCopy({ ...base, status: ok ? "copied" : "manual" });
  }

  function start() {
    if (!parsed.ok) { setMessage(parsed.message); return; }
    const outcome = runExperimentBatch(baseline, run, shownMinute, parsed.value);
    if (!outcome.ok) { setMessage(outcome.refusals.map((r) => r.message).join(" ")); return; }
    setResult(outcome);
    setMessage(`재현 번호 ${outcome.seeds.length}개로 A/B를 각각 실행했습니다.`);
  }

  return <section className="experiment-batch" aria-label="같은 밴픽의 여러 재현 번호 비교">
    <h4>여러 재현 번호 비교 (A/B 쌍)</h4>
    <p className="experiment-batch-boundary" role="note">미리 정한 같은 재현 번호 목록으로 A와 B 가정을 각각 실행한 <b>모델 내부 실험</b>입니다. 임의로 정한 번호이며 표본 통계·실제 승률·실전 예측이 아닙니다. 선수·챔피언·룬·아이템의 실제 효과는 반영하지 않습니다.</p>
    <div className="experiment-batch-actions">
      <label>쌍 수 <input type="text" inputMode="numeric" value={pairsText} aria-invalid={!parsed.ok || undefined}
        onChange={(e) => setPairsText(e.target.value)} size={3} /> <small>(1~{BATCH_MAX_PAIRS})</small></label>
      <button type="button" disabled={!ready || !parsed.ok} onClick={start}>{result && !matches ? "현재 A/B로 다시 실행" : "여러 재현 번호로 실행"}</button>
    </div>
    {!ready && <p className="experiment-batch-hint">비교 가능한 실행 B를 끝까지 재생하면 실행할 수 있습니다.</p>}
    <p className="experiment-batch-status" role="status">{message}</p>

    {result && !matches && <p className="experiment-batch-stale" role="alert">아래 결과는 이전 대상(기준 A #{result.target.baselineRunId} · 실행 B #{result.target.candidateRunId})의 결과입니다. 현재 A/B와 다르므로 필요하면 다시 실행하세요.</p>}

    {result && <div className="experiment-batch-result" data-stale={!matches || undefined} data-testid="experiment-batch-result">
      <p>기준 A #{result.target.baselineRunId} · 실행 B #{result.target.candidateRunId} · 규칙 {result.ruleset} · 재현 번호 목록 {result.seedListId} ({result.seeds[0]}~{result.seeds.at(-1)}, {result.seeds.length}쌍)</p>
      {result.changeKind === "NONE" ? <p>같은 가정이므로 모든 쌍의 차이가 0입니다.</p>
        : result.summary.allZero && <p>가정은 다르지만 이 재현 번호 목록에서는 표시된 차이가 모두 0입니다.</p>}
      <ul>
        {result.context.teamOrder.map((id) => <li key={id} data-source-id={id}>
          <b>{label(id)}</b> 모델 내부 승리 A {result.summary.wins[id].a}/{result.summary.denominator} → B {result.summary.wins[id].b}/{result.summary.denominator}
          <br /><small>모델 자원 B−A {spread(result.summary.gold[id])} · 모델 킬 B−A {spread(result.summary.kills[id])}</small>
        </li>)}
        <li>모델 종료 분 B−A {spread(result.summary.minute)}</li>
      </ul>
      <div className="experiment-batch-actions">
        <button type="button" disabled={!matches || shownCopy?.status === "copying"} onClick={copySummary}
          aria-describedby={!matches ? "experiment-batch-copy-reason" : undefined}>비교 요약을 쉬운 글로 복사</button>
      </div>
      {!matches && <p id="experiment-batch-copy-reason" className="experiment-batch-hint">현재 A/B와 다른 이전 결과라서 복사할 수 없습니다. 현재 A/B로 다시 실행하면 복사할 수 있습니다.</p>}
      <p className="experiment-batch-status" role="status">
        {shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "비교 요약을 클립보드에 복사했습니다." : shownCopy?.status === "manual" ? "자동 복사를 할 수 없습니다. 아래 글을 직접 선택해 복사하세요." : ""}
      </p>
      {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={12} style={{ width: "100%" }}
        aria-label="비교 요약 (직접 복사)" onFocus={(e) => e.currentTarget.select()} />}
      <details>
        <summary>쌍별 상세 ({result.rows.length}행)</summary>
        <div className="experiment-batch-scroll">
          <table>
            <thead><tr><th scope="col">재현 번호</th><th scope="col">승리 A → B</th>{result.context.teamOrder.map((id) => <th key={id} scope="col">{label(id)} 자원/킬 B−A</th>)}<th scope="col">종료 분 A → B</th></tr></thead>
            <tbody>{result.rows.map((row) => <tr key={row.seed}>
              <th scope="row">{row.seed}</th>
              <td>{label(row.a.winner)} → {label(row.b.winner)}</td>
              {result.context.teamOrder.map((id) => <td key={id}>{signed(row.delta[id].gold)} / {signed(row.delta[id].kills)}</td>)}
              <td>{row.a.minute} → {row.b.minute} ({signed(row.minuteDelta)})</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>}
  </section>;
}

export default ExperimentBatchPanel;
