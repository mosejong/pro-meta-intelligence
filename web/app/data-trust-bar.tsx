import { snapshotFreshness, type FreshnessLevel } from "./freshness";

export type FeedTrustKind = "connecting" | "published" | "demo" | "uploaded";
export type ScheduleTrustState = "connecting" | "connected" | "stale" | "unavailable";

type DataTrustBarProps = {
  dataCutoff: string;
  checkedAt: string | null;
  feedKind: FeedTrustKind;
  scheduleRetrievedAt: string | null;
  scheduleState: ScheduleTrustState;
  scheduleSourceUrl: string | null;
};

function formatTimestamp(value: string | null) {
  if (!value) return "확인 중";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dataLabel(feedKind: FeedTrustKind, level: FreshnessLevel) {
  if (feedKind === "connecting") return "데이터 확인 중";
  if (feedKind === "demo") return "예시 데이터";
  if (feedKind === "uploaded") return "불러온 파일";
  if (level === "FRESH") return "최신 데이터";
  if (level === "AGING") return "갱신 대기";
  if (level === "STALE") return "오래된 데이터";
  return "시각 확인 필요";
}

function scheduleLabel(state: ScheduleTrustState) {
  if (state === "connected") return "공식 일정 확인됨";
  if (state === "stale") return "일정 갱신 필요";
  if (state === "unavailable") return "공식 일정 미연결";
  return "공식 일정 확인 중";
}

export function DataTrustBar({
  dataCutoff,
  checkedAt,
  feedKind,
  scheduleRetrievedAt,
  scheduleState,
  scheduleSourceUrl,
}: DataTrustBarProps) {
  const data = snapshotFreshness(dataCutoff, checkedAt, { freshHours: 12, staleHours: 24 });
  const schedule = snapshotFreshness(scheduleRetrievedAt, checkedAt, { freshHours: 12, staleHours: 36 });
  const dataLevel = feedKind === "demo" ? "STALE" : feedKind === "connecting" ? "UNKNOWN" : data.level;
  const scheduleLevel = scheduleState === "stale"
    ? "STALE"
    : scheduleState === "connected"
      ? schedule.level
      : "UNKNOWN";
  const protectionActive = scheduleState === "stale" || scheduleState === "unavailable";
  const reviewOnly = dataLevel === "STALE" || feedKind === "demo";
  const checking = dataLevel === "UNKNOWN" || scheduleLevel === "UNKNOWN";
  const guardClass = protectionActive || reviewOnly ? "guarded" : checking ? "checking" : "ready";
  const guardLabel = protectionActive ? "오래된 일정 제외" : reviewOnly ? "검토 전용" : checking ? "확인 중" : "사용 가능";

  return <section className="data-trust-bar" aria-label="데이터 최신성과 일정 신뢰 상태">
    <div className={`trust-signal ${dataLevel.toLowerCase()}`}>
      <span><i />분석 데이터</span>
      <strong>{dataLabel(feedKind, dataLevel)}</strong>
      <small>{feedKind === "connecting" ? "발행본을 확인하고 있습니다." : `${data.ageLabel} · ${formatTimestamp(dataCutoff)} KST`}</small>
    </div>
    <div className={`trust-signal ${scheduleLevel.toLowerCase()}`}>
      <span><i />공식 일정</span>
      <strong>{scheduleLabel(scheduleState)}</strong>
      <small>{scheduleState === "connecting" ? "일정 원본을 확인하고 있습니다." : scheduleRetrievedAt ? `${schedule.ageLabel} · ${formatTimestamp(scheduleRetrievedAt)} KST` : "분석 점수와 분리해 표시합니다."}</small>
    </div>
    <div className={`trust-guard ${guardClass}`}>
      <span>자동 보호</span>
      <strong>{guardLabel}</strong>
      <small>미확정 상대·오래된 일정은 우선순위에서 자동 제외합니다.</small>
    </div>
    <details>
      <summary>어떻게 판단했나요? <span>＋</span></summary>
      <div>
        <p><b>경기 데이터</b> 12시간 이내 최신, 24시간 초과 시 오래됨으로 표시합니다. 기준 시각은 분석 컷오프입니다.</p>
        <p><b>공식 일정</b> 36시간을 넘으면 상대 우선순위 계산에서 제외합니다. 일정 변경과 TBD는 다음 수집 때 다시 확인합니다.</p>
        <p><b>출처</b> 경기 기록은 발행 스냅샷의 원본 해시를 유지합니다. {scheduleSourceUrl ? <a href={scheduleSourceUrl}>공식 일정 원본 보기 →</a> : "일정 원본 연결을 확인 중입니다."}</p>
      </div>
    </details>
  </section>;
}
