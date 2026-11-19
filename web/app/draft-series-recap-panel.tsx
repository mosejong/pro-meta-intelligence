"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DraftGame } from "./draft-agent";
import { buildSeriesRecap, type SeriesRecap, type SeriesRecapSide, type SeriesRecapUnsupported } from "./draft-series-recap";
import { buildSeriesRecapText, type SeriesRecapTextRefusal } from "./draft-series-recap-text";
import type { RadarReport } from "./radar-types";
import "./draft-series-recap.css";

const reasonText: Record<SeriesRecapUnsupported, string> = {
  INVALID_REPORT: "팀 자료 형식을 확인하지 못해 이 시리즈를 복기하지 않아요.",
  INVALID_GAME:"기록된 밴픽이 피어리스 규칙이나 챔피언 목록과 맞는지 확인하지 못했어요.",
  INCOMPLETE_GAME: "20턴이 모두 기록되지 않아 복기하지 않아요.",
  UNKNOWN_TEAM: "당시 팀을 현재 자료에서 찾지 못했어요. 다른 팀으로 추정하지 않아요.",
  PAIR_MISMATCH: "앞 세트와 다른 팀 조합이라 같은 시리즈로 확인하지 못했어요.",
  DEPENDS_ON_UNVERIFIED: "앞 세트를 확인하지 못해 이 세트의 잠금도 확인할 수 없어요.",
};

const shareRefusalText: Record<SeriesRecapTextRefusal, string> = {
  NO_FINISHED_GAME: "완료한 세트가 없어 복사할 수 없어요.",
  UNSUPPORTED_GAME: "확인하지 못한 세트가 있어 여러 세트 글 전체를 복사하지 않아요.",
  UNVERIFIED_TOTAL: "전체 잠금 수가 미확인이라 여러 세트 글을 복사하지 않아요.",
  INVALID_RECAP: "복기 형식을 확인하지 못해 복사하지 않아요.",
};
type CopyState = { recap: SeriesRecap; nameOf: (id: string) => string; patchId: string; cutoff: string; text: string; status: "copying" | "copied" | "manual" };

/** Collapsed, read-only recap of finished Fearless games. No winners, rates, scores or auto-choice reasons. */
export function DraftSeriesRecapPanel({ report, games, current, nameOf }: {
  report: RadarReport; games: DraftGame[]; current: DraftGame | null; nameOf: (id: string) => string;
}) {
  const recap = useMemo(() => buildSeriesRecap({ report, games, current }), [report, games, current]);
  const patchId = report?.opponent_prep?.patch_id ?? "";
  const cutoff = report?.opponent_prep?.cutoff ?? "";
  // Built from the recap already on screen; copying never re-runs the recap or the result builder.
  const share = useMemo(() => buildSeriesRecapText({ recap, patchId, cutoff, nameOf }), [recap, patchId, cutoff, nameOf]);
  const [copy, setCopy] = useState<CopyState | null>(null);
  /** Bumped whenever recap/nameOf/patch/cutoff change and on unmount; a copy finishing later is ignored. */
  const copyToken = useRef(0);
  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [recap, nameOf, patchId, cutoff]);
  // Show a copy state only for exactly the current inputs (guards the render before the effect runs).
  const shownCopy = copy && copy.recap === recap && copy.nameOf === nameOf && copy.patchId === patchId && copy.cutoff === cutoff ? copy : null;
  async function copyText() {
    if (!share.ok) return;
    const token = ++copyToken.current;
    const base = { recap, nameOf, patchId, cutoff, text: share.text };
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ ...base, status: "manual" }); return; }
    setCopy({ ...base, status: "copying" });
    let ok = false;
    try { await writeText(share.text); ok = true; } catch { ok = false; }
    if (copyToken.current !== token) return; // inputs changed or unmounted meanwhile
    setCopy({ ...base, status: ok ? "copied" : "manual" });
  }
  if (!recap.games.length) return null;
  const names = (ids: string[]) => ids.length ? ids.map(nameOf).join(" · ") : "없음";
  const side = (team: SeriesRecapSide) => <article key={team.side} className={team.side.toLowerCase()}>
    <h4><small>{team.side === "BLUE" ? "블루" : "레드"}</small> {team.team_name}</h4>
    <dl>
      <dt>픽</dt><dd>{names(team.picks)}</dd>
      <dt>밴</dt><dd>{names(team.bans)}</dd>
      <dt>양 팀 기록에 겹친 픽</dt><dd>{team.contested_claims.length ? team.contested_claims.map(c => `${nameOf(c.champion_id)} (우리 ${c.own_games}회 / 상대 ${c.opponent_games}회)`).join(" · ") : "확인된 기록 없음"}</dd>
      <dt>상대 기록에 있는 밴</dt><dd>{team.target_bans.length ? team.target_bans.map(b => `${nameOf(b.champion_id)} (상대 ${b.opponent_games}회)`).join(" · ") : "확인된 기록 없음"}</dd>
    </dl>
  </article>;
  return <details className="draft-series-recap" lang="ko">
    <summary>여러 세트 복기 · {recap.games.length}세트</summary>
    <div className="draft-series-recap-body">
      <p>완료한 세트를 순서대로 다시 확인했어요. 각 세트의 팀과 진영은 그 세트를 마쳤을 때 기록 그대로예요.</p>
      {recap.games.map(game => <section key={game.game} className="draft-series-recap-game" aria-label={`${game.game}세트 복기`}>
        <h3>{game.game}세트{game.current ? " · 방금 완료" : ""}</h3>
        {game.status === "READY" ? <>
          <p>선픽 {game.first_pick_side === "BLUE" ? "블루" : "레드"} · 이 세트 전에 잠긴 챔피언 {game.locks_before.length}개</p>
          <div className="draft-series-recap-teams">{game.sides.map(side)}</div>
          <p>다음 세트부터 잠기는 픽: {names(game.new_locks)}</p>
        </> : <p role="status">확인하지 못함 · {reasonText[game.reason]}</p>}
      </section>)}
      <p>{recap.total_locks ? `지금까지 잠긴 챔피언 ${recap.total_locks.length}개` : "확인하지 못한 세트가 있어 전체 잠금 수는 미확인이에요."}</p>
      <p>현재 공개 자료의 우선 픽 요약과 대조한 기록일 뿐이에요. 기록에 없으면 0회가 아니라 미확인이며, 경기 승패·승률·픽의 가치나 자동 상대가 고른 이유를 나타내지 않아요.</p>
      <div className="draft-series-recap-share">
        <button type="button" disabled={!share.ok || shownCopy?.status === "copying"} onClick={copyText}
          aria-describedby={!share.ok ? "draft-series-recap-share-reason" : undefined}>여러 세트 밴픽 복사</button>
        {!share.ok && <p id="draft-series-recap-share-reason">{shareRefusalText[share.reason]}</p>}
        <p role="status">{shownCopy?.status === "copying" ? "복사하는 중…" : shownCopy?.status === "copied" ? "여러 세트 밴픽을 클립보드에 복사했어요."
          : shownCopy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 글을 직접 선택해 복사하세요." : ""}</p>
        {shownCopy?.status === "manual" && <textarea readOnly value={shownCopy.text} rows={12} style={{ width: "100%" }}
          aria-label="여러 세트 밴픽 글 (직접 복사)" onFocus={(e) => e.currentTarget.select()} />}
      </div>
    </div>
  </details>;
}
