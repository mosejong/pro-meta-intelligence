"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SoloAutoSummary, SoloDraftExplanationBody } from "./solo-draft-explanation";
import type { SoloAutoHistory } from "./solo-draft-history";
import { buildSoloHistoryText, type SoloHistoryTextRefusal } from "./solo-draft-history-text";
import "./solo-draft-explanation.css";

const shareRefusalText: Record<SoloHistoryTextRefusal, string> = {
  EMPTY: "복사할 자동 선택이 없어요.",
  INVALID_BASIS: "기준 패치나 자료 시각을 확인하지 못해 복사하지 않아요.",
  INVALID_HISTORY: "복기 형식을 확인하지 못해 복사하지 않아요.",
  MIXED_CONTEXT: "다른 세트 조건의 기록이 섞여 있어 복사하지 않아요.",
  INCONSISTENT_ORDER: "차례 기록이 서로 맞지 않아 복사하지 않아요.",
  EXPLANATION_MISMATCH: "설명 기록이 선택과 맞지 않아 복사하지 않아요.",
  UNKNOWN_EVIDENCE: "알 수 없는 근거가 있어 복사하지 않아요.",
  INVALID_NAME: "챔피언이나 팀 이름을 확인하지 못해 복사하지 않아요.",
  TOO_LONG: "글이 너무 길어 복사하지 않아요.",
};

type NameOf = (id: string) => string;
type CopyState = { history: SoloAutoHistory; nameOf: NameOf; patchId: string; cutoff: string; text: string; status: "copying" | "copied" | "manual" };

/**
 * Collapsed, read-only review of every real auto-confirmed opponent turn still on the current board.
 * The only way out is an explicit plain-text copy of the records already on screen (no persistence,
 * room or link); copying never re-runs a suggestion or explanation.
 */
export function SoloDraftHistoryPanel({ history, nameOf, patchId, cutoff }: { history: SoloAutoHistory; nameOf: NameOf; patchId: string; cutoff: string }) {
  const share = useMemo(() => buildSoloHistoryText({ history, patchId, cutoff, nameOf }), [history, patchId, cutoff, nameOf]);
  const [copy, setCopy] = useState<CopyState | null>(null);
  /** Bumped whenever history/nameOf/patch/cutoff change and on unmount; a copy finishing later is ignored. */
  const copyToken = useRef(0);
  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [history, nameOf, patchId, cutoff]);
  // Show a copy state only for exactly the current inputs (guards the render before the effect runs).
  const shownCopy = copy && copy.history === history && copy.nameOf === nameOf && copy.patchId === patchId && copy.cutoff === cutoff ? copy : null;
  async function copyText() {
    if (!share.ok) return;
    const token = ++copyToken.current;
    const base = { history, nameOf, patchId, cutoff, text: share.text };
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ ...base, status: "manual" }); return; }
    setCopy({ ...base, status: "copying" });
    let ok = false;
    try { await writeText(share.text); ok = true; } catch { ok = false; }
    if (copyToken.current !== token) return; // inputs changed or unmounted meanwhile
    setCopy({ ...base, status: ok ? "copied" : "manual" });
  }
  if (!history.length) return null;
  const ordered = [...history].sort((a, b) => a.turn - b.turn);
  return <details className="solo-history">
    <summary>{`이번 세트 자동 선택 복기 (${ordered.length})`}</summary>
    <p>상대가 자동으로 확정한 차례만 표시합니다. 각 설명은 확정 직전에 만든 기록이며 이후 자료로 다시 계산하지 않습니다.</p>
    <ol>{ordered.map(record => <li key={record.turn}>
      <details>
        <summary>{`${record.turn}번째 차례 · ${nameOf(record.champion_id)}`}</summary>
        <p><SoloAutoSummary record={record} /></p>
        {record.explanation ? <SoloDraftExplanationBody explanation={record.explanation} nameOf={nameOf} /> : <p>이 차례에는 상세 설명 기록이 없습니다.</p>}
      </details>
    </li>)}</ol>
    <div className="solo-history-share">
      <button type="button" disabled={!share.ok || shownCopy?.status === "copying"} onClick={copyText}
        aria-describedby={!share.ok ? "solo-history-share-reason" : undefined}>자동 선택 복기 복사</button>
      {!share.ok && <p id="solo-history-share-reason">{shareRefusalText[share.reason]}</p>}
      <p role="status">{shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "자동 선택 복기를 클립보드에 복사했어요."
        : shownCopy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 글을 직접 선택해 복사하세요." : ""}</p>
      {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={12} style={{ width: "100%" }}
        aria-label="자동 선택 복기 글 (직접 복사)" onFocus={(e) => e.currentTarget.select()} />}
    </div>
  </details>;
}
