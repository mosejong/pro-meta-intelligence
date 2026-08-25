import type { AIValidationStatus } from "./ai-validation";

const gateCopy = {
  accuracy: ["정확도", "주장·근거 F1 90% 이상", ["CLAIM_ACCURACY_NONINFERIOR", "EVIDENCE_ACCURACY_NONINFERIOR"]],
  safety: ["안전성", "치명적 오류 0 · 경계 100%", ["ZERO_CRITICAL_ERRORS", "BOUNDARY_RETENTION"]],
  speed: ["편의성", "사람 시간의 50% 이하", ["HUMAN_TIME_SAVED"]],
  sample: ["검증 표본", "동일 숨김 과제 30건", ["PAIRED_HOLDOUT_SAMPLE"]],
} as const;

function passes(status: AIValidationStatus, ids: readonly string[]) {
  return ids.every((id) => status.gates.find((gate) => gate.id === id)?.passed === true);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function AIValidationPanel({ status }: { status: AIValidationStatus | null }) {
  const measured = Boolean(status && status.paired_holdout_case_count > 0);
  const enabled = status?.status === "VALIDATED" && status.ai_features_enabled;
  const cards = status ? [
    {
      label: gateCopy.accuracy[0], requirement: gateCopy.accuracy[1], ids: gateCopy.accuracy[2],
      value: measured ? `${percent(status.metrics.ai.claim_f1)} / ${percent(status.metrics.ai.evidence_f1)}` : "측정 전",
    },
    {
      label: gateCopy.safety[0], requirement: gateCopy.safety[1], ids: gateCopy.safety[2],
      value: measured ? `${status.metrics.ai.critical_error_count}건 / ${percent(status.metrics.ai.boundary_recall)}` : "측정 전",
    },
    {
      label: gateCopy.speed[0], requirement: gateCopy.speed[1], ids: gateCopy.speed[2],
      value: status.metrics.paired_comparison.median_time_ratio === null ? "측정 전" : `${percent(1 - status.metrics.paired_comparison.median_time_ratio)} 절감`,
    },
    {
      label: gateCopy.sample[0], requirement: gateCopy.sample[1], ids: gateCopy.sample[2],
      value: `${status.paired_holdout_case_count} / ${status.policy.minimum_paired_holdout_cases}`,
    },
  ] : [];

  return <section className={`ai-validation ${enabled ? "validated" : "locked"}`} aria-labelledby="ai-validation-title">
    <header>
      <div><span>AI RELEASE GATE · HUMAN-PAIRED</span><h2 id="ai-validation-title">AI는 사람보다 정확하고 빨라야 열립니다.</h2><p>같은 숨김 과제에서 사람과 나란히 측정합니다. 한 조건이라도 실패하면 결정론적 분석만 유지하고 AI 초안은 사용자에게 보여주지 않습니다.</p></div>
      <b><i />{enabled ? "검증 통과 · AI 초안 사용 가능" : status?.status === "REJECTED" ? "검증 실패 · AI 잠금" : "검증 전 · AI 잠금"}</b>
    </header>
    {status ? <div className="ai-validation-grid">{cards.map(({ label, requirement, ids, value }) => <article className={passes(status, ids) ? "passed" : "pending"} key={label}>
      <span>{label}</span><strong>{value}</strong><small>{requirement}</small><em>{passes(status, ids) ? "통과" : measured ? "미통과" : "대기"}</em>
    </article>)}</div> : <div className="ai-validation-unavailable"><b>검증 상태를 불러오지 못했습니다.</b><p>상태를 확인할 수 없으므로 AI 기능은 자동으로 잠깁니다.</p></div>}
    <footer><b>현재 활성 경로</b><p>{enabled ? "검증된 AI 초안 + 사람 최종 승인" : "결정론적 데이터 분석 + 사람 최종 판단"}</p><span>자동 게시 없음 · 근거 ID 필수 · 비공개 팀 데이터 전송 없음</span></footer>
  </section>;
}
