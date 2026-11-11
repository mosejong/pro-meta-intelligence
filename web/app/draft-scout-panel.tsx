import { useState } from "react";
import type { DraftSelection, DraftSide } from "./draft-agent";
import { DraftExchangePanel } from "./draft-exchange-panel";
import { DRAFT_SCOUT_PACKS, DRAFT_SCOUT_VALIDATION, buildDraftScoutBrief, draftScoutFor, formatRate, headToHeadSeries, headToHeadStaples } from "./draft-scout";
import { formatKst, worldsQuarterfinalFor } from "./worlds-preparation";
import "./draft-scout.css";

const roleLabels: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const leagueLabels: Record<string, string> = { INTERNATIONAL: "국제대회" };

export function DraftScoutPanel({ nameOf, previousPicks = [], selections = [], blueTeamId, redTeamId, firstPickSide = "BLUE" }: {
  nameOf: (championId: string) => string; previousPicks?: string[]; selections?: DraftSelection[];
  blueTeamId?: string; redTeamId?: string;
  firstPickSide?: DraftSide;
}) {
  const quarterfinal = worldsQuarterfinalFor("T1");
  const [chosen, setChosen] = useState<string | null>(null);
  const code = chosen ?? quarterfinal?.opponent ?? null;
  const pack = draftScoutFor(code);
  if (!quarterfinal || !code || !pack) return null;
  const isNext = code === quarterfinal.opponent;
  const connected = Boolean(blueTeamId && redTeamId && (
    (pack.own.team_ids.includes(blueTeamId) && pack.target.team_ids.includes(redTeamId)) ||
    (pack.own.team_ids.includes(redTeamId) && pack.target.team_ids.includes(blueTeamId))));
  const brief = buildDraftScoutBrief(pack, connected ? previousPicks : [], connected ? selections : []);
  const { target, own } = pack;
  const lock = (locked: boolean) => locked ? <em>사용 불가 · 확정 밴픽/이전 픽</em> : null;
  const check = DRAFT_SCOUT_VALIDATION;
  const teamCheck = check.teams[code];
  const leagues = (counts: Record<string, number>) => Object.entries(counts).map(([league, count]) => `${league} ${count}`).join(" · ");
  return <details className="draft-scout" id="draft-scout" open>
    <summary><strong>T1 vs {code} · 밴픽 스카우팅</strong><span>{isNext ? `8강 ${formatKst(quarterfinal.start_at)}` : "4강 이후 후보 미리보기"} · 밴픽 단계에서 주도권을 가져오기 위한 근거</span></summary>
    <div className="draft-scout-content">
      <p role="status">{connected ? `현재 연습 대진 연결 · 확정 밴픽 ${selections.length}개와 이전 세트 픽을 후보에서 제외합니다.` :
        "독립 스카우팅 보기 · 현재 연습 대진과 달라 밴픽 잠금을 적용하지 않습니다."}</p>
      <p>후보 갱신은 사용 불가 챔피언 제외입니다. 상대 조합에 대한 카운터나 남은 역할 확정은 추론하지 않습니다.</p>
      <label className="draft-scout-picker">상대 선택
        <select value={code} onChange={(event) => setChosen(event.target.value)}>
          {Object.keys(DRAFT_SCOUT_PACKS).map((option) => <option key={option} value={option}>
            {option} · {option === quarterfinal.opponent ? "8강 상대" : "8강 진출 · 4강 이후 후보"}
          </option>)}
        </select>
      </label>
      <p className="draft-scout-window">{pack.cutoff.slice(0, 10)} 기준 시즌 공개 경기 · {code} 최근 {target.game_count}경기 ({leagues(target.leagues)}) · T1 최근 {own.game_count}경기 ({leagues(own.leagues)}) · 패치 {target.patches[0]}–{target.patches.at(-1)}
        {pack.quality_flags.includes("CURRENT_EVENT_GAMES_MISSING") && <b> · 월즈 스위스 경기 미포함</b>}</p>

      <section aria-labelledby="draft-scout-season">
        <h3 id="draft-scout-season">선수 시즌 선호 · 최근 변화</h3>
        {target.import_coverage && <p>원본 파일 수입 범위 · {target.import_coverage.observed_games}경기 관측 / {target.import_coverage.accepted_games}경기 채택 / {target.import_coverage.excluded_games}경기 제외
          {target.import_coverage.excluded_games > 0 && ` · 제외율 ${formatRate(target.import_coverage.excluded_rate)}`}
          · 이 파일 밖의 누락 경기까지 보장하지 않습니다.</p>}
        <p>올해 전체 선수 기록(이적 전 포함)과 현재 팀 최근 경기 표본을 비교합니다. 변화는 선택률 차이이며 실력 변화나 선택 기회를 보정한 선호도가 아닙니다.</p>
        {brief.season.length === 0 && <p>이 자료에는 시즌 성향이 없습니다. 데이터 재생성이 필요합니다.</p>}
        {brief.season.map((player) => <details key={player.role}>
          <summary>{roleLabels[player.role] ?? player.role} · {player.player_name ?? "선수 미상"} · {player.year}년 {player.season_games}경기 / 최근 {player.recent_games}경기</summary>
          {player.status !== "OBSERVED" && <p>선수 ID 또는 시즌 기록이 부족합니다.</p>}
          <ul>{player.champions.map((champion) => <li key={champion.champion_id}>
            {nameOf(champion.champion_id)} · 시즌 {champion.season_games}회 · 최근 {champion.recent_games}회
            {champion.change !== null && ` · 선택률 차이 ${champion.change >= 0 ? "+" : ""}${(champion.change * 100).toFixed(1)}%p`}
            {lock(champion.locked)} · 근거 {champion.evidence_ids.length}건
          </li>)}</ul>
        </details>)}
      </section>
      <section aria-label="상대의 T1전 밴 기록">
        <h3>{code}의 T1전 1페이즈 밴 · 관측 기록</h3>
        <p>일반 메타와 구분한 실제 상대전 기록입니다. 특정 선수에 대한 밴 의도나 다음 경기의 확정 밴을 뜻하지 않습니다.</p>
        {pack.matchup_bans?.game_count ? <ul>{pack.matchup_bans.phase_one.map((ban) =>
          <li key={ban.champion_id}>{nameOf(ban.champion_id)} · {ban.game_count}/{pack.matchup_bans?.game_count}경기 · {formatRate(ban.rate)}</li>)}</ul> :
          <p>같은 팀을 상대로 한 밴 표본이 없습니다.</p>}
      </section>
      {connected ? <DraftExchangePanel key={pack.target.team_ids.join(":")} pack={pack} selections={selections} previousPicks={previousPicks}
        ownSide={pack.own.team_ids.includes(blueTeamId ?? "") ? "BLUE" : "RED"} firstPickSide={firstPickSide} nameOf={nameOf} /> :
        <p>밴픽 교환 시나리오는 현재 연습 대진과 스카우팅 상대가 일치할 때 표시합니다.</p>}
      <section aria-labelledby="draft-scout-h2h">
        <h3 id="draft-scout-h2h">상대전적과 서로 먼저 쓴 밴</h3>
        {pack.head_to_head.length === 0 && <p>시즌 공개 경기에서 맞대결 기록이 없습니다. 아래 시즌 성향으로 준비하세요.</p>}
        <ul className="draft-scout-series">{headToHeadSeries(pack).map((series) => <li key={series.games[0].match_id}>
          <b>{series.league} {series.date.slice(5).replace("-", ".")}</b>
          <span>T1 {series.own_wins} : {series.target_wins} {code}</span>
        </li>)}</ul>
        <p>{code}의 T1전 반복 밴: {headToHeadStaples(pack, "target").map((item) => `${nameOf(item.champion_id)} ${item.count}/${pack.head_to_head.length}`).join(" · ") || "반복 밴 없음"}</p>
        <p>T1의 {code}전 반복 밴: {headToHeadStaples(pack, "own").map((item) => `${nameOf(item.champion_id)} ${item.count}/${pack.head_to_head.length}`).join(" · ") || "반복 밴 없음"}</p>
      </section>

      <div className="draft-scout-levers">
        <section aria-labelledby="draft-scout-expected-bans">
          <h3 id="draft-scout-expected-bans">{code} 예상 1페이즈 밴 · 월즈 메타</h3>
          <ol>{brief.expected_bans.map((item) => <li key={item.champion_id}>
            <span>{nameOf(item.champion_id)}</span>
            <small>국제대회 밴픽 관여율 {formatRate(item.presence_rate)}</small>
          </li>)}</ol>
          <p>상대 팀의 시즌 밴 습관보다 지금 국제대회에서 많이 다뤄지는 챔피언이 실제 1페이즈 밴을 더 잘 맞혔습니다.</p>
        </section>
        <section className="draft-scout-wide" aria-labelledby="draft-scout-expected-picks">
          <h3 id="draft-scout-expected-picks">{code} 예상 픽 · 선수 성향 + 월즈 포지션 메타</h3>
          <ol>{brief.expected_picks.map((group) => <li key={group.role}>
            <span>{roleLabels[group.role] ?? group.role} · {group.player_name ?? "선수 미상"}</span>
            <small>{group.champions.map((item) => `${nameOf(item.champion_id)} ${item.player_game_count > 0 ? item.player_game_count : "메타"}`).join(" · ")}</small>
          </li>)}</ol>
          <p>숫자는 최근 경기에서 그 선수가 고른 횟수이고, 메타로 표시된 후보는 선수 기록 없이 국제대회 포지션 픽으로 올라온 후보입니다. 피어리스로 잠기면 다음 후보가 채워집니다.</p>
        </section>
        <section aria-labelledby="draft-scout-deny">
          <h3 id="draft-scout-deny">밴으로 지울 {code} 주력</h3>
          <ol>{brief.deny.map((item) => <li key={item.champion_id}>
            <span>{nameOf(item.champion_id)}{lock(item.locked)}</span>
            <small>{item.player_name} {roleLabels[item.role] ?? item.role} · {item.game_count}경기 {item.win_count}승 · 선수 픽의 {formatRate(item.share)}{item.also_own_priority ? " · T1도 우선 픽" : ""}</small>
          </li>)}</ol>
        </section>
        <section aria-labelledby="draft-scout-contested">
          <h3 id="draft-scout-contested">선픽으로 먼저 가져올 공통 우선순위</h3>
          <ol>{brief.contested.map((item) => <li key={item.champion_id}>
            <span>{nameOf(item.champion_id)}{lock(item.locked)}</span>
            <small>T1 {item.own_game_count}픽 · {code} {item.target_game_count}픽 · 양 팀 상위 픽 또는 1로테이션</small>
          </li>)}</ol>
        </section>
        <section aria-labelledby="draft-scout-protect">
          <h3 id="draft-scout-protect">T1이 먼저 밴당할 챔피언</h3>
          <ol>{brief.protect.map((item) => <li key={item.champion_id}>
            <span>{nameOf(item.champion_id)}{lock(item.locked)}</span>
            <small>상대전 밴 {item.banned_by_target_head_to_head}/{pack.head_to_head.length} · 시즌 1페이즈 피밴 {item.received_phase_one_ban_count} · T1 {item.own_game_count}픽</small>
          </li>)}</ol>
          <p>밴이 예상되는 챔피언은 대체 픽을 미리 준비하고, 풀리면 선픽 후보로 검토합니다.</p>
        </section>
        <section aria-labelledby="draft-scout-fearless">
          <h3 id="draft-scout-fearless">피어리스 5판 소진 압박</h3>
          <ol>{brief.pressure.map((pool) => <li key={pool.role}>
            <span>{roleLabels[pool.role] ?? pool.role} · {pool.player_name}</span>
            <small>{pool.unique_champions}개 사용 · {pack.config.minimum_comfort_games}경기 이상 {pool.comfort_champions}개 · 상위 3개 비중 {formatRate(pool.top_three_share)}{previousPicks.length > 0 ? ` · 상위 ${pool.top_total}개 중 남은 ${pool.top_remaining}개` : ""}</small>
          </li>)}</ol>
          <p>상위 3개 비중이 높은 포지션부터 주력이 잠길수록 선택지가 빠르게 줄어듭니다.</p>
        </section>
      </div>

      <div className="draft-scout-facts">
        <span><b>{code} 진영</b>블루 {target.side_record.BLUE.win_count}-{target.side_record.BLUE.game_count - target.side_record.BLUE.win_count} · 레드 {target.side_record.RED.win_count}-{target.side_record.RED.game_count - target.side_record.RED.win_count} · 선픽 {formatRate(target.first_selection.rate)}</span>
        <span><b>{code} 시즌 밴 습관 · 참고</b>{pack.levers.target_spends_phase_one_bans.map((item) => `${nameOf(item.champion_id)} ${formatRate(item.rate)}`).join(" · ")}</span>
        <span><b>{code} 마지막 픽 포지션</b>{brief.counterpick_role ? `${roleLabels[brief.counterpick_role.champion_id] ?? brief.counterpick_role.champion_id} ${brief.counterpick_role.game_count}/${brief.last_pick_games}` : "근거 없음"} · 해당 포지션 카운터를 늦게 받지 않도록 공개 순서 검토</span>
        <span><b>{code} 1로테이션 픽</b>{target.first_rotation_picks.slice(0, 4).map((item) => `${nameOf(item.champion_id)} ${item.game_count}`).join(" · ")}</span>
      </div>

      <section aria-labelledby="draft-scout-leagues">
        <h3 id="draft-scout-leagues">리그 메타 비교 · 밴픽 관여율</h3>
        <div className="draft-scout-leagues">{pack.league_meta.map((group) => <article key={group.group}>
          <header><strong>{leagueLabels[group.group] ?? group.group}</strong><span>{group.game_count}경기 · 패치 {group.patches.join("·")}</span></header>
          <ol>{group.presence.slice(0, 8).map((item) => <li key={item.champion_id}><span>{nameOf(item.champion_id)}</span><b>{formatRate(item.presence_rate)}</b></li>)}</ol>
        </article>)}</div>
        <p>{target.home_league}에서만 상위권: {brief.target_league_only.map((item) => nameOf(item.champion_id)).join(" · ") || "없음"} · {own.home_league}에서만 상위권: {brief.own_league_only.map((item) => nameOf(item.champion_id)).join(" · ") || "없음"}</p>
      </section>

      <p className="draft-scout-check">사전 검증 · {check.league} {check.game_count}경기를 시리즈 시작 전 공개 자료만으로 다시 채점 ·
        예상 밴 {formatRate(check.overall.expected_phase_one_bans.rate)} (시즌 습관 {formatRate(check.overall.season_ban_habit.rate)}) ·
        예상 픽 {formatRate(check.overall.expected_picks.rate)} (선수 기록만 {formatRate(check.overall.player_pool_picks.rate)} · 포지션 메타만 {formatRate(check.overall.role_meta_picks.rate)}) ·
        주력 밴 목록이 실제 픽을 짚은 경기 {formatRate(check.overall.deny_hits_real_pick.rate)}
        {teamCheck && <b> · {code} {teamCheck.deny_hits_real_pick.of}경기: 예상 밴 {formatRate(teamCheck.expected_phase_one_bans.rate)} · 예상 픽 {formatRate(teamCheck.expected_picks.rate)}</b>}</p>
      <p>위 검증 수치는 별도로 고정한 과거 스냅샷의 결과입니다. 새로 수집한 경기나 조합 표시 기능의 성능을 검증한 수치가 아닙니다.</p>
      <p className="draft-scout-boundary">공개 대회 기록의 횟수만 보여줍니다. 승률 예측이나 확정 밴픽이 아니며, 최종 판단과 인게임 실행은 코칭스태프와 선수의 몫입니다.</p>
    </div>
  </details>;
}
