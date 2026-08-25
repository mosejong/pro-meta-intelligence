/* eslint-disable @next/next/no-img-element -- the product illustration is a checked-in static asset */

import type { ProductSpace } from "./product-space";
import { productRootHref, productSpaceHref } from "./product-space";
import type { AIValidationStatus } from "./ai-validation";

type ProductHomeProps = {
  currentSpace: ProductSpace;
  patchId: string;
  teamCount: number;
  reviewCount: number;
  fixtureTitle: string;
  fixtureDetail: string;
  feedLabel: string;
  aiValidation: AIValidationStatus | null;
};

export function ProductHome({ currentSpace, patchId, teamCount, reviewCount, fixtureTitle, fixtureDetail, feedLabel, aiValidation }: ProductHomeProps) {
  const rootHref = productRootHref(currentSpace);
  return <main className="product-home">
    <header className="home-topbar">
      <a className="brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label="Pro Meta Intelligence 홈"><span className="brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span></a>
      <nav aria-label="분야별 분석"><a href={productSpaceHref(currentSpace, "TEAM")}>팀 분석</a><a href={productSpaceHref(currentSpace, "T1")}>T1 브리프</a><a href={productSpaceHref(currentSpace, "CREATOR")}>콘텐츠</a><a href={productSpaceHref(currentSpace, "RADAR")}>메타 레이더</a></nav>
      <span className="home-feed-state"><i />{feedLabel}</span>
    </header>

    <section className="home-hero">
      <div className="home-hero-copy"><span>PUBLIC EVIDENCE · TEAM DECISIONS</span><h1>보고 싶은 분야부터<br /><em>바로 시작하세요.</em></h1><p>복잡한 통계 한 화면 대신 목적별 작업실로 나눴습니다. 공개 경기 근거와 모르는 것의 경계는 모든 페이지에서 동일하게 유지됩니다.</p><div><a href={productSpaceHref(currentSpace, "T1")}>T1 원페이지 브리프</a><a href={productSpaceHref(currentSpace, "TEAM")}>내 팀 기준 분석</a></div><small>계정 연결 없음 · 공개 데이터만 사용 · 독립 분석 서비스</small></div>
      <figure><img src={`${rootHref}meta-radar-hero-v2.png`} alt="지역별 메타 신호가 분석 후보로 모이는 일러스트" /><figcaption><span>PATCH {patchId}</span><b>{reviewCount} REVIEW SIGNALS</b></figcaption></figure>
    </section>

    <section className={`home-ai-status ${aiValidation?.ai_features_enabled ? "validated" : "locked"}`} aria-label="AI 검증 상태">
      <div><span>AI RELEASE GATE</span><h2>{aiValidation?.ai_features_enabled ? "사람 비교 검증 통과" : "검증 전 AI 기능 잠금"}</h2><p>정확도·치명적 오류·근거 경계·시간 절감을 같은 숨김 과제에서 사람과 비교합니다.</p></div>
      <dl><div><dt>쌍대 표본</dt><dd>{aiValidation?.paired_holdout_case_count ?? 0} / {aiValidation?.policy.minimum_paired_holdout_cases ?? 30}</dd></div><div><dt>현재 경로</dt><dd>{aiValidation?.ai_features_enabled ? "검증 AI + 사람 승인" : "결정론적 분석"}</dd></div></dl>
      <a href={productSpaceHref(currentSpace, "CREATOR")}>검증 기준 보기 →</a>
    </section>

    <section className="home-live-strip" aria-label="현재 공개 데이터 상태">
      <article><span>LIVE PATCH</span><strong>{patchId}</strong><small>검증된 발행 스냅샷</small></article>
      <article><span>TEAM COVERAGE</span><strong>{teamCount}</strong><small>공개 팀 프로필</small></article>
      <article><span>T1 NEXT</span><strong>{fixtureTitle}</strong><small>{fixtureDetail}</small></article>
      <article><span>REVIEW QUEUE</span><strong>{reviewCount}</strong><small>표본 기준 통과 후보</small></article>
    </section>

    <section className="home-spaces" aria-labelledby="home-spaces-title">
      <header><span>CHOOSE YOUR WORKSPACE</span><h2 id="home-spaces-title">한 번에 한 가지 일만.</h2><p>각 페이지는 필요한 정보와 행동만 남깁니다.</p></header>
      <div>
        <a className="team" href={productSpaceHref(currentSpace, "TEAM")}><b>01</b><span>TEAM ROOM</span><h3>내 팀 기준 분석</h3><p>소속 팀을 고르고 상대 우선순위, 오늘 검토 후보, 드래프트 배틀카드를 봅니다.</p><small>팀 선택부터 시작 →</small></a>
        <a className="t1" href={productSpaceHref(currentSpace, "T1")}><b>02</b><span>T1 DESK</span><h3>T1 원페이지 브리프</h3><p>공식 일정, 공개 픽·밴 관측, 준비 게이트와 확정 시 5라인 충돌을 한 장으로 봅니다.</p><small>{fixtureTitle} →</small></a>
        <a className="creator" href={productSpaceHref(currentSpace, "CREATOR")}><b>03</b><span>CREATOR STUDIO</span><h3>분석 콘텐츠 제작</h3><p>검증된 동일 근거를 유튜브·쇼츠 카드와 편집 가능한 장면 JSON으로 바꿉니다.</p><small>영상 아이템 만들기 →</small></a>
        <a className="radar" href={productSpaceHref(currentSpace, "RADAR")}><b>04</b><span>META RADAR</span><h3>전체 메타 탐색</h3><p>지역 차이, 수요 속도, 표본 경고와 원본 이벤트를 직접 검토하는 분석가 화면입니다.</p><small>전체 신호 열기 →</small></a>
      </div>
    </section>

    <section className="home-principles"><article><b>01</b><h3>공식·지원 소스 우선</h3><p>일정과 공개 경기 데이터의 출처·시점·해시를 유지합니다.</p></article><article><b>02</b><h3>모르면 대기</h3><p>TBD 상대, 스크림, 선수 컨디션과 내부 계획은 추정하지 않습니다.</p></article><article><b>03</b><h3>한 코어, 다른 출력</h3><p>팀 회의와 콘텐츠 제작이 같은 검증 근거를 공유합니다.</p></article></section>

    <footer className="home-footer"><span>PRO META INTELLIGENCE</span><p>공개 경기 근거를 검토 가능한 팀 결정과 분석 콘텐츠로 전환합니다.</p><a href={productSpaceHref(currentSpace, "RADAR")}>데이터 경계 확인 →</a></footer>
    <section className="legal-notice" aria-label="Riot Games 비제휴 고지">캐릭터 이미지는 Riot Games Data Dragon을 통해 제공됩니다. Pro Meta Intelligence isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</section>
  </main>;
}
