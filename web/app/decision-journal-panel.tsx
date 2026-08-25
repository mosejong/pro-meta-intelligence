import type { DecisionJournalEntry, DecisionJournalState } from "./decision-journal";
import type { OpponentTeam } from "./radar-types";
import type { TeamDecisionCard } from "./team-brief";

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

export function DecisionJournalPanel({
  card,
  ownTeam,
  entry,
  entryCount,
  storageAvailable,
  onChange,
  onExport,
}: {
  card: TeamDecisionCard;
  ownTeam?: OpponentTeam;
  entry?: DecisionJournalEntry;
  entryCount: number;
  storageAvailable: boolean;
  onChange: (state: DecisionJournalState, note: string) => void;
  onExport: () => void;
}) {
  const selectedState = entry?.human_state ?? "INBOX";
  const note = entry?.analyst_note ?? "";
  return <section className="decision-journal" aria-label="팀 결정 기록">
    <header>
      <div><span>HUMAN DECISION · DEVICE LOCAL</span><h4>이 후보를 어떻게 처리할지 기록</h4><p>{ownTeam ? `${ownTeam.team_name} 관점` : "팀 미선택 · 공통 검토"} · {card.entry.champion_id} {card.entry.role}</p></div>
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
    <footer><div><b>{entry ? selectedState.replaceAll("_", " ") : "NOT RECORDED"}</b><span>마지막 변경 {updatedTime(entry?.updated_at)} KST</span></div><p>이 기록은 현재 브라우저에만 저장되며 서버·다른 기기·팀원과 자동 동기화되지 않습니다. JSON을 내려받아 공개 근거와 함께 보관할 수 있습니다.</p></footer>
  </section>;
}
