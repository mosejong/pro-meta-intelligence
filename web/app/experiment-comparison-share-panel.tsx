"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExperimentRun } from "./experiment-replay";
import { buildExperimentComparisonText, type ComparisonTextRefusal } from "./experiment-comparison-text";

type CopyState = { baseline: ExperimentRun; run: ExperimentRun; text: string; status: "copying" | "copied" | "manual" };

const refusalText: Record<ComparisonTextRefusal, string> = {
  UNTRUSTED: "이 화면에서 직접 실행한 기록만 요약할 수 있습니다.",
  SAME_RUN: "기준 A와 다른 실행 B가 있어야 비교 요약을 복사할 수 있습니다.",
  NOT_COMPLETE: "실행 B를 끝까지 재생하면 비교 요약을 복사할 수 있습니다.",
  NOT_COMPARABLE: "같은 조건의 두 실행이 아니어서 비교 요약을 만들지 않습니다.",
  INVALID_RESULT: "비교 결과 기록이 맞지 않아 요약을 만들 수 없습니다.",
  INVALID_TEXT: "팀 이름이나 자료 기준 정보가 비어 있거나 올바르지 않아 요약을 만들 수 없습니다.",
  TOO_LONG: "비교 요약 글이 너무 길어 복사할 수 없습니다.",
};

/**
 * Copies the finished A/B comparison of two kept runs as plain Korean text. Reads only the frozen runs
 * through the existing comparison (no model, batch or storage). Copy status belongs to one A, one B and
 * B's end: replacing/clearing A, a new B, seeking back or unmount invalidates it, and a clipboard write
 * finishing later is ignored (it is not undone).
 */
export function ExperimentComparisonSharePanel({ baseline, run, shownMinute }: { baseline: ExperimentRun; run: ExperimentRun; shownMinute: number }) {
  const noteId = useId();
  const complete = Number.isFinite(shownMinute) && shownMinute >= run.endMinute;
  const share = useMemo(() => buildExperimentComparisonText(baseline, run, shownMinute), [baseline, run, shownMinute]);
  const [copy, setCopy] = useState<CopyState | null>(null);
  // Changing A or B, or leaving B's end, drops any copy state so returning later starts clean.
  if (copy && (copy.baseline !== baseline || copy.run !== run || !complete)) setCopy(null);
  /** Bumped on A/B/completeness change and unmount; a copy finishing later is ignored. */
  const copyToken = useRef(0);
  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [baseline, run, complete]);
  const shownCopy = copy && copy.baseline === baseline && copy.run === run && complete ? copy : null;

  async function copyText() {
    if (!complete || !share.ok) return;
    const token = ++copyToken.current;
    const base = { baseline, run, text: share.text };
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ ...base, status: "manual" }); return; }
    setCopy({ ...base, status: "copying" });
    let ok = false;
    try { await writeText(share.text); ok = true; } catch { ok = false; }
    if (copyToken.current !== token) return; // A replaced/cleared, new B, seek back or unmount meanwhile
    setCopy({ ...base, status: ok ? "copied" : "manual" });
  }

  const canCopy = complete && share.ok;
  const note = share.ok ? "" : refusalText[share.reason] ?? refusalText.INVALID_RESULT;

  return <div className="experiment-comparison-share">
    <button type="button" disabled={!canCopy || shownCopy?.status === "copying"} onClick={copyText}
      aria-describedby={note ? noteId : undefined}>A/B 비교 요약 복사</button>
    {note && <p id={noteId}>{note}</p>}
    <p role="status">{shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "보관된 두 실행의 비교 요약을 클립보드에 복사했어요."
      : shownCopy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 글을 직접 선택해 복사하세요." : ""}</p>
    {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={14}
      aria-label="A/B 비교 요약 글 (직접 복사)" onFocus={(event) => event.currentTarget.select()} />}
  </div>;
}

export default ExperimentComparisonSharePanel;
