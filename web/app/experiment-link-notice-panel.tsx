"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CHOOSE_REFUSAL_TEXT,
  experimentLinkNotice,
  NOTICE_NEXT_STEPS,
  NOTICE_SUPPORTED,
  NOTICE_UNSUPPORTED,
  noticeValuesText,
  type NoticeContext,
} from "./experiment-link-notice";
import "./experiment-link-notice.css";

type Props = NoticeContext & {
  /**
   * Selects the two link teams (blue, red). Called only from the user's click, only when the current
   * board and series are empty and the teams actually change. Never starts the draft or runs anything.
   */
  onChooseTeams: (blueTeamId: string, redTeamId: string) => void;
};

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => { window.removeEventListener("hashchange", onChange); window.removeEventListener("popstate", onChange); };
}
const currentHref = () => window.location.href;
const serverHref = () => "";

type Outcome = { href: string; text: string; chosen: boolean };

/**
 * "가정값 링크를 받았어요" on the team-selection step. Shows the link's two teams, its assumption values
 * and what it can/cannot fill. "링크의 두 팀으로 고르기" only picks the teams (after the same checks again at
 * click time); "무시" hides the notice for this address until a reload. The `#experiment=` fragment is
 * kept, because the simulation tab's "가정값만 공유" reads it to apply the values later.
 */
export function ExperimentLinkNoticePanel({ onChooseTeams, ...context }: Props) {
  const href = useSyncExternalStore(subscribe, currentHref, serverHref);
  const [dismissed, setDismissed] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (focusRequest) statusRef.current?.focus(); }, [focusRequest]);

  const notice = experimentLinkNotice(href, context);
  if (notice.kind === "NONE" || dismissed === href) return null;
  const shownOutcome = outcome?.href === href ? outcome : null;

  function choose() {
    // Re-read the address and the current context at click time; an earlier preview is never applied.
    const fresh = experimentLinkNotice(window.location.href, context);
    if (fresh.kind !== "RECEIVED" || notice.kind !== "RECEIVED" || fresh.encoded !== notice.encoded) {
      setOutcome({ href, text: "주소의 링크가 바뀌어 이전 안내는 적용하지 않았어요.", chosen: false });
    } else if (!fresh.choose.ok) {
      setOutcome({ href, text: CHOOSE_REFUSAL_TEXT[fresh.choose.reason], chosen: false });
    } else {
      if (!fresh.choose.alreadySelected) onChooseTeams(fresh.choose.blueTeamId, fresh.choose.redTeamId);
      setOutcome({ href, chosen: true, text: fresh.choose.alreadySelected
        ? "이미 링크의 두 팀이 선택되어 있어 그대로 두었어요. 가정값은 아직 적용하지 않았고, 실행도 하지 않았어요."
        : "링크의 두 팀을 골랐어요. 가정값은 아직 적용하지 않았고, 실행도 하지 않았어요." });
    }
    setFocusRequest((n) => n + 1);
  }
  function dismiss() {
    setDismissed(href);
    setOutcome(null);
    // The notice disappears; keep keyboard focus on the step instead of losing it to the page.
    document.getElementById("draft-flow-setup-title")?.focus();
  }

  return <section className="experiment-link-notice" lang="ko" aria-labelledby="experiment-link-notice-title">
    <h3 id="experiment-link-notice-title">가정값 링크를 받았어요</h3>
    {notice.kind === "INVALID" ? <>
      <p role="alert">{notice.message} 지금 화면은 그대로 둡니다.</p>
      <div className="experiment-link-notice-actions"><button type="button" onClick={dismiss}>닫기</button></div>
    </> : <>
      <ul className="experiment-link-notice-teams">{notice.teams.map((team) => <li key={team.id}>
        <b>{team.name ?? "현재 자료에 없는 팀"}</b>{team.name ? null : <small> ({team.id})</small>}
        <span>{noticeValuesText(team.values)}</span>
      </li>)}</ul>
      <p className="experiment-link-notice-meta">재현 번호 {notice.seedText} · 패치 {notice.link.patch}{notice.patchMatches ? " (현재 자료와 같음)" : " (현재 자료와 다름)"}</p>
      <details className="experiment-link-notice-scope">
        <summary>링크로 할 수 있는 것과 없는 것</summary>
        <p>{NOTICE_SUPPORTED}</p>
        <p>{NOTICE_UNSUPPORTED}</p>
        <p>가정 실험은 사용자 가정에 따른 추상 모델이며 실제 승률·선수 실력·경기 예측이 아닙니다. 링크 숫자는 누구나 고칠 수 있어 원본 실험의 증명도 아닙니다.</p>
      </details>
      {!notice.choose.ok && !shownOutcome && <p className="experiment-link-notice-reason" id="experiment-link-notice-reason">{CHOOSE_REFUSAL_TEXT[notice.choose.reason]}</p>}
      <div className="experiment-link-notice-actions">
        <button type="button" className="experiment-link-notice-primary" disabled={!notice.choose.ok}
          aria-describedby={!notice.choose.ok && !shownOutcome ? "experiment-link-notice-reason" : undefined} onClick={choose}>링크의 두 팀으로 고르기</button>
        <button type="button" onClick={dismiss}>무시</button>
      </div>
    </>}
    <p ref={statusRef} tabIndex={-1} className="experiment-link-notice-status" role="status">{shownOutcome?.text ?? ""}</p>
    {shownOutcome?.chosen && <div className="experiment-link-notice-next">
      <p>남은 단계 (모두 직접 진행):</p>
      <ol>{NOTICE_NEXT_STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
      <p>진영(블루/레드)은 링크에 없어 바꿔도 가정값 적용에는 영향이 없어요.</p>
    </div>}
  </section>;
}

export default ExperimentLinkNoticePanel;
