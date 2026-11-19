"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExperimentRun } from "./experiment-replay";
import { buildExperimentResultText, type ResultTextRefusal } from "./experiment-result-text";

type CopyState = { run: ExperimentRun; text: string; status: "copying" | "copied" | "manual" };

const refusalText: Record<Exclude<ResultTextRefusal, "NOT_COMPLETE">, string> = {
  INVALID_RUN: "실행 기록 형식이 맞지 않아 요약을 만들 수 없습니다.",
  INVALID_RESULT: "모델 결과 기록이 맞지 않아 요약을 만들 수 없습니다.",
  INVALID_TEXT: "팀 이름이나 자료 기준 정보가 비어 있거나 올바르지 않아 요약을 만들 수 없습니다.",
  TOO_LONG: "요약 글이 너무 길어 복사할 수 없습니다.",
};

/**
 * Copies the completed frozen run as plain Korean text. Only reads the run (no model call, replay or
 * comparison). Copy status belongs to one run at its end: a new run, seeking back before the end or
 * unmount invalidates it, and a clipboard write that finishes later is ignored (it is not undone).
 */
export function ExperimentResultSharePanel({ run, shownMinute }: { run: ExperimentRun; shownMinute: number }) {
  const complete = Number.isFinite(shownMinute) && shownMinute >= run.endMinute;
  const share = useMemo(() => complete ? buildExperimentResultText(run, shownMinute) : null, [run, shownMinute, complete]);
  const [copy, setCopy] = useState<CopyState | null>(null);
  // Leaving the end or switching runs drops any copy state, so returning later starts clean.
  if (copy && (copy.run !== run || !complete)) setCopy(null);
  /** Bumped on run/completeness change and unmount; a copy finishing later is ignored. */
  const copyToken = useRef(0);
  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [run, complete]);
  const shownCopy = copy && copy.run === run && complete ? copy : null;

  async function copyText() {
    if (!complete || !share?.ok) return;
    const token = ++copyToken.current;
    const base = { run, text: share.text };
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ ...base, status: "manual" }); return; }
    setCopy({ ...base, status: "copying" });
    let ok = false;
    try { await writeText(share.text); ok = true; } catch { ok = false; }
    if (copyToken.current !== token) return; // new run, seek back or unmount meanwhile
    setCopy({ ...base, status: ok ? "copied" : "manual" });
  }

  const canCopy = complete && Boolean(share?.ok);
  const note = !complete ? "결과까지 확인하면 이 실행의 요약을 복사할 수 있습니다."
    : share && !share.ok ? refusalText[share.reason as Exclude<ResultTextRefusal, "NOT_COMPLETE">] ?? refusalText.INVALID_RUN : "";

  return <div className="experiment-result-share">
    <button type="button" disabled={!canCopy || shownCopy?.status === "copying"} onClick={copyText}
      aria-describedby={note ? "experiment-result-share-note" : undefined}>가정 실험 요약 복사</button>
    {note && <p id="experiment-result-share-note">{note}</p>}
    <p role="status">{shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "실행 당시 고정 기록의 요약을 클립보드에 복사했어요."
      : shownCopy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 글을 직접 선택해 복사하세요." : ""}</p>
    {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={12}
      aria-label="가정 실험 요약 글 (직접 복사)" onFocus={(event) => event.currentTarget.select()} />}
  </div>;
}

export default ExperimentResultSharePanel;
