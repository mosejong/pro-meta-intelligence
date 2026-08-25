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

    <footer className="target-match-day-boundary">
      <div><b>현재 미확정</b><p>{brief.unknowns.join(" · ")}</p></div>
      <span>{brief.evidence.schedule_event_id ? "SCHEDULE VERIFIED" : "SCHEDULE WAIT"} · {brief.evidence.opponent_match_ids.length} MATCHES</span>
    </footer>
  </section>;
}
