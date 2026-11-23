"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SoloAutoSummary, SoloDraftExplanationBody } from "./solo-draft-explanation";
import type { SoloAutoHistory } from "./solo-draft-history";
import { buildSoloHistoryText, type SoloHistoryTextRefusal } from "./solo-draft-history-text";
import { requestTextDownload, TEXT_DOWNLOAD_TYPE, type TextDownloadEnv, type TextDownloadResult } from "./text-download";
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

/** Fixed ASCII file name and MIME for the explicit readable download (no team/player names or IDs). */
export const SOLO_HISTORY_FILE_NAME = "draft-choice-review.txt";
export const SOLO_HISTORY_FILE_TYPE = TEXT_DOWNLOAD_TYPE;
export type SoloHistoryDownloadResult = TextDownloadResult;

/**
 * Asks the browser to download `text` as draft-choice-review.txt (see requestTextDownload).
 * "REQUESTED" only means the browser accepted the request. Nothing here touches app storage, URL,
 * history or selections.
 */
export function requestSoloHistoryDownload(text: string, env: TextDownloadEnv = {}): SoloHistoryDownloadResult {
  return requestTextDownload(text, SOLO_HISTORY_FILE_NAME, env);
}

type SaveState = { history: SoloAutoHistory; nameOf: NameOf; patchId: string; cutoff: string; status: SoloHistoryDownloadResult };
const saveStatusText: Record<SoloHistoryDownloadResult, string> = {
  REQUESTED: `브라우저에 ${SOLO_HISTORY_FILE_NAME} 저장을 요청했어요. 실제 저장 여부와 위치는 브라우저에서 확인하세요.`,
  UNAVAILABLE: "이 브라우저에서는 파일 저장을 요청할 수 없어요. 복사 버튼을 이용하세요.",
  FAILED: "파일 저장 요청에 실패했어요. 다시 시도하거나 복사 버튼을 이용하세요.",
};

/** Shown while any record restored from this device's local practice notes is still on the board. */
export const SOLO_HISTORY_RESTORED_NOTE = "이 기기에 저장된 연습 메모에서 불러온 설명입니다. 증명 자료나 예측 근거가 아닙니다.";

/**
 * Collapsed, read-only review of every real auto-confirmed opponent turn still on the current board.
 * User exports are explicit, human-readable copies of the same validated text already built here:
 * a plain-text copy or a .txt download requested by the user. This panel itself never stores or restores
 * anything (no app storage, room or link); draft-lab autosaves the frozen records locally with the board
 * and restores them only for the same exact board. Exporting never re-runs a suggestion or explanation.
 */
export function SoloDraftHistoryPanel({ history, nameOf, patchId, cutoff, restored = false }: { history: SoloAutoHistory; nameOf: NameOf; patchId: string; cutoff: string; restored?: boolean }) {
  const share = useMemo(() => buildSoloHistoryText({ history, patchId, cutoff, nameOf }), [history, patchId, cutoff, nameOf]);
  const [copy, setCopy] = useState<CopyState | null>(null);
  const [save, setSave] = useState<SaveState | null>(null);
  // Download status shows only for exactly the current inputs, so any history/basis/name change clears it.
  const shownSave = save && save.history === history && save.nameOf === nameOf && save.patchId === patchId && save.cutoff === cutoff ? save : null;
  function saveText() {
    if (!share.ok) return; // same refusal gates as copy: never a partial file
    setSave({ history, nameOf, patchId, cutoff, status: requestSoloHistoryDownload(share.text) });
  }
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
    {restored && <p className="solo-history-restored" role="note">{SOLO_HISTORY_RESTORED_NOTE}</p>}
    <ol>{ordered.map(record => <li key={record.turn}>
      <details>
        <summary>{`${record.turn}번째 차례 · ${nameOf(record.champion_id)}`}</summary>
        <p><SoloAutoSummary record={record} /></p>
        {record.explanation ? <SoloDraftExplanationBody explanation={record.explanation} nameOf={nameOf} /> : <p>이 차례에는 상세 설명 기록이 없습니다.</p>}
      </details>
    </li>)}</ol>
    <div className="solo-history-share">
      <button type="button" disabled={!share.ok || shownCopy?.status === "copying"} onClick={copyText}
        aria-describedby={!share.ok ? "solo-history-share-reason" : undefined}>자동 선택 복기 복사</button>{" "}
      <button type="button" disabled={!share.ok} onClick={saveText}
        aria-describedby={!share.ok ? "solo-history-share-reason" : undefined}>자동 선택 복기 저장</button>
      {!share.ok && <p id="solo-history-share-reason">{shareRefusalText[share.reason]}</p>}
      <p role="status">{shownSave ? saveStatusText[shownSave.status] : ""}</p>
      <p role="status">{shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "자동 선택 복기를 클립보드에 복사했어요."
        : shownCopy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 글을 직접 선택해 복사하세요." : ""}</p>
      {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={12} style={{ width: "100%" }}
        aria-label="자동 선택 복기 글 (직접 복사)" onFocus={(e) => e.currentTarget.select()} />}
    </div>
  </details>;
}
