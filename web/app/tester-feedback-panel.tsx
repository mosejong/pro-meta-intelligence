"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BROWSER_OPTIONS, DEVICE_OPTIONS, EMPTY_TESTER_FEEDBACK, FIRST_MINUTE_OPTIONS, MISREAD_OPTIONS, RETURN_OPTIONS,
  SAVE_SHARE_OPTIONS, STUCK_OPTIONS, TESTER_FEEDBACK_STORAGE_KEY, TESTER_FEEDBACK_TEXT_MAX, buildTesterFeedbackText,
  contextLines, hasTesterFeedback, normalizeTesterFeedback, parseTesterFeedbackDraft, serializeTesterFeedbackDraft,
  type StuckCode, type TesterFeedbackAnswers, type TesterFeedbackContext,
} from "./tester-feedback";
import { requestTextDownload, type TextDownloadResult } from "./text-download";
import { readWorkspacePreference, writeWorkspacePreference } from "./workspace-storage";
import "./tester-feedback.css";

/**
 * Where testers send the text. Enable only after the project owner supplies a real, monitored address;
 * until then testers copy/save the text and send it to whoever asked them to test (e.g. a chat app).
 * No network request, form service or analytics is used by this panel.
 */
const TESTER_FEEDBACK_EMAIL: string | null = null;
export const TESTER_FEEDBACK_FILE_NAME = "pro-meta-test-feedback.txt";
/** mailto bodies longer than this are unreliable in some mail apps; the copy/save path stays available. */
const MAILTO_BODY_MAX = 1800;

type SingleKey = "device" | "browser" | "firstMinute" | "saveShare" | "misread" | "returnIntent";
type TextKey = "expected" | "reuse" | "improve";

const saveStatusText: Record<TextDownloadResult, string> = {
  REQUESTED: `브라우저에 ${TESTER_FEEDBACK_FILE_NAME} 저장을 요청했어요. 저장 위치는 브라우저에서 확인하세요.`,
  UNAVAILABLE: "이 브라우저에서는 파일 저장을 요청할 수 없어요. 복사 버튼을 이용하세요.",
  FAILED: "파일 저장 요청에 실패했어요. 다시 시도하거나 복사 버튼을 이용하세요.",
};

function Choice<T extends string>({ name, legend, options, value, onChange }: {
  name: string; legend: string; options: ReadonlyArray<readonly [T, string]>; value: T | null; onChange: (next: T) => void;
}) {
  return <fieldset className="tester-feedback-choice">
    <legend>{legend}</legend>
    <div>{options.map(([code, label]) => <label key={code}>
      <input type="radio" name={name} value={code} checked={value === code} onChange={() => onChange(code)} />{label}
    </label>)}</div>
  </fieldset>;
}

function FreeText({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: string; onChange: (next: string) => void }) {
  return <div className="tester-feedback-text">
    <label htmlFor={id}>{label}</label>
    {hint && <p id={`${id}-hint`}>{hint}</p>}
    <textarea id={id} rows={3} maxLength={TESTER_FEEDBACK_TEXT_MAX} value={value} aria-describedby={hint ? `${id}-hint` : undefined}
      onChange={event => onChange(event.target.value)} />
  </div>;
}

/**
 * Footer entry + modal form for the Korean preview round. Answers autosave only in this browser
 * (localStorage, answers only) and the tester explicitly copies or saves the text to send it.
 */
