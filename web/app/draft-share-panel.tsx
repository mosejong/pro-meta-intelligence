"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createDraftShareUrl, parseDraftShareUrl, SHARE_SCOPE } from "./draft-share";
import type { DraftSession } from "./draft-session";
import type { RadarReport } from "./radar-types";
import "./draft-share.css";

const subscribe = (notify: () => void) => { window.addEventListener("hashchange", notify); return () => window.removeEventListener("hashchange", notify); };
const locationSnapshot = () => window.location.href;
const message = (error: unknown) => error instanceof Error ? error.message : "밴픽 링크를 읽을 수 없습니다.";
type Preview = { href: string; report: RadarReport; session?: DraftSession; error?: string };

/** "밴 A, B · 픽 C" for one side of a shared draft; empty sides read "아직 없음". */
export function sharedSideSummary(session: DraftSession, side: "BLUE" | "RED", nameOf: (id: string) => string): string {
  const list = (kind: "BAN" | "PICK") => session.selections.filter(s => s.side === side && s.kind === kind).map(s => nameOf(s.champion_id));
  const bans = list("BAN"), picks = list("PICK");
  const parts = [bans.length ? `밴 ${bans.join(", ")}` : "", picks.length ? `픽 ${picks.join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "아직 없음";
}

export function DraftSharePanel({ outgoing, liveReport, ready, incomingReady, onAccept, nameOf = (id) => id }: {
  outgoing: DraftSession; liveReport: RadarReport; ready: boolean; incomingReady: boolean; onAccept: (session: DraftSession) => void; nameOf?: (championId: string) => string;
}) {
  const href = useSyncExternalStore(subscribe, locationSnapshot, () => "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dismissed, setDismissed] = useState("");
  const [copy, setCopy] = useState<{ url: string; status: "copied" | "manual" } | null>(null);
  const mounted = useRef(false);
  const currentUrl = useRef("");
  const previewTarget = useRef<HTMLElement>(null);
  const outgoingLink = useMemo(() => {
    if (!ready || !href) return { url: "", error: "" };
    try { return { url: createDraftShareUrl(href, outgoing), error: "" }; }
    catch (error) { return { url: "", error: message(error) }; }
  }, [href, outgoing, ready]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { currentUrl.current = outgoingLink.url; }, [outgoingLink.url]);
  useEffect(() => {
    if (!incomingReady || !href || !new URL(href).hash.startsWith("#draft=") || dismissed === href || preview?.href === href) return;
    const timeout = window.setTimeout(() => {
      try { setPreview({ href, report: liveReport, session: parseDraftShareUrl(href, liveReport) }); }
      catch (error) { setPreview({ href, report: liveReport, error: message(error) }); }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [href, incomingReady, liveReport, dismissed, preview]);
  const visible = preview?.href === href && dismissed !== href ? preview : null;
  const previewHref = visible?.href ?? "";
  useEffect(() => {
    if (!previewHref) return;
    previewTarget.current?.scrollIntoView({ block: "start" });
    previewTarget.current?.focus({ preventScroll: true });
  }, [previewHref]);
  const close = () => { setDismissed(href); setPreview(null); };
  const stale = visible && visible.report !== liveReport;
  async function copyLink() {
    const url = outgoingLink.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      if (mounted.current && currentUrl.current === url) setCopy({ url, status: "copied" });
    } catch {
      if (mounted.current && currentUrl.current === url) setCopy({ url, status: "manual" });
    }
  }
  function accept() {
    if (!visible?.session || !incomingReady) return;
    try {
      const session = parseDraftShareUrl(href, liveReport);
      if (visible.report !== liveReport) { setPreview({ href, report: liveReport, session }); return; }
      onAccept(session);
      close();
      // The link was used: drop its fragment so a refresh does not ask to load the same draft again.
      // (Cancel keeps it, so a later refresh can still offer the link.)
      if (window.location.hash.startsWith("#draft=")) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch (error) { setPreview({ href, report: liveReport, error: message(error) }); }
  }
  const teams = visible?.session?.report.opponent_prep?.teams ?? [];
  return <section className="draft-share" aria-label="밴픽 링크 공유" lang="ko">
    <p>{SHARE_SCOPE}</p>
    <button type="button" className="draft-share-primary" disabled={!ready || !outgoingLink.url} onClick={() => void copyLink()}>밴픽 링크 복사</button>
    {outgoingLink.error && <p role="status">{outgoingLink.error}</p>}
    {copy?.url === outgoingLink.url && (copy.status === "copied" ? <p role="status">밴픽 링크를 복사했습니다.</p> : <label className="draft-share-fallback">복사하지 못했습니다. 아래 링크를 선택해 복사해 주세요.<input aria-label="복사할 밴픽 링크" readOnly value={copy.url} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} /></label>)}
    {visible && <section ref={previewTarget} tabIndex={-1} className="draft-share-preview" aria-label="공유 밴픽 미리보기">
      <h2>공유 밴픽 미리보기</h2>
      <p>불러오면 현재 밴픽이 바뀝니다. 선수 변경·역할 배정은 포함되지 않습니다.</p>
      <details className="draft-share-basis"><summary>공유 범위·분석 기준</summary><p>{SHARE_SCOPE}</p>
        <p>현재 공개 자료 · 패치 {visible.report.patch_id} · {visible.report.cutoff}</p>
      </details>
      {visible.error ? <p role="alert">이 링크를 불러올 수 없습니다. {visible.error}</p> : <>
        <p>{teams.find(t => t.team_id === visible.session!.blueTeamId)?.team_name} (블루) · {teams.find(t => t.team_id === visible.session!.redTeamId)?.team_name} (레드)</p>
        <ul className="draft-share-picks"><li><b>블루</b> {sharedSideSummary(visible.session!, "BLUE", nameOf)}</li><li><b>레드</b> {sharedSideSummary(visible.session!, "RED", nameOf)}</li></ul>
        <p>{visible.session!.games.length + 1}세트 · 확정 {visible.session!.selections.length}개 · 이전 {visible.session!.games.length}세트{visible.session!.stagedChampion ? " · 올려놓은 챔피언 있음" : ""}</p>
        {stale && <p role="status">공개 자료가 바뀌었습니다. 미리보기를 다시 확인해 주세요.</p>}
        <button type="button" disabled={!incomingReady} onClick={accept}>{stale ? "최신 자료로 미리보기 확인" : "이 밴픽 불러오기"}</button>
      </>}
      <button type="button" onClick={close}>취소</button>
    </section>}
  </section>;
}
