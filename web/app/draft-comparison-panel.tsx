"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  buildDraftComparisonSnapshot,
  compareDraftSnapshots,
  evidenceIdentityOf,
  replayDraftComparisonFile,
  serializeDraftComparison,
  type DraftComparisonInput,
  type DraftComparisonResult,
  type DraftComparisonSnapshot,
} from "./draft-comparison";

type DraftComparisonPanelProps = DraftComparisonInput & {
  nameOf: (championId: string) => string;
};

type ComparisonOk = Extract<DraftComparisonResult, { ok: true }>;
type ReplayView = { fileName: string; a: DraftComparisonSnapshot; b: DraftComparisonSnapshot; comparison: ComparisonOk };

const sideLabel = (side: "BLUE" | "RED") => side === "BLUE" ? "블루" : "레드";

/** Read-only rendering shared by the live A/B result and a replayed comparison file. */
function ComparisonDiffView({ a, b, diff, nameOf, caption }: {
  a: DraftComparisonSnapshot;
  b: DraftComparisonSnapshot;
  diff: ComparisonOk;
  nameOf: (championId: string) => string;
  caption: string;
}) {
  const names = (ids: string[]) => ids.map(nameOf).join(", ") || "없음";
  return <>
    <p>변경 픽 {diff.changes.filter((item) => item.before.kind === "PICK").length}개 · 변경 밴 {diff.changes.filter((item) => item.before.kind === "BAN").length}개 · 동일 {diff.unchangedCount}개 (진영·종류·슬롯 기준)</p>
    <p>선픽 진영: {sideLabel(a.firstPickSide)} → {sideLabel(b.firstPickSide)} ({diff.firstPickChanged ? "변경" : "동일"})</p>
    {diff.teamChanges.length
      ? <ul>{diff.teamChanges.map((item) => <li key={item.side}>{sideLabel(item.side)}: {item.before.name} → {item.after.name}</li>)}</ul>
      : <p>팀·진영 배정 동일</p>}
    {diff.changes.length ? <table>
      <caption>{caption}</caption>
      <thead><tr><th scope="col">슬롯</th><th scope="col">A</th><th scope="col">B</th></tr></thead>
      <tbody>{diff.changes.map(({ before, after }) => <tr key={`${before.side}-${before.kind}-${before.slot}`}>
        <th scope="row">{sideLabel(before.side)} {before.kind === "PICK" ? "픽" : "밴"} {before.slot}</th>
        <td>{nameOf(before.champion_id)}</td><td>{nameOf(after.champion_id)}</td>
      </tr>)}</tbody>
    </table> : <p>변경된 픽·밴 없음</p>}
    <p>이전 세트 피어리스 잠금 · 추가: {names(diff.addedLocks)} · 해제: {names(diff.removedLocks)}</p>
  </>;
}

/**
 * Korean-only for now (translation follows feature acceptance). Baseline A lives in this
 * component's memory only; the studio remounts the panel (key) on import/restore, so a
 * replaced session never compares against an A from different data.
 * A replayed comparison file is display-only: it never replaces baseline A, the in-progress
 * draft or the autosave.
 */
