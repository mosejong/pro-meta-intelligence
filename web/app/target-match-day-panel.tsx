/* eslint-disable @next/next/no-img-element -- champion assets are served from Riot Data Dragon in both builds */

import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import type { ConfirmedLaneSignal, LaneRole } from "./confirmed-opponent-lane-report";
import type { TargetMatchDayBrief } from "./target-match-day";

const statusLabels: Record<TargetMatchDayBrief["readiness"]["status"], string> = {
  READY: "대진 브리프 준비됨",
  SCENARIO_ONLY: "시나리오 검토",
  WAITING_FOR_OPPONENT: "상대 확정 대기",
  WAITING_FOR_FIXTURE: "공식 일정 대기",
};

const relationshipLabels: Record<TargetMatchDayBrief["fixture"]["relationship"], string> = {
  CONFIRMED_HEAD_TO_HEAD: "내 팀과 T1 직접 대진 확인",
  TARGET_AS_OWN_TEAM: "T1 관점 다음 상대 확인",
  TARGET_FIXTURE_OTHER_OPPONENT: "T1 일정 · 내 팀 직접 대진 아님",
  PARTICIPANT_TBD: "T1 상대 TBD",
  PERSPECTIVE_UNSET: "내 팀 선택 전",
  NO_UPCOMING_FIXTURE: "예정 경기 없음",
  SCHEDULE_UNAVAILABLE: "일정 미연결",
};