export function TesterFeedbackPanel({ context: appContext, prompt }: { context: Omit<TesterFeedbackContext, "viewportWidth">; prompt?: string }) {
  const ids = useId();
  const titleId = `${ids}-title`, introId = `${ids}-intro`;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Raw typed values are kept as-is while editing; normalisation happens for storage and text only.
  const [answers, setAnswers] = useState<TesterFeedbackAnswers>(EMPTY_TESTER_FEEDBACK);
  const [includeContext, setIncludeContext] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copy, setCopy] = useState<{ text: string; status: "copying" | "copied" | "manual" } | null>(null);
  const [save, setSave] = useState<{ text: string; status: TextDownloadResult } | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  /** Date written into the text; taken when the form opens so rendering stays pure. */
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  /** CSS width read when the form opens (never during render, so server and client markup match). */
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const context = useMemo<TesterFeedbackContext>(() => ({ ...appContext, viewportWidth }),
    // Primitive deps: the caller builds a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appContext.step, appContext.tab, appContext.mode, appContext.completedSets, appContext.currentTurn, appContext.patchId, appContext.cutoff, viewportWidth]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      if (typeof node.showModal === "function") node.showModal(); else node.setAttribute("open", "");
    } else if (!open && node.open) node.close();
  }, [open]);

  function openForm() {
    // Re-read every time: another entry point on the page may have edited the same local draft.
    const restored = parseTesterFeedbackDraft(readWorkspacePreference(TESTER_FEEDBACK_STORAGE_KEY));
    if (restored) setAnswers(restored);
    setConfirmClear(false);
    setOpenedAt(new Date());
    setViewportWidth(typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : null);
    setOpen(true);
  }

  function update(next: TesterFeedbackAnswers) {
    setAnswers(next);
    setConfirmClear(false);
    const ok = writeWorkspacePreference(TESTER_FEEDBACK_STORAGE_KEY, serializeTesterFeedbackDraft(next));
    setStorageBlocked(!ok);
  }
  const setSingle = <K extends SingleKey>(key: K) => (value: TesterFeedbackAnswers[K]) => update({ ...answers, [key]: value });
  const setText = (key: TextKey) => (value: string) => update({ ...answers, [key]: value });
  function toggleStuck(code: StuckCode, checked: boolean) {
    const rest = answers.stuck.filter(item => item !== code);
    if (!checked) { update({ ...answers, stuck: rest }); return; }
    // Picking "없음" clears concrete points; picking a concrete point clears "없음".
    update({ ...answers, stuck: code === "NONE" ? ["NONE"] : [...rest.filter(item => item !== "NONE"), code] });
  }
  function clearAll() {
    setAnswers({ ...EMPTY_TESTER_FEEDBACK, stuck: [] });
    setConfirmClear(false);
    setCopy(null); setSave(null);
    setStorageBlocked(!writeWorkspacePreference(TESTER_FEEDBACK_STORAGE_KEY, null));
  }

  const normalized = useMemo(() => normalizeTesterFeedback(answers), [answers]);
  const result = useMemo(() => buildTesterFeedbackText({ answers: normalized, context: includeContext ? context : null, now: openedAt ?? new Date(Number.NaN) }),
    [normalized, includeContext, context, openedAt]);
  const text = result.ok ? result.text : "";
  const shownCopy = copy && copy.text === text ? copy : null;
  const shownSave = save && save.text === text ? save : null;

  /** Bumped when the text changes or the panel unmounts; a clipboard write finishing later is ignored. */
  const copyToken = useRef(0);
  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [text]);
  async function copyText() {
    if (!result.ok) return;
    const token = ++copyToken.current;
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ text, status: "manual" }); return; }
    setCopy({ text, status: "copying" });
    let ok = false;
    try { await writeText(text); ok = true; } catch { ok = false; }
    if (copyToken.current !== token) return;
    setCopy({ text, status: ok ? "copied" : "manual" });
  }
  function saveText() {
    if (!result.ok) return;
    setSave({ text, status: requestTextDownload(text, TESTER_FEEDBACK_FILE_NAME) });
  }
  const mailto = TESTER_FEEDBACK_EMAIL && result.ok && text.length <= MAILTO_BODY_MAX
    ? `mailto:${TESTER_FEEDBACK_EMAIL}?subject=${encodeURIComponent("Pro Meta Intelligence 테스트 의견")}&body=${encodeURIComponent(text)}` : null;

  return <>
    {prompt
      ? <p className="tester-feedback-prompt"><span>{prompt}</span><button type="button" className="tester-feedback-open" onClick={openForm} aria-haspopup="dialog">테스트 의견 남기기</button></p>
      : <button type="button" className="tester-feedback-open" onClick={openForm} aria-haspopup="dialog">테스트 의견 남기기</button>}
    <dialog ref={dialog} className="tester-feedback-dialog" aria-labelledby={titleId} aria-describedby={introId}
      onClose={() => setOpen(false)} lang="ko">
      <header>
        <h2 id={titleId}>테스트 의견 남기기</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="의견 창 닫기">닫기</button>
      </header>
      <p id={introId}>써보면서 막히거나 헷갈린 곳이 가장 큰 도움이 돼요. 답하고 싶은 것만 고르면 됩니다.
        이름·연락처·계정은 적지 마세요. 적은 내용은 이 브라우저에만 임시 보관되고 자동으로 보내지지 않아요.</p>
      {open && <form onSubmit={event => event.preventDefault()}>
        <Choice name="tf-device" legend="어떤 기기로 써봤나요?" options={DEVICE_OPTIONS} value={answers.device} onChange={setSingle("device")} />
        <Choice name="tf-browser" legend="브라우저" options={BROWSER_OPTIONS} value={answers.browser} onChange={setSingle("browser")} />
        <Choice name="tf-first" legend="처음 1분 안에 무엇을 해야 하는지 알았나요?" options={FIRST_MINUTE_OPTIONS} value={answers.firstMinute} onChange={setSingle("firstMinute")} />
        <fieldset className="tester-feedback-choice">
          <legend>어디에서 멈추거나 헷갈렸나요? (여러 개 선택)</legend>
          <div>{STUCK_OPTIONS.map(([code, label]) => <label key={code}>
            <input type="checkbox" checked={answers.stuck.includes(code)} onChange={event => toggleStuck(code, event.target.checked)} />{label}
          </label>)}</div>
        </fieldset>
        <FreeText id="tf-expected" label="그때 무엇을 기대했나요?" hint="예: 저장 버튼을 누르면 다른 기기에서도 열릴 줄 알았다" value={answers.expected} onChange={setText("expected")} />
        <Choice name="tf-save" legend="저장·공유되는 범위가 예상과 같았나요?" options={SAVE_SHARE_OPTIONS} value={answers.saveShare} onChange={setSingle("saveShare")} />
        <Choice name="tf-misread" legend="선수 기록이나 가상 결과를 실제 경기 승률·선수 능력으로 받아들였나요?" options={MISREAD_OPTIONS} value={answers.misread} onChange={setSingle("misread")} />
        <FreeText id="tf-reuse" label="다시 쓴다면 어떤 상황에서 쓸 것 같나요?" value={answers.reuse} onChange={setText("reuse")} />
        <FreeText id="tf-improve" label="딱 하나만 고친다면 무엇인가요?" value={answers.improve} onChange={setText("improve")} />
        <Choice name="tf-return" legend="다시 써볼 생각이 있나요?" options={RETURN_OPTIONS} value={answers.returnIntent} onChange={setSingle("returnIntent")} />

        <div className="tester-feedback-context">
          <label><input type="checkbox" checked={includeContext} onChange={event => setIncludeContext(event.target.checked)} />지금 화면 상태도 함께 붙이기</label>
          {includeContext && <ul aria-label="함께 붙는 화면 상태">{contextLines(context).map(line => <li key={line}>{line}</li>)}</ul>}
          <p>개인 정보와 고른 챔피언·팀은 붙지 않아요.</p>
        </div>

        <div className="tester-feedback-actions">
          <button type="button" onClick={copyText} disabled={!result.ok || shownCopy?.status === "copying"}>의견 복사</button>
          <button type="button" onClick={saveText} disabled={!result.ok}>의견 파일로 저장</button>
          {mailto && <a href={mailto}>메일 앱으로 보내기</a>}
        </div>
        <p className="tester-feedback-send-hint">{TESTER_FEEDBACK_EMAIL
          ? "메일 앱이 열리지 않으면 복사해서 보내주세요."
          : "복사하거나 저장한 뒤, 테스트를 부탁한 사람에게 카카오톡·메신저로 보내주세요."}</p>
        {!result.ok && <p className="tester-feedback-empty">한 가지 이상 답하면 복사·저장할 수 있어요.</p>}
        {result.ok && result.masked > 0 && <p role="note">연락처처럼 보이는 내용 {result.masked}곳을 글에서 지웠어요.</p>}
        <p role="status">{shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "의견을 클립보드에 복사했어요."
          : shownCopy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 글을 직접 선택해 복사하세요." : ""}</p>
        <p role="status">{shownSave ? saveStatusText[shownSave.status] : ""}</p>
        {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={12} aria-label="테스트 의견 글 (직접 복사)"
          onFocus={event => event.currentTarget.select()} />}
        {storageBlocked && <p role="note">이 브라우저에서는 작성 내용을 임시 보관할 수 없어요. 창을 닫기 전에 복사해 주세요.</p>}

        <div className="tester-feedback-clear">
          {!confirmClear
            ? <button type="button" onClick={() => setConfirmClear(true)} disabled={!hasTesterFeedback(normalized)}>작성 내용 지우기</button>
            : <><span>적은 답을 모두 지울까요?</span><button type="button" onClick={clearAll}>모두 지우기</button><button type="button" onClick={() => setConfirmClear(false)}>취소</button></>}
        </div>
      </form>}
    </dialog>
  </>;
}
