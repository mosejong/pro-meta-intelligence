import type { DecisionJournalEntry, DecisionJournalState } from "./decision-journal";
import type { DecisionOutcomeResolution, DecisionOutcomesFeed } from "./decision-outcomes";
import type { OpponentTeam } from "./radar-types";
import type { TeamDecisionCard } from "./team-brief";
import { useChampionNames } from "./champion-names";

const stateOptions: Array<{ value: DecisionJournalState; label: string; detail: string }> = [
  { value: "INBOX", label: "검토 대기", detail: "회의 큐에 유지" },
  { value: "REVIEWED", label: "검토 완료", detail: "공개 근거 확인" },
  { value: "SCRIM_REQUESTED", label: "테스트 요청", detail: "구조화 테스트 필요" },
  { value: "ADOPTED", label: "채택", detail: "팀 결정 기록" },
  { value: "REJECTED", label: "기각", detail: "중단 조건 충족" },
  { value: "WATCH", label: "계속 추적", detail: "다음 변화 대기" },
];

function updatedTime(value: string | undefined) {
  if (!value) return "아직 기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function outcomeReview(
  outcome: DecisionOutcomeResolution,
  feed: DecisionOutcomesFeed | null,
) {
  const shared = outcome.match === "SOURCE_STATE"
    ? "같은 원천 상태로 연결 · 판단 시점과 벤치마크 cutoff는 다름"
    : outcome.match === "EXACT_CUTOFF"
      ? "동일 cutoff로 연결"
      : null;
  if (outcome.status === "HIT") return {
    tone: "hit",
    label: "HIT",
    title: "이후 의미 있는 프로 채택 확인",
    detail: `${outcome.candidate.future_pick_count ?? 0}픽 · ${outcome.candidate.future_distinct_team_count ?? 0}팀 · ${shared}`,
  };
  if (outcome.status === "FALSE_ALERT") return {
    tone: "false-alert",
    label: "FALSE ALERT",
    title: "미래 채택 기준을 충족하지 못함",
    detail: `결과 구간 종료 ${updatedTime(outcome.evaluation.outcome_end)} KST · ${shared}`,
  };
  if (outcome.status === "MISSED_ADOPTION") return {
    tone: "missed",
    label: "MISSED ADOPTION",
    title: "실제 채택됐지만 당시 후보에는 없었음",
    detail: `${outcome.adoption.future_pick_count ?? 0}픽 · ${outcome.adoption.future_distinct_team_count ?? 0}팀 · ${shared}`,
  };
  if (outcome.status === "WAITING_FOR_HISTORY") return {
    tone: "waiting",
    label: "HISTORY NOT READY",
    title: "실데이터 결과 검증 대기",
    detail: "미래 데이터와 분리된 일일 스냅샷이 충분히 쌓인 뒤에만 판정합니다.",
  };
  if (outcome.status === "WAITING_FOR_CUTOFF") return {
    tone: "waiting",
    label: "OUTCOME PENDING",
    title: "이 판단 시점의 미래 결과 대기",
    detail: "챔피언 이름만으로 다른 시점의 결과를 섞지 않습니다.",
  };
  if (outcome.status === "NOT_EVALUATED") return {
    tone: "neutral",
    label: "NOT EVALUATED",
    title: "해당 후보는 벤치마크 평가 대상 밖",
    detail: `${shared} · 당시 공개 후보 정책과 결과 정책을 그대로 유지합니다.`,
  };
  if (outcome.status === "UNAVAILABLE") return {
    tone: "unavailable",
    label: "OUTCOME FEED OFFLINE",
    title: "결과 피드를 확인할 수 없음",
    detail: "결정 기록은 유지되며 결과 상태를 임의로 추정하지 않습니다.",
  };
  return {
    tone: "neutral",
    label: "NOT RECORDED",
    title: "먼저 사람의 판단을 기록하세요",
    detail: feed?.benchmark_ready
      ? "기록한 공개 근거 시점만 이후 결과와 연결합니다."
      : "기록 뒤 실제 이력이 성숙하면 결과 검토가 자동으로 열립니다.",
  };
}