export function DraftComparisonPanel({ report, blueTeam, redTeam, selections, games, firstPickSide, nameOf }: DraftComparisonPanelProps) {
  const [baseline, setBaseline] = useState<DraftComparisonSnapshot | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [replay, setReplay] = useState<ReplayView | null>(null);
  const [replayMessage, setReplayMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  // Synchronous guard: a second change event can arrive before `reading` re-renders.
  const readingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Inputs are immutable studio state; timer/status re-renders reuse this result.
  const current = useMemo(
    () => buildDraftComparisonSnapshot({ report, blueTeam, redTeam, selections, games, firstPickSide }),
    [report, blueTeam, redTeam, selections, games, firstPickSide],
  );
  const diff = useMemo(() => baseline && current.ok ? compareDraftSnapshots(baseline, current.snapshot) : null, [baseline, current]);
  const replaySameEvidence = useMemo(() => replay ? replay.a.evidenceIdentity === evidenceIdentityOf(report) : false, [replay, report]);

  function freeze() {
    if (!current.ok) return;
    setBaseline(current.snapshot);
    setExportMessage("");
  }

  function clear() {
    setBaseline(null);
    setExportMessage("");
  }

  function download() {
    if (!baseline || !current.ok) return;
    const result = serializeDraftComparison(report, baseline, current.snapshot);
    if (!result.ok) { setExportMessage(result.message); return; }
    const url = URL.createObjectURL(new Blob([result.text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-comparison-${baseline.teams.BLUE.name}-vs-${baseline.teams.RED.name}-${report.patch_id}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
    setExportMessage(`비교 JSON을 저장했습니다 (${Math.ceil(result.bytes / 1024)}KB). 파일 안의 입력으로 같은 결과를 다시 계산할 수 있습니다.`);
  }

  async function openReplay(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || readingRef.current) { input.value = ""; return; }
    readingRef.current = true;
    setReading(true);
    setReplayMessage({ tone: "status", text: "비교 파일을 확인하는 중입니다…" });
    try {
      const result = await replayDraftComparisonFile(file);
      if (result.ok) {
        setReplay({ fileName: file.name, a: result.a, b: result.b, comparison: result.comparison });
        setReplayMessage({ tone: "status", text: `"${file.name}" 파일을 다시 계산했고 기록된 결과와 일치합니다. 읽기 전용으로 표시합니다.` });
      } else {
        // Never leave an earlier replay on screen under a new file's failure message.
        setReplay(null);
        setReplayMessage({ tone: "alert", text: `"${file.name}" 파일을 재현하지 못했습니다. ${result.message}` });
      }
    } finally {
      readingRef.current = false;
      setReading(false);
      // Allow choosing the same file again after fixing it.
      input.value = "";
    }
  }

  function resetReplay() {
    if (readingRef.current) return;
    setReplay(null);
    setReplayMessage(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return <section className="draft-comparison" lang="ko" aria-labelledby="draft-comparison-title">
    <header>
      <h2 id="draft-comparison-title">드래프트 A/B 비교</h2>
      <p>완료한 드래프트를 기준 A로 고정한 뒤 세트를 초기화하고 B를 다시 짜서 비교합니다. 같은 분석 데이터(패치·기준 시각·모델·출처)일 때만 비교합니다.</p>
      <p><b>기준 A는 이 화면의 메모리에만 있습니다.</b> 새로고침·페이지 이동·시나리오 파일 가져오기를 하면 사라지며 자동 저장되지 않습니다.</p>
    </header>
    <div className="draft-comparison-actions">
      <button type="button" disabled={!current.ok} onClick={freeze}>{baseline ? "현재 B로 기준 A 교체" : "현재 완료 드래프트를 기준 A로 고정"}</button>
      <button type="button" disabled={!baseline} onClick={clear}>기준 A 지우기</button>
      <button type="button" disabled={!diff?.ok} onClick={download}>A/B 비교 JSON 저장</button>
    </div>
    <div className="draft-comparison-body" aria-live="polite">
      {!baseline && <p>기준 A가 없습니다. 규칙에 맞는 픽·밴 20개를 완료한 뒤 고정하세요.</p>}
      {baseline && <p>기준 A: 블루 {baseline.teams.BLUE.name} · 레드 {baseline.teams.RED.name} · 선픽 {sideLabel(baseline.firstPickSide)} · {baseline.games.length + 1}세트 · 패치 {baseline.patch} · 기준 {baseline.cutoff}</p>}
      {!current.ok && <p>현재 B: {current.message}</p>}
      {diff && !diff.ok && <p role="alert">{diff.message}</p>}
      {diff?.ok && current.ok && baseline && <ComparisonDiffView a={baseline} b={current.snapshot} diff={diff} nameOf={nameOf} caption="변경된 픽·밴" />}
      {exportMessage && <p role="status">{exportMessage}</p>}
      <p className="draft-comparison-boundary">픽·밴·진영·잠금의 차이만 보여 줍니다. 승률·시너지·카운터 평가나 경기 시뮬레이션은 제공하지 않습니다.</p>
    </div>
    <section className="draft-comparison-replay" aria-labelledby="draft-comparison-replay-title">
      <h3 id="draft-comparison-replay-title">저장한 비교 파일 재현</h3>
      <p>저장한 A/B 비교 JSON을 열면 파일 안의 분석 데이터와 입력으로 결과를 다시 계산해 기록과 대조합니다. 결과는 읽기 전용이며 진행 중인 밴픽·자동 저장·기준 A는 바뀌지 않습니다. 16MB 이하 파일만 엽니다.</p>
      <div className="draft-comparison-actions">
        <label className="draft-comparison-file">
          <span>{reading ? "확인 중…" : "비교 JSON 열기"}</span>
          <input ref={fileInput} type="file" accept="application/json,.json" disabled={reading} onChange={(event) => { void openReplay(event); }} />
        </label>
        <button type="button" disabled={reading || (!replay && !replayMessage)} onClick={resetReplay}>재현 결과 닫기</button>
      </div>
      <div className="draft-comparison-body" aria-live="polite">
        {replayMessage && <p role={replayMessage.tone}>{replayMessage.text}</p>}
        {replay && <>
          <p>{replaySameEvidence
            ? "이 파일은 현재 스튜디오와 같은 분석 데이터(패치·기준 시각·모델·출처)로 만들어졌습니다."
            : "이 파일은 현재 스튜디오와 다른 분석 데이터로 만들어졌습니다. 파일 안의 데이터로만 재현했으며 현재 화면과 섞지 않습니다."}</p>
          <p>파일 기준 A: 블루 {replay.a.teams.BLUE.name} · 레드 {replay.a.teams.RED.name} · 선픽 {sideLabel(replay.a.firstPickSide)} · {replay.a.games.length + 1}세트 · 패치 {replay.a.patch} · 기준 {replay.a.cutoff}</p>
          <ComparisonDiffView a={replay.a} b={replay.b} diff={replay.comparison} nameOf={nameOf} caption="파일에 기록된 변경 픽·밴" />
        </>}
      </div>
    </section>
  </section>;
}

export default DraftComparisonPanel;
