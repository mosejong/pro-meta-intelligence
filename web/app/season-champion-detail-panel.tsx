"use client";
import { useEffect, useLayoutEffect, useRef, type Ref } from "react";
import { championRoleLabels, summarizeChampionEvidence } from "./draft-champion-info";
import type { OpponentTeam, RadarReport } from "./radar-types";
import type { SeasonChampionDetail } from "./season-champion-detail";
import { seasonPoolStateLabel } from "./season-pool-context";

/** Current publication context for the "현재 발행본" half; omitted = not connected on this screen. */
export type SeasonChampionAnalysis = { report: RadarReport; blueTeam: OpponentTeam | null; redTeam: OpponentTeam | null };

const roleLabel = (role: string) => championRoleLabels[role] ?? `역할 미확인(${role})`;
const summaryText = (label: string, count: number | null) => count === null ? `${label} 집계 미확인` : `${label} ${count}경기`;

/**
 * Read-only detail for one champion opened from the season player comparison. The season half is
 * that player/season/role card's own observation; the current half is the frozen public report.
 * The two samples are shown separately and never merged, and nothing here touches the draft.
 */
export function SeasonChampionDetailView({ detail, analysis, nameOf, onClose, headingRef }: {
  detail: SeasonChampionDetail; analysis: SeasonChampionAnalysis | null; nameOf: (championId: string) => string;
  onClose: () => void; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const name = nameOf(detail.champion_id);
  const section = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  // Escape anywhere inside the detail closes it (focus then returns to the champion that opened it).
  useEffect(() => {
    const node = section.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); } };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, []);
  const summary = analysis ? summarizeChampionEvidence(analysis.report, analysis.blueTeam, analysis.redTeam, detail.champion_id) : null;
  return <section ref={section} className="season-champ-detail" aria-label={`${name} 시즌 관측·현재 분석`} data-champion={detail.champion_id}>
    <header>
      <h5 ref={headingRef} tabIndex={-1}>{name} · {roleLabel(detail.role)} 상세</h5>
      <button type="button" onClick={onClose}>상세 닫기</button>
    </header>
    <p><small>이번 밴픽 상태: {seasonPoolStateLabel[detail.state]} · 읽기 전용이며 밴픽 선택·추천에 반영하지 않습니다.</small></p>
    <div className="season-champ-detail-part" data-part="season">
      <b>시즌 관측 (선수·시즌·역할별 당시 기록)</b>
      <ul>{detail.sides.map(side => <li key={side.side} data-side={side.side} data-observed={side.games === null ? "false" : "true"}>
        {side.side === "BLUE" ? "블루" : "레드"} · {side.season} {side.player_name} · {roleLabel(side.role)} · 표본 {side.game_count}경기 · {side.games === null
          ? <>{name} 미관측 <small>(0회가 아니라 이 시즌 카드에 기록 없음)</small></>
          : <>{name} {side.games}회 관측</>}
        <br /><small>{side.team_names.join(" / ")} 당시 표기 · 현재 숙련도 아님</small>
      </li>)}</ul>
    </div>
    <div className="season-champ-detail-part" data-part="current" data-analysis={summary ? "linked" : "unlinked"}>
      {!analysis || !summary
        ? <><b>현재 발행본 분석</b><p>현재 발행본 분석이 이 화면에 연결되지 않아 표시하지 않습니다.</p></>
        : <>
          <b>현재 발행본 분석 · 패치 {analysis.report.patch_id} · 기준 {analysis.report.cutoff.slice(0, 16).replace("T", " ")}</b>
          {summary.has_public_sample ? <ul>
            <li>공개 기록 역할: {summary.observed_roles.length ? summary.observed_roles.map(roleLabel).join(" · ") : "관측 없음"}</li>
            {summary.teams.map(team => <li key={team.side}>{team.team_name} 팀 공개 요약 · {summaryText("픽", team.summary_pick_count)} · {summaryText("밴", team.summary_ban_count)}
              <small> · {team.recent_game_count ? `최근 기록 ${team.recent_game_count}경기 중 픽 ${team.recent_pick_count}경기` : "최근 경기 기록 없음"}</small></li>)}
            {summary.radar.map(entry => <li key={entry.role}>메타 레이더 · {roleLabel(entry.role)} · 최근 구간 픽 {entry.current_pick_count} · {entry.current_distinct_team_count}개 팀 <small>· {entry.eligible_for_review ? "검토 후보" : "표본 기준 미달"} · 근거 {entry.evidence_count}건</small></li>)}
          </ul> : <p>현재 발행본(두 팀 공개 요약·메타 레이더)에서 미관측입니다. 0회나 약하다는 뜻이 아닙니다.</p>}
          <p><small>팀 단위 공개 기록이며 위 시즌 선수 개인 기록과 표본이 달라 합치지 않습니다.</small></p>
        </>}
    </div>
  </section>;
}
