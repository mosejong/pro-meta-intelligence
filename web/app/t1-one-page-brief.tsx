/* eslint-disable @next/next/no-img-element -- champion assets use the pinned Riot Data Dragon version */

import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import type { TargetMatchDayBrief } from "./target-match-day";
import type { TargetProfile } from "./target-profile";

const readinessLabels: Record<TargetMatchDayBrief["readiness"]["status"], string> = {
  READY: "확정 대진 검토 가능",
  SCENARIO_ONLY: "공개 데이터 시나리오",
  WAITING_FOR_OPPONENT: "상대 확정 대기",
  WAITING_FOR_FIXTURE: "공식 일정 대기",
};

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

function fixtureTime(value: string | null) {
  if (!value) return "시간 미정";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function cutoffTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const kst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth() + 1)}.${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

export function T1OnePageBrief({
  brief,
  profile,
  onPrint,
  onDownload,
}: {
  brief: TargetMatchDayBrief;
  profile: TargetProfile;
  onPrint: () => void;
  onDownload: () => void;
}) {
  const { nameOf } = useChampionNames();
  const participants = brief.fixture.participants.length
    ? brief.fixture.participants.map((participant) => participant.code || participant.name).join(" vs ")
    : "T1 vs 미정";
  const currentPlayers = profile.players.filter((player) => player.roster_status === "CURRENT");
  const focus = [
    profile.focus.priority_pick && {
      label: "우선 픽 관측",
      championId: profile.focus.priority_pick.champion_id,
      detail: `${roleLabels[profile.focus.priority_pick.role ?? ""] ?? profile.focus.priority_pick.role ?? "역할 미상"} · ${percentage(profile.focus.priority_pick.game_rate)}`,
    },
    profile.focus.frequent_ban && {
      label: "T1이 자주 밴",
      championId: profile.focus.frequent_ban.champion_id,
      detail: `공개 경기 ${percentage(profile.focus.frequent_ban.game_rate)}`,
    },
    profile.focus.received_ban && {
      label: "T1이 자주 받은 밴",
      championId: profile.focus.received_ban.champion_id,
      detail: `공개 경기 ${percentage(profile.focus.received_ban.game_rate)}`,
    },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const title = brief.confirmed_matchup
    ? `${brief.confirmed_matchup.own_team.team_name} vs T1 회의용 브리프`
    : brief.perspective_team
      ? `${brief.perspective_team.team_name} 기준 T1 준비 브리프`
      : "T1 공개 데이터 원페이지 브리프";

  return <section className="t1-one-page" id="t1-brief" aria-labelledby="t1-one-page-title">
    <header className="t1-one-page-head">
      <div className="t1-one-page-mark" aria-hidden="true">T1</div>
      <div><span>ONE-PAGE · STAFF REVIEW · PATCH {brief.patch_id}</span><h2 id="t1-one-page-title">{title}</h2><p>확인된 공개 근거만 한 장에 압축합니다. 픽 의도·선수 컨디션·스크림 결과는 추정하지 않습니다.</p></div>
      <div className="t1-one-page-actions"><b className={`one-page-status ${brief.readiness.status.toLowerCase()}`}>{readinessLabels[brief.readiness.status]}</b><button type="button" onClick={onPrint}>인쇄 / PDF</button><button type="button" onClick={onDownload}>근거 JSON</button></div>
    </header>

    <div className="t1-one-page-overview">
      <article className="one-page-fixture">
        <span>NEXT VERIFIED FIXTURE</span>
        <strong>{participants}</strong>
        <p>{fixtureTime(brief.fixture.start_at)} KST · {brief.fixture.league ?? "리그 미정"} {brief.fixture.block ?? ""} · {brief.fixture.best_of ? `Bo${brief.fixture.best_of}` : "형식 미정"}</p>
        <small>{brief.fixture.days_until === null ? "D-DAY 미정" : `D-${brief.fixture.days_until}`} · {brief.fixture.event_id ?? "공식 이벤트 대기"}</small>
      </article>
      <div className="one-page-focus" aria-label="T1 공개 경기 핵심 관측">
        {focus.map((item) => <article key={item.label}>
          <img src={championImageUrl(item.championId)} alt="" loading="lazy" />
          <div><span>{item.label}</span><strong>{nameOf(item.championId)}</strong><small>{item.detail}</small></div>
        </article>)}
      </div>
      <article className="one-page-evidence">
        <span>EVIDENCE SNAPSHOT</span>
        <strong>{profile.evidence.match_ids.length}경기</strong>
        <p>{profile.evidence.draft_event_ids.length}개 드래프트 이벤트 · 최근 관측 선수 {currentPlayers.length}명</p>
        <small>컷오프 {cutoffTime(brief.cutoff)} KST</small>
      </article>
    </div>

    <div className="t1-one-page-body">
      <section className="one-page-prepare">
        <header><span>DECIDE IN MEETING</span><h3>지금 검토할 항목</h3></header>
        <ol>{brief.prepare_now.slice(0, 3).map((item, index) => <li key={`${item.type}:${item.title}`}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <div><span>{item.type}</span><strong>{item.title}</strong><p>{item.detail}</p></div>
          <small>{item.evidence_ids.length} 근거</small>
        </li>)}</ol>
      </section>
      <section className="one-page-gates">
        <header><span>READINESS GATES</span><h3>확정·대기 경계</h3></header>
        <div>{brief.readiness.checks.map((check) => <article className={check.status.toLowerCase()} key={check.id}>
          <b>{check.status === "PASS" ? "✓" : check.status === "WAIT" ? "…" : "!"}</b>
          <div><strong>{check.label}</strong><p>{check.detail}</p></div>
        </article>)}</div>
      </section>
    </div>

    {brief.confirmed_matchup ? <section className="one-page-lanes">
      <header><span>5-LANE REVIEW ORDER</span><h3>{brief.confirmed_matchup.own_team.team_name} vs {brief.confirmed_matchup.opponent.team_name}</h3><b>{brief.confirmed_matchup.quality.lanes_with_draft_signals}/5 신호 확인</b></header>
      <div>{brief.confirmed_matchup.lanes.map((lane) => {
        const champion = lane.contested[0]?.champion_id ?? lane.protect[0]?.champion_id ?? lane.opponent_priority[0]?.champion_id;
        return <article key={lane.role}>
          <span>0{lane.review_rank}</span>
          {champion ? <img src={championImageUrl(champion)} alt="" loading="lazy" /> : <i aria-hidden="true" />}
          <div><small>{lane.review_tier} · {roleLabels[lane.role]}</small><strong>{lane.own_players.map((player) => player.player_name).join(" · ") || "우리 선수 제한"} vs {lane.opponent_players.map((player) => player.player_name).join(" · ") || "상대 선수 제한"}</strong><p>{lane.staff_questions[0]}</p></div>
          <b>{lane.review_score}</b>
        </article>;
      })}</div>
    </section> : <section className="one-page-wait">
      <div><span>NO VERIFIED HEAD-TO-HEAD YET</span><h3>상대 확정 전에는 라인 저격 자료를 만들지 않습니다.</h3><p>현재는 T1 공통 관측과 준비 항목만 사용합니다. 공식 팀 ID가 확정되면 5개 라인의 선수·챔피언 충돌 순서가 자동으로 열립니다.</p></div>
      <div className="one-page-roster"><span>최근 관측 T1 CURRENT</span>{currentPlayers.map((player) => <p key={`${player.role}:${player.player_id}`}><b>{roleLabels[player.role] ?? player.role}</b><strong>{player.player_name}</strong></p>)}</div>
    </section>}

    <footer className="t1-one-page-boundary"><div><b>판단 경계</b><p>{brief.unknowns.slice(0, 2).join(" · ")}</p></div><a href="#target-match-day">전체 일정·라인 근거 보기 →</a></footer>
  </section>;
}
