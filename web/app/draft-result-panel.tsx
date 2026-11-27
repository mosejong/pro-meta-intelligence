"use client";
/* eslint-disable @next/next/no-img-element -- champion portraits use the existing Riot Data Dragon CDN */
import { useEffect, useMemo, useRef, useState } from "react";
import { championImageUrl } from "./champion-assets";
import { buildDraftResultImageModel, createDraftResultPng, downloadBlob, draftResultImageFileName } from "./draft-result-image";
import { buildDraftResultReport } from "./draft-result-report";
import type { DraftSelection, DraftSide } from "./draft-agent";
import type { DraftPositionRecord } from "./draft-position-session";
import type { OpponentTeam, RadarReport } from "./radar-types";
import "./solo-draft.css";
const roleName: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", ADC: "바텀", SUPPORT: "서포터" };
/** Native share sheet when available (phones), otherwise copy the link. Returns the status line to show. */
export async function shareDraftLink(url: string, title: string, nav: Partial<Pick<Navigator, "share" | "clipboard">> = globalThis.navigator ?? {}): Promise<string | null> {
  if (typeof nav.share === "function") {
    try { await nav.share({ title, text: title, url }); return null; }
    catch (error) { if (error instanceof Error && error.name === "AbortError") return null; }
  }
  try { await nav.clipboard?.writeText(url); if (nav.clipboard) return "밴픽 링크를 복사했어요. 카톡·디스코드에 붙여넣어 보내세요."; } catch { /* fall through */ }
  return "이 브라우저에서는 공유할 수 없어요. 아래 '친구와 밴픽'에서 링크를 직접 복사해 주세요.";
}

