"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isRadarReport, type RadarEntry, type RadarReport } from "./radar-types";
import { sampleReport } from "./sample-report";

const flagLabels: Record<string, string> = {
  INSUFFICIENT_RECENT_MATCHES: "최근 경기 표본 부족",
  INSUFFICIENT_PRIOR_MATCHES: "이전 경기 표본 부족",
  LOW_CURRENT_PICK_COUNT: "최근 픽 표본 부족",
  INSUFFICIENT_REGIONAL_SAMPLES: "지역 표본 부족",
  UNMAPPED_LEAGUE_EVIDENCE: "미등록 리그 포함",
};

type FeedState = {
  kind: "connecting" | "published" | "demo" | "uploaded";
  label: string;
  detail: string;
};

function keyOf(entry: RadarEntry) {
  return `${entry.champion_id}::${entry.role}`;
}

function percent(value: number | null, digits = 0) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function points(value: number | null) {
  if (value === null) return "—";
  const amount = value * 100;
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toFixed(1)}pp`;
}

function signalFor(entry: RadarEntry) {
  if (!entry.eligible_for_review) return "관찰";
  if (entry.metrics.demand_velocity >= 0.2) return "급상승";
  if (entry.metrics.demand_velocity > 0) return "확산 중";
  return "유지";
}

function verdictFor(entry: RadarEntry) {
  const { metrics } = entry;
  if (!entry.eligible_for_review) {
    return "수치는 관측됐지만 검토 기준을 충족하지 못했습니다. 품질 경고를 먼저 확인하세요.";
  }
  if (metrics.demand_velocity > 0 && metrics.pick_presence_delta > 0) {
    return `최근 구간에서 ${metrics.current_distinct_team_count}개 팀이 채택했고, 픽 점유율과 팀 수요가 함께 상승했습니다.`;
  }
  if (metrics.pick_presence_delta > 0) {
    return "픽 점유율은 상승했지만 채택 팀의 폭은 아직 제한적입니다. 추가 경기를 관찰할 가치가 있습니다.";
  }
  return "최근 점유율이 이전 구간보다 낮습니다. 현재는 상승 후보보다 비교 기준으로 보는 편이 적절합니다.";
}

function formatCutoff(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

function qualityState(report: RadarReport) {
  const critical = report.entries.filter((entry) => !entry.eligible_for_review).length;
  const unknown = report.quality.unknown_leagues.length;
  const publication = report.publication_readiness;
  const importQuality = publication?.selected_patch_import_quality;
  const excluded = importQuality?.known_exclusion_game_count ?? 0;
  const blocking = importQuality?.blocking_issue_game_count ?? 0;
  const label = blocking || unknown || publication?.ready_for_radar === false
    ? "CHECK"
    : excluded
      ? "AUDITED"
      : critical
        ? "CHECK"
        : "PASS";
  return { label, critical, unknown, excluded, blocking, importQuality, publication };
}

export function RadarDashboard() {
  const [report, setReport] = useState<RadarReport>(sampleReport);
  const [selectedKey, setSelectedKey] = useState(keyOf(sampleReport.entries[0]));
  const [role, setRole] = useState("ALL");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(18);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedState, setFeedState] = useState<FeedState>({
    kind: "connecting",
    label: "FEED CONNECTING",
    detail: "발행 피드를 확인하는 중",
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const manualOverride = useRef(false);

  const roles = useMemo(
    () => ["ALL", ...Array.from(new Set(report.entries.map((entry) => entry.role))).sort()],
    [report],
  );
  const visibleEntries = useMemo(
    () => report.entries.filter((entry) => (role === "ALL" || entry.role === role) && (!eligibleOnly || entry.eligible_for_review)),
    [eligibleOnly, report, role],
  );
  const displayedEntries = visibleEntries.slice(0, visibleLimit);
  const selected = visibleEntries.find((entry) => keyOf(entry) === selectedKey) ?? visibleEntries[0] ?? report.entries[0];
  const quality = qualityState(report);
  const eligibleCount = report.entries.filter((entry) => entry.eligible_for_review).length;

  const loadPublishedFeed = useCallback(async () => {
    if (manualOverride.current) return;
    try {
      const feedUrl = new URL("feed/current.json", document.baseURI);
      const response = await fetch(feedUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`feed returned ${response.status}`);
      const parsed: unknown = await response.json();
      if (!isRadarReport(parsed)) throw new Error("unsupported report");
      setReport(parsed);
      setSelectedKey(parsed.entries[0] ? keyOf(parsed.entries[0]) : "");
      setRole("ALL");
      setEligibleOnly(false);
      setVisibleLimit(18);
      setFeedState({
        kind: parsed.fixture_only ? "demo" : "published",
        label: parsed.fixture_only ? "PUBLISHED DEMO FEED" : "LIVE PUBLISHED FEED",
        detail: parsed.fixture_only ? "자동 연결됨 · 합성 데이터" : "자동 연결됨 · 검증된 발행본",
      });
    } catch {
      setFeedState({
        kind: "demo",
        label: "DEMO FALLBACK",
        detail: "발행 피드 없음 · 내장 데모 표시 중",
      });
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadPublishedFeed(), 0);
    const interval = window.setInterval(() => void loadPublishedFeed(), 5 * 60 * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadPublishedFeed]);

  useEffect(() => {
    if (!evidenceOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidenceOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [evidenceOpen]);

  async function loadReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRadarReport(parsed) || parsed.entries.length === 0) {
        throw new Error("unsupported report");
      }
      setReport(parsed);
      setSelectedKey(keyOf(parsed.entries[0]));
      setRole("ALL");
      setEligibleOnly(false);
      setVisibleLimit(18);
      manualOverride.current = true;
      setFeedState({ kind: "uploaded", label: "LOCAL FILE", detail: file.name.toUpperCase() });
    } catch {
      setFeedState({ kind: "demo", label: "INVALID LOCAL FILE", detail: "기존 화면 유지" });
    } finally {
      event.target.value = "";
    }
  }

  const regions = selected ? [
    { region: "GLOBAL", pick_presence: selected.metrics.current_pick_presence, sample_eligible: true },
    ...selected.region_presence,
  ] : [];

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Pro Meta Intelligence 홈">
          <span className="brand-mark">PM</span>
          <span><strong>PRO META</strong><small>INTELLIGENCE</small></span>
        </a>
        <nav aria-label="주요 메뉴">
          <a className="active" href="#radar">메타 레이더</a>
          <a href="#evidence">선택 근거</a>
          <a href="#method">읽는 법</a>
        </nav>
        <div className="topbar-actions">
          <span className={`snapshot-state ${feedState.kind}`} title={feedState.detail} aria-live="polite"><i />{feedState.label}</span>
          <button className="refresh-button" type="button" onClick={() => { manualOverride.current = false; void loadPublishedFeed(); }} aria-label="발행 피드 새로고침">↻</button>
          <button className="load-button" type="button" onClick={() => fileInput.current?.click()}>
            JSON 불러오기 <span>↗</span>
          </button>
        </div>
        <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={loadReport} aria-label="Meta Radar JSON 불러오기" />
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="kicker-row"><p className="eyebrow">패치 {report.patch_id} · 분석 스냅샷</p><span>{feedState.detail}</span></div>
          <h1>메타의 변화를<br /><em>읽기 쉽게, 근거와 함께.</em></h1>
          <p className="lede">최근 경기와 바로 이전 구간을 비교해 어떤 챔피언이 여러 팀과 지역으로 퍼지는지 보여줍니다. 복잡한 종합 점수 대신 실제 픽 변화, 팀 수요, 지역 편차를 차례로 읽을 수 있습니다.</p>
          <div className="hero-meta" aria-label="스냅샷 정보">
            <span>분석 기준</span><strong>{formatCutoff(report.cutoff)} KST</strong>
            <span>비교 구간</span><strong>최근 {report.windows.recent.days}일 / 이전 {report.windows.prior.days}일</strong>
            <span>데이터</span><strong>{report.evidence_index.source_versions[0]?.source_id ?? "출처 없음"}</strong>
            <span>상태</span><strong>{report.fixture_only ? "예시 데이터" : "검증된 실데이터"}</strong>
          </div>
        </div>
        <figure className="hero-visual">
          {/* A plain image keeps the same relative asset path in both vinext and GitHub Pages builds. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="meta-radar-hero-v2.png" width="1672" height="940" alt="지역별 데이터 흐름을 레이더로 탐지해 검토 후보를 찾는 과정" />
          <figcaption><b>신호 탐지 → 지역 비교 → 근거 확인</b><span>숫자를 읽기 전에 분석 흐름을 먼저 파악하세요.</span></figcaption>
        </figure>
      </section>

      <section className="summary" aria-label="요약 지표">
        <article><span>검토할 후보</span><strong>{String(eligibleCount).padStart(2, "0")}</strong><small>최소 표본 기준 통과</small></article>
        <article><span>비교 경기 수</span><strong>{String(report.windows.recent.match_count).padStart(2, "0")} <b>/ {String(report.windows.prior.match_count).padStart(2, "0")}</b></strong><small>최근 구간 / 이전 구간</small></article>
        <article><span>활성 팀</span><strong>{String(report.windows.recent.active_team_count).padStart(2, "0")}</strong><small>최근 구간의 고유 팀</small></article>
        <article><span>데이터 품질</span><strong className={`quality ${quality.label === "CHECK" ? "caution" : quality.label === "AUDITED" ? "audited" : ""}`}>{quality.label === "AUDITED" ? "검토 완료" : quality.label === "PASS" ? "통과" : "확인 필요"}</strong><small>제외 {quality.excluded} · 위반 {quality.blocking} · 미등록 {quality.unknown}</small></article>
      </section>

      {quality.publication && quality.importQuality && <section className={`audit-notice ${quality.publication.ready_for_radar ? "ready" : "blocked"}`} aria-label="발행 데이터 품질 감사" role="status">
        <div><span>발행 데이터 감사</span><strong>전체 {quality.importQuality.discovered_game_count}경기 중 {quality.importQuality.imported_game_count}경기 사용</strong></div>
        <p>{quality.importQuality.known_exclusion_game_count}개 경기는 불완전 기록 또는 팀 ID 누락으로 완전히 제외했습니다. 분석에 포함된 경기의 계약 위반은 {quality.importQuality.blocking_issue_game_count}건이며, 미등록 리그는 {quality.unknown}개입니다.</p>
        <b>{quality.publication.ready_for_radar ? "제외 내역 공개 · 분석 가능" : "발행 차단"}</b>
      </section>}

      <section className="workspace" id="radar">
        <div className="section-heading">
          <div><p className="eyebrow">01 · 신호 목록</p><h2>지금 살펴볼 변화</h2><p className="section-description">여러 팀으로 빠르게 퍼지거나 특정 지역에서 유난히 많이 등장한 후보부터 보여줍니다.</p></div>
          <div className="controls">
            <label>포지션<select value={role} onChange={(event) => { setRole(event.target.value); setVisibleLimit(18); }}>{roles.map((item) => <option key={item}>{item === "ALL" ? "전체" : item}</option>)}</select></label>
            <label className="toggle"><input type="checkbox" checked={eligibleOnly} onChange={(event) => setEligibleOnly(event.target.checked)} /><span /> 기준 통과만</label>
          </div>
        </div>

        <div className="radar-grid">
          <div className="candidate-table" aria-label="메타 레이더 후보">
            <div className="table-head"><span>챔피언 / 포지션</span><span>최근 픽 점유율</span><span>팀 수요 변화</span><span>지역 편차</span><span>판정</span></div>
            {displayedEntries.length ? displayedEntries.map((entry) => {
              const active = Boolean(selected && keyOf(entry) === keyOf(selected));
              const signal = signalFor(entry);
              return (
                <button className={`candidate ${active ? "selected" : ""}`} type="button" key={keyOf(entry)} onClick={() => setSelectedKey(keyOf(entry))} aria-pressed={active}>
                  <span className="champion"><b>{String(entry.rank).padStart(2, "0")}</b><span><strong>{entry.champion_id.toUpperCase()}</strong><small>{entry.role}</small></span></span>
                  <span className="presence"><span><i style={{ width: `${Math.min(entry.metrics.current_pick_presence * 100, 100)}%` }} /></span><strong>{percent(entry.metrics.current_pick_presence)} <small>{points(entry.metrics.pick_presence_delta)}</small></strong></span>
                  <strong className={entry.metrics.demand_velocity >= 0 ? "positive" : "negative"}>{points(entry.metrics.demand_velocity)}</strong>
                  <span className="region-gap">{entry.metrics.most_divergent_region ?? "—"} {points(entry.metrics.most_divergent_region_delta)}</span>
                  <span className={`status ${entry.eligible_for_review ? "eligible" : "watch"}`}>{signal}</span>
                </button>
              );
            }) : <div className="empty-state">현재 필터에 맞는 후보가 없습니다.</div>}
            {visibleEntries.length > 0 && <div className="candidate-more"><p>전체 {visibleEntries.length}개 중 {Math.min(displayedEntries.length, visibleEntries.length)}개 표시</p>{displayedEntries.length < visibleEntries.length && <button type="button" onClick={() => setVisibleLimit((current) => current + 18)}>후보 더 보기 <span>＋</span></button>}</div>}
          </div>

          {selected ? <aside className="detail" id="evidence">
            <div className="detail-head"><div><span>선택한 신호</span><h3>{selected.champion_id.toUpperCase()} · {selected.role}</h3></div><b>{String(selected.rank).padStart(2, "0")}</b></div>
            <p className="verdict">{verdictFor(selected)}</p>
            <div className="region-bars" aria-label="지역별 픽 점유율">
              {regions.map((region) => <div className={!region.sample_eligible ? "weak" : ""} key={region.region}><span>{region.region}</span><i><b style={{ width: `${Math.min(region.pick_presence * 100, 100)}%` }} /></i><strong>{percent(region.pick_presence)}</strong></div>)}
            </div>
            <dl className="evidence-stats">
              <div><dt>채택한 팀</dt><dd>{selected.metrics.current_distinct_team_count} / {report.windows.recent.active_team_count}</dd></div>
              <div><dt>팀 편중도</dt><dd>{percent(selected.metrics.team_concentration)}</dd></div>
              <div><dt>근거 이벤트</dt><dd>{selected.evidence_event_ids.length}</dd></div>
              <div><dt>표본 기준</dt><dd className={selected.eligible_for_review ? "positive" : "negative"}>{selected.eligible_for_review ? "통과" : "미달"}</dd></div>
            </dl>
            {selected.quality_flags.length > 0 && <div className="flag-list">{selected.quality_flags.map((flag) => <span key={flag}>{flagLabels[flag] ?? flag}</span>)}</div>}
            <button className="evidence-button" type="button" onClick={() => setEvidenceOpen(true)}>근거 레코드 보기 <span>→</span></button>
          </aside> : <aside className="detail detail-empty" id="evidence"><span>NO REVIEW SIGNALS</span><p>이 스냅샷에는 표시할 후보가 없습니다. 표본 기준과 수집 상태를 확인하세요.</p></aside>}
        </div>
      </section>

      <section className="method" id="method">
        <div><p className="eyebrow">02 · 레이더 읽는 법</p><h2>점수 하나보다, 네 가지 판단 단서.</h2></div>
        <div className="method-grid">
          <article><b>01</b><h3>팀 수요 속도</h3><p>한 팀의 반복 사용이 아니라, 서로 다른 팀으로 채택이 넓어지는지 봅니다.</p></article>
          <article><b>02</b><h3>픽 점유율 변화</h3><p>동일 패치 안에서 최근 구간과 바로 이전 구간의 경기 점유율을 비교합니다.</p></article>
          <article><b>03</b><h3>지역 편차</h3><p>충분한 경기 표본이 있는 지역만 글로벌 점유율과 비교합니다.</p></article>
          <article><b>04</b><h3>근거와 경고</h3><p>모든 후보에서 원본 이벤트와 표본 부족 여부를 함께 확인합니다.</p></article>
        </div>
      </section>
      <footer><span>종합 점수 없음</span><p>팀 수요 속도 → 픽 점유율 변화 → 지역 편차 순서로 읽습니다.</p><b>SCHEMA v{report.schema_version}</b></footer>
      <section className="legal-notice" aria-label="Riot Games 비제휴 고지">
        Pro Meta Intelligence isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
      </section>

      {evidenceOpen && selected && (
        <div className="dialog-backdrop">
          <button className="dialog-dismiss" type="button" onClick={() => setEvidenceOpen(false)} aria-label="근거 창 닫기" />
          <section className="evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
            <header><div><span>EVIDENCE PACKET · #{String(selected.rank).padStart(2, "0")}</span><h2 id="evidence-title">{selected.champion_id.toUpperCase()} · {selected.role}</h2></div><button type="button" onClick={() => setEvidenceOpen(false)} aria-label="근거 창 닫기">×</button></header>
            <div className="dialog-content">
              <article><h3>결론을 만드는 수치</h3><dl className="metric-list"><div><dt>PICK PRESENCE Δ</dt><dd>{points(selected.metrics.pick_presence_delta)}</dd></div><div><dt>DEMAND VELOCITY</dt><dd>{points(selected.metrics.demand_velocity)}</dd></div><div><dt>REGIONAL DIVERGENCE</dt><dd>{percent(selected.metrics.regional_divergence, 1)}</dd></div><div><dt>TEAM CONCENTRATION</dt><dd>{percent(selected.metrics.team_concentration, 1)}</dd></div></dl></article>
              <article><h3>Pick event IDs</h3><ul className="record-list">{selected.evidence_event_ids.map((id) => <li key={id}>{id}</li>)}</ul></article>
              <article><h3>Source snapshot</h3><ul className="record-list">{report.evidence_index.source_versions.map((source) => <li key={`${source.source_id}:${source.content_hash}`}><b>{source.source_id} · {source.source_version}</b><span>{source.content_hash}</span></li>)}</ul></article>
              <article><h3>계산식</h3><ul className="formula-list">{Object.entries(report.formulae).map(([name, formula]) => <li key={name}><b>{name.replaceAll("_", " ")}</b><span>{formula}</span></li>)}</ul></article>
              <article className="matches"><h3>Window match IDs</h3><div><p>RECENT</p>{report.evidence_index.recent_match_ids.map((id) => <code key={id}>{id}</code>)}</div><div><p>PRIOR</p>{report.evidence_index.prior_match_ids.map((id) => <code key={id}>{id}</code>)}</div></article>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