export function DecisionJournalPanel({
  card,
  ownTeam,
  entry,
  entryCount,
  storageAvailable,
  outcome,
  outcomeFeed,
  onChange,
  onExport,
}: {
  card: TeamDecisionCard;
  ownTeam?: OpponentTeam;
  entry?: DecisionJournalEntry;
  entryCount: number;
  storageAvailable: boolean;
  outcome: DecisionOutcomeResolution;
  outcomeFeed: DecisionOutcomesFeed | null;
  onChange: (state: DecisionJournalState, note: string) => void;
  onExport: () => void;
}) {
  const { nameOf } = useChampionNames();
  const selectedState = entry?.human_state ?? "INBOX";
  const note = entry?.analyst_note ?? "";
  const review = outcomeReview(outcome, outcomeFeed);
  return <section className="decision-journal" aria-label="팀 결정 기록">
    <header>
      <div><span>HUMAN DECISION · DEVICE LOCAL</span><h4>이 후보를 어떻게 처리할지 기록</h4><p>{ownTeam ? `${ownTeam.team_name} 관점` : "팀 미선택 · 공통 검토"} · {nameOf(card.entry.champion_id)} {card.entry.role}</p></div>
      <div><b className={storageAvailable ? "available" : "unavailable"}>{storageAvailable ? `${entryCount}개 로컬 기록` : "저장소 사용 불가"}</b><button type="button" onClick={onExport} disabled={!entryCount}>JOURNAL JSON</button></div>
    </header>
    <div className="decision-journal-states" role="group" aria-label="사람의 검토 상태">
      {stateOptions.map((option) => <button
        type="button"
        className={`${option.value.toLowerCase()} ${selectedState === option.value ? "active" : ""}`}
        key={option.value}
        onClick={() => onChange(option.value, note)}
        aria-pressed={selectedState === option.value}
        disabled={!storageAvailable}
      ><strong>{option.label}</strong><small>{option.detail}</small></button>)}
    </div>
    <label className="decision-journal-note">
      <span>비민감 회의 메모 <b>{note.length}/280</b></span>
      <textarea
        value={note}
        maxLength={280}
        rows={3}
        placeholder="예: 공개 경기 VOD에서 조합 진입 조건을 먼저 확인. 스크림 결과·선수 평가 같은 민감 정보는 입력하지 마세요."
        onChange={(event) => onChange(selectedState, event.target.value)}
        disabled={!storageAvailable}
      />
    </label>
    <section className={`decision-outcome-review ${review.tone}`} aria-label="결정 사후 검토">
      <div><span>WALK-FORWARD OUTCOME</span><b>{review.label}</b></div>
      <article><h5>{review.title}</h5><p>{review.detail}</p></article>
      {outcomeFeed?.benchmark_ready && <dl>
        <div><dt>HIT</dt><dd>{outcomeFeed.summary.hit_count}</dd></div>
        <div><dt>FALSE ALERT</dt><dd>{outcomeFeed.summary.false_alert_count}</dd></div>
        <div><dt>MISSED</dt><dd>{outcomeFeed.summary.missed_adoption_count}</dd></div>
      </dl>}
      <small>사후 결과는 사람의 상태를 자동 변경하지 않습니다.</small>
    </section>
    <footer><div><b>{entry ? selectedState.replaceAll("_", " ") : "NOT RECORDED"}</b><span>마지막 변경 {updatedTime(entry?.updated_at)} KST</span></div><p>이 기록은 현재 브라우저에만 저장되며 서버·다른 기기·팀원과 자동 동기화되지 않습니다. JSON을 내려받아 공개 근거와 함께 보관할 수 있습니다.</p></footer>
  </section>;
}