export function DraftResultPanel({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide, nameOf, onReplay, onNext, disabled, autoReveal = false, positionRecord, onOpenSimulation, shareUrl, onChangePick, changeableSides = [] }: {
  report: RadarReport; blueTeam: OpponentTeam | null; redTeam: OpponentTeam | null; selections: DraftSelection[]; previousPicks: string[]; firstPickSide: DraftSide;
  nameOf: (id: string) => string; onReplay: () => void; onNext: () => void; disabled: boolean; autoReveal?: boolean;
  /** Builds the shareable draft link; omitted (or null) hides the share button. */
  shareUrl?: () => string | null;
  /** Rewinds to just before that pick so it can be replaced; omitted hides the per-pick button. */
  onChangePick?: (side: DraftSide, championId: string) => void;
  changeableSides?: DraftSide[];
  /** Optional explicit position work; omitted keeps the legacy image. Only used for the PNG, re-validated there. */
  positionRecord?: DraftPositionRecord | null;
  /** Optional navigation only: opens the existing simulation input gate. Omitted (e.g. room mode) hides the button. Never runs a simulation. */
  onOpenSimulation?: () => void;
}) {
  const result = useMemo(() => buildDraftResultReport({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide }), [report, blueTeam, redTeam, selections, previousPicks, firstPickSide]);
  const root = useRef<HTMLElement | null>(null);
  const currentResult = useRef(result);
  useEffect(() => { currentResult.current = result; }, [result]);
  const saving = useRef(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageMessage, setImageMessage] = useState("");
  const saveImage = async () => {
    if (saving.current || disabled || result.status !== "READY") return;
    saving.current = true; setImageBusy(true); setImageMessage("이미지를 만드는 중이에요…");
    const snapshot = result;
    try {
      // Fixed input captured at click time; later result changes do not affect this file.
      // The builder is synchronous and copies only strings, so later position edits cannot leak in.
      const model = buildDraftResultImageModel({ result: snapshot, selections: selections.map(s => ({ ...s })), patchId: report.patch_id, dataCutoff: report.analysis_window?.availability_cutoff ?? report.cutoff, nameOf,
        ...(positionRecord !== undefined ? { positionRecord } : {}) });
      const blob = await createDraftResultPng(model);
      downloadBlob(blob, draftResultImageFileName(model));
      const stale = currentResult.current !== snapshot;
      setImageMessage(stale ? "버튼을 누른 시점의 이전 밴픽 결과 이미지로 다운로드를 요청했어요. 지금 화면의 결과와 다를 수 있고, 실제 저장 여부와 위치는 브라우저에 따라 달라요." : "이미지 다운로드를 요청했어요. 휴대폰 브라우저에 따라 다운로드 폴더나 파일 앱에 저장되거나, 새 창에서 길게 눌러 저장해야 할 수 있어요.");
    } catch {
      setImageMessage("이미지를 만들지 못했어요. 밴픽 결과는 그대로 유지돼요. 잠시 후 다시 시도해 주세요.");
    } finally { saving.current = false; setImageBusy(false); }
  };
  useEffect(() => {
    if (!autoReveal || result.status !== "READY") return;
    const frame = window.requestAnimationFrame(() => root.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [autoReveal, result.status]);
  if (result.status !== "READY") return result.status === "INVALID" ? <section className="draft-result" lang="ko" role="status">이번 밴픽은 리포트가 지원하는 팀·챔피언·규칙과 일치하는지 확인하지 못했습니다. 선택은 유지하며 결과를 추정하지 않습니다.</section> : null;
  return <section ref={root} id="draft-result" className="draft-result" lang="ko" aria-label="이번 밴픽 리포트">
    <header><div><small>밴픽 완료</small><h2>이번 선택으로 무엇을 가져왔을까?</h2></div><span>패치 {report.patch_id}</span></header>
    {/* Next actions first: on phones the report below is about two screens tall. */}
    <div className="draft-result-actions">{shareUrl ? <button type="button" className="draft-result-share" disabled={disabled} onClick={() => { const url = shareUrl(); if (!url) { setImageMessage("지금은 공유 링크를 만들 수 없어요. 잠시 후 다시 시도해 주세요."); return; } void shareDraftLink(url, `${blueTeam?.team_name ?? "블루"} vs ${redTeam?.team_name ?? "레드"} 모의 밴픽`).then(msg => { if (msg) setImageMessage(msg); }); }}>친구에게 공유</button> : null}<button type="button" disabled={disabled} onClick={onReplay}>같은 팀으로 다시 도전</button><button type="button" disabled={disabled} onClick={onNext}>피어리스 다음 세트</button><button type="button" disabled={disabled || imageBusy} aria-busy={imageBusy} onClick={() => { void saveImage(); }}>{imageBusy ? "이미지 만드는 중…" : "밴픽 결과 이미지 저장"}</button>{onOpenSimulation ? <button type="button" className="draft-result-simulation" disabled={disabled} onClick={onOpenSimulation}>가정 시뮬레이션 준비</button> : null}</div>
    {imageMessage ? <p className="draft-result-image-status" role="status">{imageMessage}</p> : null}
    <p>양 팀의 공개 픽 기록과 이번 밴픽을 대조했어요. 다음 판에서 열어줄 카드와 먼저 가져올 카드를 바꿔 보세요.</p>
    <div className="draft-result-teams">{result.sides.map(team => <article key={team.side} className={team.side.toLowerCase()}>
      <h3><small>{team.side === "BLUE" ? "블루" : "레드"}</small> {team.team_name}</h3><p>팀 공개 표본 {team.game_count}경기 · 아래 횟수는 해당 챔피언의 관측 요약</p>
      <ol className="draft-result-picks">{team.picks.map(pick => <li key={pick.champion_id}><img src={championImageUrl(pick.champion_id)} alt="" /><div><strong>{nameOf(pick.champion_id)}</strong>{pick.own_games === null && pick.opponent_games === null && !pick.roles.length
        ? <small>두 팀 공개 기록·관측 역할 모두 미확인</small>
        : <><small>우리 기록 {pick.own_games === null ? "미확인" : `${pick.own_games}회`} · 상대 기록 {pick.opponent_games === null ? "미확인" : `${pick.opponent_games}회`}</small><small>{pick.roles.length ? `관측 역할 ${pick.roles.map(r => roleName[r] ?? r).join(" · ")}` : "관측 역할 미확인"}</small></>}</div>{onChangePick && changeableSides.includes(team.side) ? <button type="button" className="draft-result-change-pick" disabled={disabled} onClick={() => onChangePick(team.side, pick.champion_id)} aria-label={`${nameOf(pick.champion_id)} 픽 바꾸기`}>이 픽 바꾸기</button> : null}</li>)}</ol>
      <h4>양 팀 기록에 겹치는 픽을 확보했어요</h4>
      {team.contested_claims.length ? <ul>{team.contested_claims.map(item => <li key={item.champion_id}><b>{nameOf(item.champion_id)}</b> · 우리 {item.own_games}회 / 상대 {item.opponent_games}회 관측</li>)}</ul> : <p>양 팀의 우선 픽 요약에 함께 나온 카드를 확보한 기록은 없어요.</p>}
      <h4>상대 주력 기록에서 밴한 카드</h4>
      {team.target_bans.length ? <ul>{team.target_bans.map(item => <li key={item.champion_id}><b>{nameOf(item.champion_id)}</b> · 상대 {item.opponent_games}회 관측</li>)}</ul> : <p>이번 밴과 겹치는 상대 우선 픽 기록이 없어요. 밴이 나빴다는 뜻은 아니에요.</p>}
      <h4>다음에는 이 카드도 살펴봐요</h4>
      {team.missed_priorities.length ? <ul>{team.missed_priorities.map(item => <li key={item.champion_id}><b>{nameOf(item.champion_id)}</b> · {item.game_count}회 관측 · {item.disposition === "OPEN" ? "이번 밴픽에 남겨둠" : item.disposition === "BANNED" ? "이번에 밴됨" : "상대가 가져감"}</li>)}</ul> : <p>남은 우선 픽 요약에서 비교할 카드가 없어요.</p>}
    </article>)}</div>
    <p className="draft-result-boundary">현재 공개 자료의 우선 픽 요약을 비교합니다. 여러 역할의 기록이 겹치면 횟수를 합산하지 않고 가장 큰 관측 행을 표시합니다. 횟수가 높다고 강한 픽이나 좋은 밴이라는 뜻은 아니며, 기록에 없으면 0회가 아닌 미확인입니다. 역할은 관측 정보이며 배정 결과가 아닙니다. 경기 승패·시너지·상성은 계산하지 않습니다.</p>
  </section>;
}
