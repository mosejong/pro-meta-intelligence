/* eslint-disable @next/next/no-img-element -- champion portraits use the stable Riot CDN in both builds */

import { championImageUrl } from "./champion-assets";
import type { TargetProfile } from "./target-profile";

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function points(value: number) {
  const amount = value * 100;
  return `${amount > 0 ? "+" : ""}${amount.toFixed(0)}pp`;
}

function shortDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(parsed);
}

export function TargetProfilePanel({ profile, onDownload }: { profile: TargetProfile; onDownload: () => void }) {
  const topPick = profile.focus.priority_pick;
  const latest = profile.recent_games[0];
  const currentPlayers = profile.players.filter((player) => player.roster_status !== "OTHER_OBSERVED").slice(0, 5);
  const otherLineupCount = profile.players.filter((player) => player.roster_status === "OTHER_OBSERVED").length;
  return <section className="target-profile" id="target-profile" aria-label={`${profile.target.team_name} 타깃 프로필`}>
    <header className="target-profile-head">
      <div className="target-lock" aria-hidden="true"><span>TARGET</span><strong>T1</strong></div>
      <div><span>T1 TARGET PROFILE · PUBLIC STAGE ONLY</span><h3>T1의 이번 패치에서 바뀐 것</h3><p>선수별 공개 대회 픽, 패치 변화, 최근 경기 순서를 한 화면에 묶었습니다. 빈도는 다음 경기 의도나 숙련도 예측이 아닙니다.</p></div>
      <button type="button" onClick={onDownload}>T1 프로필 JSON</button>
    </header>

    <div className="target-kpis">
      <article><span>분석 표본</span><strong>{profile.target.game_count}G</strong><small>{profile.target.record} · {profile.target.leagues.join("/")}</small></article>
      <article><span>선픽 보유</span><strong>{percent(profile.target.first_pick_rate)}</strong><small>전체 드래프트 1번 픽 기준</small></article>
      <article>{topPick ? <><span>최다 관측 픽</span><strong>{topPick.champion_id}</strong><small>{roleLabels[topPick.role ?? ""] ?? topPick.role ?? "역할 미상"} · {percent(topPick.game_rate)}</small></> : <><span>최다 관측 픽</span><strong>—</strong><small>표본 없음</small></>}</article>
      <article><span>마지막 경기</span><strong>{latest ? shortDate(latest.observed_at) : "—"}</strong><small>{latest ? `${latest.result === "WIN" ? "승" : "패"} · vs ${latest.opponent_team_name}` : "경기 타임라인 없음"}</small></article>
    </div>

    <div className="target-profile-grid">
      <article className="target-player-board">
        <header><div><span>PLAYER × CHAMPION</span><h4>최근 관측 라인업의 챔피언 풀</h4></div><b>현재 {currentPlayers.length}명{otherLineupCount ? ` · 기타 ${otherLineupCount}명 분리` : ""}</b></header>
        {currentPlayers.length ? <div className="target-player-list">{currentPlayers.map((player) => {
          const lead = player.champions[0];
          return <div className="target-player" key={player.player_id}>
            {lead ? <img src={championImageUrl(lead.champion_id)} alt="" loading="lazy" /> : <span className="target-player-placeholder" />}
            <div><span>{roleLabels[player.role] ?? player.role}</span><strong>{player.player_name}</strong><small>{player.game_count}경기 공개 표본</small></div>
            <div className="target-player-pool">{player.champions.slice(0, 3).map((champion) => <span key={champion.champion_id}><img src={championImageUrl(champion.champion_id)} alt="" loading="lazy" /><b>{champion.champion_id}</b><small>{percent(champion.game_rate)}</small></span>)}</div>
          </div>;
        })}</div> : <p className="target-profile-empty">이 피드에는 선수 식별 필드가 없습니다. 팀 픽을 특정 선수 숙련도로 대신 표시하지 않습니다.</p>}
      </article>

      <div className="target-activity">
        <article className="target-patch-shift">
          <header><div><span>PATCH SHIFT</span><h4>이전 패치와 달라진 픽</h4></div><b>{profile.patch_shift.status === "OBSERVED" ? `${profile.patch_shift.previous_patch_id} → ${profile.patch_id}` : "기준 부족"}</b></header>
          {profile.patch_shift.status === "OBSERVED" ? <div className="patch-shift-columns">
            <section><span>새로 올라온 픽</span>{profile.patch_shift.emerging.length ? profile.patch_shift.emerging.map((item) => <div key={`${item.champion_id}:${item.role}`}><img src={championImageUrl(item.champion_id)} alt="" loading="lazy" /><p><strong>{item.champion_id}</strong><small>{roleLabels[item.role] ?? item.role} · {percent(item.current_game_rate)}</small></p><b>{points(item.delta)}</b></div>) : <p>상승 변화 없음</p>}</section>
            <section><span>줄어든 픽</span>{profile.patch_shift.cooling.length ? profile.patch_shift.cooling.map((item) => <div key={`${item.champion_id}:${item.role}`}><img src={championImageUrl(item.champion_id)} alt="" loading="lazy" /><p><strong>{item.champion_id}</strong><small>{roleLabels[item.role] ?? item.role} · 이전 {percent(item.previous_game_rate)}</small></p><b>{points(item.delta)}</b></div>) : <p>하락 변화 없음</p>}</section>
          </div> : <p className="target-profile-empty">같은 팀 ID의 이전 패치 경기 표본이 없어 변화를 계산하지 않았습니다.</p>}
        </article>

        <article className="target-game-timeline">
          <header><div><span>RECENT GAMES</span><h4>최근 경기 타임라인</h4></div><b>{profile.series_tracking.provider_series_id_available ? `${profile.series_tracking.series_count}개 시리즈` : "경기 단위"}</b></header>
          {profile.recent_games.length ? <div>{profile.recent_games.map((game) => <div className="target-game" key={game.match_id}>
            <span className={`target-result ${game.result.toLowerCase()}`}>{game.result === "WIN" ? "W" : "L"}</span>
            <p><strong>vs {game.opponent_team_name}</strong><small>{shortDate(game.observed_at)} · {game.side === "BLUE" ? "블루" : "레드"} · {game.first_pick ? "선픽" : "후픽"}</small></p>
            <div>{game.picks.slice(0, 5).map((pick) => <img src={championImageUrl(pick.champion_id)} alt={pick.champion_id} title={`${pick.player_name ?? roleLabels[pick.role] ?? pick.role} · ${pick.champion_id}`} loading="lazy" key={pick.evidence_event_id} />)}</div>
          </div>)}</div> : <p className="target-profile-empty">경기별 타임라인이 없는 구형 피드입니다.</p>}
          <footer>{profile.series_tracking.boundary}</footer>
        </article>
      </div>
    </div>

    <div className={`target-matchup-strip ${profile.matchup ? "ready" : "setup"}`}>
      <div><span>MY TEAM × T1</span><h4>{profile.matchup ? `${profile.matchup.own_team_name} 기준 충돌 지점` : "내 팀을 선택하면 T1전 질문이 완성됩니다"}</h4><p>{profile.matchup?.staff_questions[0] ?? "공개 픽이 겹치는 지점과 T1이 자주 닫은 우리 자원을 분리해 보여줍니다."}</p></div>
      {profile.matchup ? <div className="target-matchup-counts"><span><b>{profile.matchup.protect_count}</b>보호</span><span><b>{profile.matchup.contested_count}</b>충돌</span><span><b>{profile.matchup.deny_review_count}</b>견제 검토</span><span><b>{profile.matchup.exchange_available ? "1" : "0"}</b>교환안</span></div> : <a href="#team-setup">내 팀 선택 ↑</a>}
    </div>

    <footer className="target-profile-boundary"><b>해석 경계</b><p>{profile.unknowns.join(" · ")}</p><span>{profile.evidence.match_ids.length} MATCHES · {profile.evidence.draft_event_ids.length} EVENTS</span></footer>
  </section>;
}