const roleLabels: Record<LaneRole, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percentage(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function LaneSignalGroup({
  label,
  items,
  mode,
}: {
  label: string;
  items: ConfirmedLaneSignal[];
  mode: "CONTESTED" | "PROTECT" | "OPPONENT";
}) {
  const { nameOf } = useChampionNames();
  return <div className="lane-signal-group">
    <span>{label}</span>
    {items.length ? <div>{items.slice(0, 3).map((item) => <article key={`${mode}:${item.champion_id}`}>
      <img src={championImageUrl(item.champion_id)} alt="" loading="lazy" />
      <p><strong>{nameOf(item.champion_id)}</strong><small>{mode === "CONTESTED"
        ? `우리 ${percentage(item.own_game_rate)} · 상대 ${percentage(item.opponent_game_rate)}`
        : mode === "PROTECT"
          ? `우리 ${percentage(item.own_game_rate)} · 상대 밴 ${percentage(item.opponent_ban_rate)}`
          : `상대 ${percentage(item.opponent_game_rate)}`}</small></p>
    </article>)}</div> : <em>직접 신호 없음</em>}
  </div>;
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

function checkedTime(value: string | null) {
  if (!value) return "감시 로그 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

export function TargetMatchDayPanel({
  brief,
  onDownload,
}: {
  brief: TargetMatchDayBrief;
  onDownload: () => void;
}) {
  const participants = brief.fixture.participants.length
    ? brief.fixture.participants.map((participant) => participant.code || participant.name).join(" vs ")
    : "T1 vs 미정";
  return <section className="target-match-day" id="target-match-day" aria-label="T1 경기 당일 준비 브리프">
    <header className="target-match-day-head">
      <div><span>T1 MATCH-DAY CONTROL · OFFICIAL SCHEDULE</span><h3>다음 T1 일정과 준비 상태</h3><p>상대가 미정이면 추정하지 않고, 확정되는 순간 같은 브리프가 자동으로 내 팀 대진 여부를 다시 판정합니다.</p></div>
      <div><b className={`match-day-status ${brief.readiness.status.toLowerCase()}`}>{statusLabels[brief.readiness.status]}</b><button type="button" onClick={onDownload}>MATCH-DAY JSON</button></div>
    </header>

    <div className={`target-change-strip ${brief.monitoring.status.toLowerCase()}`}>
      <b>{brief.monitoring.status === "CHANGE_DETECTED" ? "CHANGE DETECTED" : brief.monitoring.status === "WATCHING" ? "SCHEDULE WATCH ACTIVE" : "CHANGE LOG UNAVAILABLE"}</b>
      <p>{brief.monitoring.latest_change ? `${brief.monitoring.latest_change.type} · ${brief.monitoring.latest_change.summary}` : "기준 스냅샷이 등록됐습니다. T1 상대·시간·Bo 형식 변경을 감시합니다."}</p>
      <span>{checkedTime(brief.monitoring.checked_at)} KST · 최근 실행 {brief.monitoring.latest_run_change_count}건 · 보관 {brief.monitoring.retained_change_count}건</span>
    </div>

    <div className="target-match-day-grid">
      <article className="target-fixture-card">
        <span>NEXT VERIFIED FIXTURE</span>
        <div className="fixture-countdown"><strong>{brief.fixture.days_until === null ? "—" : `D-${brief.fixture.days_until}`}</strong><small>{relationshipLabels[brief.fixture.relationship]}</small></div>
        <h4>{participants}</h4>
        <p>{fixtureTime(brief.fixture.start_at)} KST</p>
        <div><b>{brief.fixture.league ?? "리그 미정"}</b><b>{brief.fixture.block ?? "스테이지 미정"}</b><b>{brief.fixture.best_of ? `Bo${brief.fixture.best_of}` : "형식 미정"}</b></div>
        <footer><span>{brief.fixture.event_id ?? "공식 이벤트 ID 없음"}</span><small>일정 ID를 과거 게임 시리즈 ID로 간주하지 않음</small></footer>
      </article>

      <article className="target-readiness-card">
        <header><span>READINESS GATES</span><h4>자동 브리프 준비도</h4></header>
        <div>{brief.readiness.checks.map((check) => <div key={check.id} className={check.status.toLowerCase()}>
          <b>{check.status === "PASS" ? "✓" : check.status === "WAIT" ? "…" : "!"}</b>
          <p><strong>{check.label}</strong><small>{check.detail}</small></p>
        </div>)}</div>
      </article>

      <article className="target-actions-card">
        <header><span>PREPARE NOW</span><h4>상대 확정 전에도 할 일</h4></header>
        <ol>{brief.prepare_now.map((item) => <li key={`${item.type}:${item.title}`}>
          <b>{item.type}</b><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.evidence_ids.length}개 공개 근거</small></div>
        </li>)}</ol>
      </article>
    </div>

    {brief.confirmed_matchup ? <section className="confirmed-matchup" aria-label="확정 상대 라인별 충돌 보고서">
      <header className="confirmed-matchup-head">
        <div><span>CONFIRMED OPPONENT COLLISION</span><h4>{brief.confirmed_matchup.own_team.team_name} vs {brief.confirmed_matchup.opponent.team_name} · 라인 검토 순서</h4><p>공통 챔피언 풀, 상대 밴 압력, 역할 우선 픽과 1페이즈 빈도를 합쳐 먼저 볼 라인을 정렬합니다.</p></div>
        <div><b className={brief.confirmed_matchup.status.toLowerCase()}>{brief.confirmed_matchup.status === "READY" ? "PLAYER + DRAFT READY" : "TEAM-LEVEL LIMITED"}</b><span>{brief.confirmed_matchup.quality.lanes_with_draft_signals}/5 LANES WITH SIGNALS</span></div>
      </header>
      <div className="confirmed-matchup-summary">
        <article><span>P1 검토 라인</span><strong>{brief.confirmed_matchup.lanes.filter((lane) => lane.review_tier === "P1").length}</strong><small>60점 이상 · 승률 예측 아님</small></article>
        <article><span>양쪽 선수 확인 라인</span><strong>{brief.confirmed_matchup.quality.lanes_with_player_names}</strong><small>최근 공개 경기의 CURRENT 표기</small></article>
        <article><span>공개 근거 경기</span><strong>{brief.confirmed_matchup.evidence.match_ids.length}</strong><small>{brief.confirmed_matchup.evidence.draft_event_ids.length}개 드래프트 이벤트</small></article>
      </div>
      <div className="lane-collision-list">{brief.confirmed_matchup.lanes.map((lane) => <article className={`lane-collision ${lane.review_tier.toLowerCase()}`} key={lane.role}>
        <header>
          <span className="lane-review-rank">0{lane.review_rank}</span>
          <div><small>{lane.review_tier} REVIEW</small><h5>{roleLabels[lane.role]}</h5></div>
          <strong>{lane.review_score}<small>/100</small></strong>
        </header>
        <div className="lane-player-pair">
          <p><span>{brief.confirmed_matchup.own_team.team_name}</span><strong>{lane.own_players.map((player) => player.player_name).join(" · ") || "선수 프로필 제한"}</strong></p>
          <b>VS</b>
          <p><span>{brief.confirmed_matchup.opponent.team_name}</span><strong>{lane.opponent_players.map((player) => player.player_name).join(" · ") || "선수 프로필 제한"}</strong></p>
        </div>
        <div className="lane-signal-groups">
          <LaneSignalGroup label="공통 풀" items={lane.contested} mode="CONTESTED" />
          <LaneSignalGroup label="보호 자원" items={lane.protect} mode="PROTECT" />
          <LaneSignalGroup label="상대 우선" items={lane.opponent_priority} mode="OPPONENT" />
        </div>
        <div className="lane-review-question"><span>STAFF CHECK</span><p>{lane.staff_questions[0]}</p><small>{lane.evidence_ids.length}개 공개 근거 · {lane.reasons[0] ?? "직접 충돌 표본 제한"}</small></div>
      </article>)}</div>
      <footer><b>해석 경계</b><p>{brief.confirmed_matchup.quality.limitations.join(" · ")}</p><span>{brief.confirmed_matchup.priority_lane_order.map((role) => roleLabels[role]).join(" → ")}</span></footer>
    </section> : <section className="confirmed-matchup-wait" aria-label="확정 상대 보고서 대기 상태">
      <div><span>5-LANE REPORT ARMED</span><h4>상대 확정 시 라인별 충돌 보고서 자동 생성</h4></div>
      <p>현재는 공식 상대가 확정되지 않았거나 선택한 내 팀의 직접 대진이 아닙니다. 브래킷을 추정하지 않고, 확정된 팀 ID만 공개 경기 데이터와 연결합니다.</p>
      <b>WAITING FOR VERIFIED OPPONENT</b>
    </section>}

    <footer className="target-match-day-boundary">
      <div><b>{brief.confirmed_matchup ? "공개 데이터 경계" : "현재 미확정"}</b><p>{brief.unknowns.join(" · ")}</p></div>
      <span>{brief.evidence.schedule_event_id ? "SCHEDULE VERIFIED" : "SCHEDULE WAIT"} · {brief.evidence.opponent_match_ids.length} MATCHES</span>
    </footer>
  </section>;
}
