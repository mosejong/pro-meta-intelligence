"use client";

/* eslint-disable @next/next/no-img-element -- checked-in art and stable Riot CDN assets */

import { type FormEvent, useState } from "react";
import type { AIValidationStatus } from "./ai-validation";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import { DataTrustBar, type FeedTrustKind, type ScheduleTrustState } from "./data-trust-bar";
import { homeSpaceForQuestion } from "./home-intent";
import type { ProductSpace } from "./product-space";
import { productRootHref, productSpaceHref } from "./product-space";

type ChampionFocus = {
  championId: string;
  role: string | null;
  gameCount: number;
  gameRate: number;
};

type MetaFocus = {
  championId: string;
  role: string;
  teamCount: number;
  pickPresenceDelta: number;
};

type ProductHomeProps = {
  currentSpace: ProductSpace;
  patchId: string;
  teamCount: number;
  reviewCount: number;
  fixtureTitle: string;
  fixtureDetail: string;
  feedLabel: string;
  feedKind: FeedTrustKind;
  dataCutoff: string;
  checkedAt: string | null;
  scheduleRetrievedAt: string | null;
  scheduleState: ScheduleTrustState;
  scheduleSourceUrl: string | null;
  aiValidation: AIValidationStatus | null;
  t1Focus: ChampionFocus | null;
  metaFocus: MetaFocus | null;
};

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function ProductHome({
  currentSpace,
  patchId,
  teamCount,
  reviewCount,
  fixtureTitle,
  fixtureDetail,
  feedLabel,
  feedKind,
  dataCutoff,
  checkedAt,
  scheduleRetrievedAt,
  scheduleState,
  scheduleSourceUrl,
  aiValidation,
  t1Focus,
  metaFocus,
}: ProductHomeProps) {
  const { nameOf } = useChampionNames();
  const rootHref = productRootHref(currentSpace);
  const [question, setQuestion] = useState("");
  const aiEnabled = aiValidation?.ai_features_enabled === true;

  function openQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.assign(productSpaceHref(currentSpace, homeSpaceForQuestion(question)));
  }

  return <main className="product-home">
    <header className="home-topbar">
      <a className="brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label="Pro Meta Intelligence 홈"><span className="brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span></a>
      <nav aria-label="분야별 분석"><a href={productSpaceHref(currentSpace, "T1")}>T1 오늘 준비</a><a href={productSpaceHref(currentSpace, "TEAM")}>내 팀 분석</a><a href={productSpaceHref(currentSpace, "CREATOR")}>영상 소재</a><a href={productSpaceHref(currentSpace, "RADAR")}>전체 데이터</a></nav>
      <span className="home-feed-state"><i />{feedLabel}</span>
    </header>

    <section className="home-hero">
      <div className="home-hero-copy">
        <span>T1 FIRST · PUBLIC MATCH EVIDENCE</span>
        <h1>T1, 오늘<br /><em>뭐부터 볼까?</em></h1>
        <p>다음 경기, 자주 나온 픽, 이번 패치에서 올라오는 후보를 먼저 보여드립니다. 복잡한 수치는 궁금할 때만 열어보세요.</p>
        <div><a href="#home-today">오늘의 핵심 3개</a><a href={productSpaceHref(currentSpace, "TEAM")}>내 팀으로 분석하기</a></div>
        <small>가입 없음 · 공개 경기 데이터 · 모르는 내용은 추정하지 않음</small>
      </div>
      <figure><img src={`${rootHref}meta-radar-hero-v2.png`} alt="지역별 메타 신호가 분석 후보로 모이는 일러스트" /><figcaption><span>현재 패치 {patchId}</span><b>지금 더 볼 후보 {reviewCount}개</b></figcaption></figure>
    </section>

    <DataTrustBar
      dataCutoff={dataCutoff}
      checkedAt={checkedAt}
      feedKind={feedKind}
      scheduleRetrievedAt={scheduleRetrievedAt}
      scheduleState={scheduleState}
      scheduleSourceUrl={scheduleSourceUrl}
    />

    <section className="home-today" id="home-today" aria-labelledby="home-today-title">
      <header><span>TODAY · 30 SECOND BRIEF</span><h2 id="home-today-title">오늘은 이것만 먼저 보세요.</h2><p>결론을 먼저 읽고, 더 궁금한 카드만 자세히 확인할 수 있습니다.</p></header>
      <div>
        <a className="fixture" href={productSpaceHref(currentSpace, "T1")}>
          <span className="home-today-number">01</span><div className="home-team-mark" aria-hidden="true">T1</div>
          <div><small>다음 공식 일정</small><h3>{fixtureTitle}</h3><p>{fixtureDetail}</p></div><b>일정과 준비 상태 →</b>
        </a>
        <a className="pick" href={productSpaceHref(currentSpace, "T1")}>
          <span className="home-today-number">02</span>{t1Focus ? <img src={championImageUrl(t1Focus.championId)} alt="" /> : <div className="home-team-mark muted" aria-hidden="true">?</div>}
          <div><small>T1 공개 경기 반복 픽</small><h3>{t1Focus ? `${nameOf(t1Focus.championId)} · ${roleLabels[t1Focus.role ?? ""] ?? t1Focus.role ?? "역할 확인"}` : "공개 표본 대기"}</h3><p>{t1Focus ? `${t1Focus.gameCount}경기에서 관측 · 경기 기준 ${percent(t1Focus.gameRate)}` : "새 경기 표본이 들어오면 가장 반복된 픽을 표시합니다."}</p></div><b>픽·밴 근거 보기 →</b>
        </a>
        <a className="meta" href={productSpaceHref(currentSpace, "RADAR")}>
          <span className="home-today-number">03</span>{metaFocus ? <img src={championImageUrl(metaFocus.championId)} alt="" /> : <div className="home-team-mark muted" aria-hidden="true">?</div>}
          <div><small>이번 패치 주목 후보</small><h3>{metaFocus ? `${nameOf(metaFocus.championId)} · ${roleLabels[metaFocus.role] ?? metaFocus.role}` : "검토 후보 대기"}</h3><p>{metaFocus ? `최근 ${metaFocus.teamCount}개 팀 관측 · ${metaFocus.pickPresenceDelta > 0 ? "이전보다 사용 증가" : "추가 관찰 필요"}` : "표본 기준을 통과한 후보가 생기면 표시합니다."}</p></div><b>쉬운 설명과 근거 →</b>
        </a>
      </div>
    </section>

    <section className="home-finder" aria-labelledby="home-finder-title">
      <div><span>QUICK FINDER</span><h2 id="home-finder-title">무엇이 궁금하세요?</h2><p>질문을 분석해 가장 가까운 화면으로 바로 안내합니다.</p></div>
      <form onSubmit={openQuestion}>
        <label className="visually-hidden" htmlFor="home-question">궁금한 내용</label>
        <input id="home-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="예: T1 다음 상대 핵심만 보고 싶어" />
        <button type="submit">바로 찾기 <span>→</span></button>
      </form>
      <nav aria-label="자주 찾는 질문"><button type="button" onClick={() => setQuestion("T1 다음 상대")}>T1 다음 상대</button><button type="button" onClick={() => setQuestion("정글 조커픽")}>정글 조커픽</button><button type="button" onClick={() => setQuestion("유튜브 영상 소재")}>영상 소재</button><button type="button" onClick={() => setQuestion("내 팀 상대 우선순위")}>내 팀 분석</button></nav>
      <small>입력 내용은 저장하거나 서버로 보내지 않습니다. 현재는 AI 답변 대신 검증된 분석 화면으로만 이동합니다.</small>
    </section>

    <section className="home-live-strip" aria-label="현재 공개 데이터 상태">
      <article><span>현재 패치</span><strong>{patchId}</strong><small>검증된 공개 데이터</small></article>
      <article><span>분석 가능한 팀</span><strong>{teamCount}</strong><small>공개 경기 팀 프로필</small></article>
      <article><span>T1 다음 일정</span><strong>{fixtureTitle}</strong><small>{fixtureDetail}</small></article>
      <article><span>더 볼 후보</span><strong>{reviewCount}</strong><small>표본 기준 통과</small></article>
    </section>

    <details className={`home-ai-trust ${aiEnabled ? "validated" : "locked"}`}>
      <summary><span><i />{aiEnabled ? "AI 사람 비교 검증 통과" : "AI 검증 전 · 자동 판단 안 함"}</span><small>현재 보이는 핵심 내용은 공개 데이터 규칙으로 계산되며, 검증 전 AI 문장은 결과에 섞지 않습니다.</small><b>검증 기준 보기</b></summary>
      <div><dl><div><dt>사람과 같은 숨김 과제</dt><dd>{aiValidation?.paired_holdout_case_count ?? 0} / {aiValidation?.policy.minimum_paired_holdout_cases ?? 30}</dd></div><div><dt>AI 상태</dt><dd>{aiEnabled ? "사용 가능" : "잠금"}</dd></div><div><dt>현재 결과 생성</dt><dd>{aiEnabled ? "검증 AI + 사람 승인" : "규칙 기반 분석"}</dd></div></dl><p>정확도, 치명적 오류 0건, 근거 경계, 시간 절감을 모두 통과해야 AI 초안이 열립니다. 자동 게시는 하지 않습니다.</p><a href={productSpaceHref(currentSpace, "CREATOR")}>전체 검증 기준 →</a></div>
    </details>

    <section className="home-spaces" aria-labelledby="home-spaces-title">
      <header><span>CHOOSE ONE JOB</span><h2 id="home-spaces-title">하고 싶은 일 하나만 고르세요.</h2><p>쉬운 요약부터 시작하고, 필요할 때 원본 근거까지 내려갑니다.</p></header>
      <div>
        <a className="t1" href={productSpaceHref(currentSpace, "T1")}><b>01</b><span>T1 TODAY</span><h3>T1 오늘 준비</h3><p>다음 경기, 반복 픽·밴, 상대 확정 여부와 준비 상태를 한 장으로 봅니다.</p><small>{fixtureTitle} →</small></a>
        <a className="team" href={productSpaceHref(currentSpace, "TEAM")}><b>02</b><span>MY TEAM</span><h3>내 팀 상대 분석</h3><p>소속 팀을 고르면 먼저 볼 상대와 드래프트 충돌 후보를 정리합니다.</p><small>팀 선택하기 →</small></a>
        <a className="creator" href={productSpaceHref(currentSpace, "CREATOR")}><b>03</b><span>VIDEO IDEA</span><h3>영상 소재 만들기</h3><p>같은 근거를 제목, 장면 카드, 쇼츠용 이야기 순서로 바꿉니다.</p><small>영상 아이템 만들기 →</small></a>
        <a className="radar" href={productSpaceHref(currentSpace, "RADAR")}><b>04</b><span>ALL DATA</span><h3>전체 메타 자세히 보기</h3><p>챔피언별 변화와 지역 차이, 표본 경고, 원본 경기 근거를 확인합니다.</p><small>전체 후보 열기 →</small></a>
      </div>
    </section>

    <section className="home-principles"><article><b>01</b><h3>결론부터</h3><p>먼저 세 줄로 보고, 궁금한 내용만 자세히 펼칩니다.</p></article><article><b>02</b><h3>모르면 대기</h3><p>TBD 상대, 스크림, 선수 컨디션과 팀 내부 계획은 추정하지 않습니다.</p></article><article><b>03</b><h3>근거는 그대로</h3><p>쉬운 설명과 팀 자료, 영상 소재가 같은 공개 경기 근거를 공유합니다.</p></article></section>

    <footer className="home-footer"><span>PRO META INTELLIGENCE</span><p>공개 경기 근거를 누구나 이해할 수 있는 T1 브리프와 분석 콘텐츠로 전환합니다.</p><a href={productSpaceHref(currentSpace, "RADAR")}>데이터 경계 확인 →</a></footer>
    <section className="legal-notice" aria-label="Riot Games 비제휴 고지">캐릭터 이미지는 Riot Games Data Dragon을 통해 제공됩니다. Pro Meta Intelligence isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</section>
  </main>;
}
