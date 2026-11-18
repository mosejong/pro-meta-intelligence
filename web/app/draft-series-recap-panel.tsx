"use client";
import { useMemo } from "react";
import type { DraftGame } from "./draft-agent";
import { buildSeriesRecap, type SeriesRecapSide, type SeriesRecapUnsupported } from "./draft-series-recap";
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

/** Collapsed, read-only recap of finished Fearless games. No winners, rates, scores or auto-choice reasons. */
export function DraftSeriesRecapPanel({ report, games, current, nameOf }: {
  report: RadarReport; games: DraftGame[]; current: DraftGame | null; nameOf: (id: string) => string;
}) {
  const recap = useMemo(() => buildSeriesRecap({ report, games, current }), [report, games, current]);
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
    </div>
  </details>;
}
