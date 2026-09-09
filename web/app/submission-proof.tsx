"use client";

/* eslint-disable @next/next/no-img-element -- submission visuals reuse checked-in and pinned public assets */

import { validationForTask, type AIValidationStatus } from "./ai-validation";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import type { CollectionStatus } from "./collection-status";
import { productSpaceHref, type ProductSpace } from "./product-space";
import type { RadarReport } from "./radar-types";

type SubmissionProofProps = {
  currentSpace: ProductSpace;
  report: RadarReport;
  collectionStatus: CollectionStatus | null;
  aiValidation: AIValidationStatus | null;
  feedLabel: string;
};

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "확인 대기";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 대기";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function SubmissionProof({
  currentSpace,
  report,
  collectionStatus,
  aiValidation,
  feedLabel,
}: SubmissionProofProps) {
  const { nameOf } = useChampionNames();
  const history = report.history_status;
  const ai = validationForTask(aiValidation, "EVIDENCE_LOCKED_BRIEF");
  const topCandidate = report.entries.find((entry) => entry.eligible_for_review) ?? report.entries[0];
  const historyProgress = history?.gate_progress_percent ?? 0;
  const sourceCurrent = collectionStatus?.state === "CURRENT";
  const publicReady = report.fixture_only === false && report.publication_readiness?.ready_for_radar === true;
  const demoReady = publicReady && report.entries.length > 0;
  const evidenceReady = history?.benchmark_ready === true;
  const aiReady = ai?.status === "VALIDATED" && ai.ai_features_enabled;
  const proofGates = [
    { label: "공개 프로덕션 데이터", passed: publicReady, value: publicReady ? "실데이터·발행 게이트 통과" : "데모 또는 발행 차단" },
    { label: "T1 제출 데모", passed: demoReady, value: demoReady ? "바로 시연 가능" : "공개 피드 필요" },
    { label: "수집 최신성", passed: sourceCurrent, value: collectionStatus?.state ?? "상태 확인 대기" },
    { label: "예측 효용 백테스트", passed: evidenceReady, value: evidenceReady ? "실데이터 검증 완료" : `${historyProgress}% 축적` },
    { label: "사람 대비 AI 검증", passed: aiReady, value: aiReady ? "검증 통과" : `${ai?.paired_holdout_case_count ?? 0}/30` },
  ];
  const passedCount = proofGates.filter((gate) => gate.passed).length;

  function printProof() {
    document.body.classList.add("print-submission-proof");
    window.print();
    window.setTimeout(() => document.body.classList.remove("print-submission-proof"), 0);
  }

  return <main className="submission-proof">
    <header className="submission-topbar">
      <a className="brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label="Pro Meta Intelligence 홈"><span className="brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span></a>
      <nav aria-label="제출 자료 이동"><a href={productSpaceHref(currentSpace, "T1")}>T1 라이브 데모</a><a href={productSpaceHref(currentSpace, "RADAR")}>근거 레이더</a><a href="https://github.com/mosejong/pro-meta-intelligence">코드 저장소</a></nav>
      <button type="button" onClick={printProof}>인쇄 / PDF</button>
    </header>

    <section className="submission-hero">
      <div><span>TEAM SUBMISSION · EVIDENCE BEFORE CLAIMS</span><h1>연습할 후보를<br /><em>더 빨리, 근거와 함께.</em></h1><p>Pro Meta Intelligence는 공개 경기 데이터를 T1 중심의 검토 후보, 상대 준비 순서, 반대 근거와 중단 조건으로 압축합니다. 자동 픽 추천기가 아니라 코칭스태프가 놓칠 질문을 줄이는 분석 보조 도구입니다.</p><div><b>{demoReady ? "제출 데모 가능" : "제출 데모 준비 중"}</b><small>{feedLabel} · 패치 {report.patch_id} · {formatDate(report.cutoff)} KST</small></div></div>
      <figure><img src={productSpaceHref(currentSpace, "ONBOARDING") + "meta-radar-hero-v2.png"} alt="지역별 메타 신호가 분석 후보로 모이는 제품 일러스트" /><figcaption><b>{passedCount}/5</b><span>제출 증거 게이트</span></figcaption></figure>
    </section>

    <section className="submission-problem" aria-labelledby="submission-problem-title">
      <header><span>01 · PROBLEM</span><h2 id="submission-problem-title">좋은 픽을 맞히는 것보다, 검토 목록에서 빠뜨리지 않는 것</h2></header>
      <div><article><b>INPUT</b><h3>흩어진 공개 신호</h3><p>패치 변화, 지역 차이, 팀 집중도, 선수 공개 픽과 다음 공식 일정을 동일 시점으로 고정합니다.</p></article><article><b>DECISION</b><h3>연습 우선순위</h3><p>찬성 근거만 보여주지 않고 반론, 확인 질문, 중단 조건을 함께 만들어 검토 비용을 줄입니다.</p></article><article><b>BOUNDARY</b><h3>모르는 것은 모른다고</h3><p>스크림 결과, 선수 컨디션, 상대의 비공개 계획과 픽 의도는 공개 데이터로 추정하지 않습니다.</p></article></div>
    </section>

    <section className="submission-case" aria-labelledby="submission-case-title">
      <header><span>02 · LIVE T1 CASE</span><h2 id="submission-case-title">현재 공개 스냅샷으로 재현되는 분석 흐름</h2><p>아래 수치는 고정 문구가 아니라 배포된 피드에서 읽습니다.</p></header>
      <div className="submission-case-grid">
        <article className="submission-candidate">{topCandidate && <img src={championImageUrl(topCandidate.champion_id)} alt="" />}<div><span>검토 후보 #{topCandidate?.rank ?? "-"}</span><h3>{topCandidate ? `${nameOf(topCandidate.champion_id)} · ${roleLabels[topCandidate.role] ?? topCandidate.role}` : "후보 확인 대기"}</h3><p>{topCandidate ? `${topCandidate.metrics.current_distinct_team_count}개 팀 관측 · 근거 이벤트 ${topCandidate.evidence_event_ids.length}건` : "공개 피드를 확인하고 있습니다."}</p></div></article>
        <ol><li><b>1</b><div><strong>T1 공개 프로필 확인</strong><span>최신 관측 5인과 과거 관측을 분리</span></div></li><li><b>2</b><div><strong>공식 일정과 상대 연결</strong><span>TBD 상대는 확정된 것처럼 연결하지 않음</span></div></li><li><b>3</b><div><strong>픽·밴 충돌을 5개 라인으로 압축</strong><span>보호·경합·견제 검토·교환 시나리오</span></div></li><li><b>4</b><div><strong>근거 JSON과 한 장 브리프 전달</strong><span>분석가가 원문 이벤트까지 역추적 가능</span></div></li></ol>
      </div>
      <footer><a href={productSpaceHref(currentSpace, "T1")}>T1 실제 화면 열기 →</a><a href={productSpaceHref(currentSpace, "TEAM")}>내 팀 기준으로 바꾸기 →</a></footer>
    </section>

    <section className="submission-evidence" aria-labelledby="submission-evidence-title">
      <header><span>03 · PROOF STATUS</span><h2 id="submission-evidence-title">완성된 것과 아직 증명되지 않은 것을 분리</h2></header>
      <div>{proofGates.map((gate, index) => <article className={gate.passed ? "passed" : "pending"} key={gate.label}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{gate.label}</strong><span>{gate.value}</span></div><em>{gate.passed ? "PASS" : "OPEN"}</em></article>)}</div>
      <aside><b>현재 제출 문구</b><p>{evidenceReady ? "실데이터 백테스트까지 확인 가능한 분석 제품입니다." : "작동하는 실데이터 분석 프로토타입입니다. 예측 효용은 아직 주장하지 않으며, 연속 스냅샷이 성숙한 뒤 Recall@K와 오탐률을 공개합니다."}</p><small>마지막 검증 소스 · {formatDate(collectionStatus?.source.last_verified_at)} KST</small></aside>
    </section>

    <section className="submission-demo" aria-labelledby="submission-demo-title">
      <header><span>04 · 3 MINUTE DEMO</span><h2 id="submission-demo-title">설명 순서까지 준비된 제출 시나리오</h2></header>
      <ol><li><time>00:00</time><div><b>문제</b><p>“팀이 검토할 후보를 놓치지 않으면서 연습 시간을 어떻게 아낄까?”</p></div></li><li><time>00:25</time><div><b>T1 오늘 준비</b><p>공식 일정, 공개 선수 선택, 상대 우선순위를 한 화면에서 확인합니다.</p></div></li><li><time>01:05</time><div><b>근거 추적</b><p>후보 카드에서 지역·팀·경기 이벤트로 내려가 산식과 원자료 연결을 보여줍니다.</p></div></li><li><time>01:50</time><div><b>의사결정 출력</b><p>반대 근거, 연습 질문, 중단 조건과 한 장 PDF를 확인합니다.</p></div></li><li><time>02:30</time><div><b>신뢰 경계</b><p>백테스트와 AI가 준비되지 않았을 때 자동으로 잠기는 이유를 설명합니다.</p></div></li></ol>
    </section>

    <footer className="submission-footer"><div><b>지금 제출할 수 있는 것</b><p>배포 서비스 · 재현 가능한 T1 시연 · 공개 근거 계약 · 테스트된 코드</p></div><div><b>제출 전 계속 채울 것</b><p>14일 연속 관측 · 실제 백테스트 · 사례 연구 결과 · 사람 대비 AI 30건</p></div><a href={productSpaceHref(currentSpace, "ONBOARDING")}>제품 홈으로 돌아가기 →</a></footer>
  </main>;
}
