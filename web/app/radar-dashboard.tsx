"use client";

/* eslint-disable @next/next/no-img-element -- this dual vinext/Vite build uses stable Riot CDN and relative static assets */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isRadarReport, type OpponentChampionTendency, type OpponentTeam, type RadarEntry, type RadarReport } from "./radar-types";
import { sampleReport } from "./sample-report";
import { buildTeamBrief, serializeTeamBrief } from "./team-brief";

const flagLabels: Record<string, string> = {
  INSUFFICIENT_RECENT_MATCHES: "최근 경기 표본 부족",
  INSUFFICIENT_PRIOR_MATCHES: "이전 경기 표본 부족",
  LOW_CURRENT_PICK_COUNT: "최근 픽 표본 부족",
  INSUFFICIENT_REGIONAL_SAMPLES: "지역 표본 부족",
  UNMAPPED_LEAGUE_EVIDENCE: "미등록 리그 포함",
};

const DATA_DRAGON_VERSION = "16.16.1";
const championAssetOverrides: Record<string, string> = {
  "Cho'Gath": "Chogath",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  LeBlanc: "Leblanc",
  Mundo: "DrMundo",
  "Renata Glasc": "Renata",
  Wukong: "MonkeyKing",
};
const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};
const regionLabels: Record<string, string> = {
  GLOBAL: "전체",
  BRAZIL: "브라질",
  CHINA: "중국",
  EMEA: "유럽권",
  KOREA: "한국",
  LATIN_AMERICA: "라틴",
  NORTH_AMERICA: "북미",
  PACIFIC: "태평양권",
};
const opponentFlagLabels: Record<string, string> = {
  LOW_MATCH_SAMPLE: "경기 표본 부족",
  INCOMPLETE_BAN_EVIDENCE: "일부 밴 기록 누락",
  MISSING_TEAM_DISPLAY_NAME: "팀 표시명 누락",
};

type FeedState = {
  kind: "connecting" | "published" | "demo" | "uploaded";
  label: string;
  detail: string;
};

function keyOf(entry: RadarEntry) {
  return `${entry.champion_id}::${entry.role}`;
}

function championImageUrl(championId: string) {
  const assetId = championAssetOverrides[championId] ?? championId.replace(/[.'\s]/g, "");
  return `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/img/champion/${assetId}.png`;
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

function ChampionTendencyList({ items, emptyLabel }: { items: OpponentChampionTendency[]; emptyLabel: string }) {
  if (!items.length) return <p className="tendency-empty">{emptyLabel}</p>;
  return <div className="tendency-list">{items.map((item) => <div className="tendency-item" key={`${item.champion_id}:${item.role ?? "BAN"}`}>
    <img src={championImageUrl(item.champion_id)} alt="" loading="lazy" />
    <span><strong>{item.champion_id}</strong><small>{item.role ? `${roleLabels[item.role] ?? item.role} · P1 ${item.phase_1_count} · P2 ${item.phase_2_count}` : `1페이즈 ${item.phase_1_count} · 2페이즈 ${item.phase_2_count}`}</small></span>
    <b>{percent(item.game_rate)}</b>
  </div>)}</div>;
}

function preparationQuestions(team: OpponentTeam) {
  const topPick = team.priority_picks[0];
  const topBan = team.frequent_bans[0];
  const receivedBan = team.received_bans[0];
  const rotation = team.first_rotations[0];
  return [
    topPick
      ? `${topPick.champion_id}이 열렸을 때 ${roleLabels[topPick.role ?? ""] ?? topPick.role ?? "해당 역할"} 우선순위를 유지하는지, 어떤 조합에서 달라지는지 확인한다.`
      : "반복 픽 표본이 쌓이기 전까지 특정 챔피언을 핵심 선호로 단정하지 않는다.",
    topBan || receivedBan
      ? `상대가 자주 밴한 ${topBan?.champion_id ?? "후보"}와 상대가 받은 ${receivedBan?.champion_id ?? "후보"}의 맥락을 분리해 우리 밴 예산을 검토한다.`
      : "밴 기록이 부족하므로 상대 의도를 추정하지 말고 원본 드래프트를 먼저 확인한다.",
    rotation
      ? `${rotation.side === "BLUE" ? "블루" : "레드"}에서 ${rotation.champions.join(" → ")} 로테이션이 다시 나오면 준비한 응답 순서가 작동하는지 점검한다.`
      : "반복된 1차 로테이션이 없어 단일 경기 패턴을 재현 가능성으로 오해하지 않는다.",
  ];
}

export function RadarDashboard() {
  const [report, setReport] = useState<RadarReport>(sampleReport);
  const [selectedKey, setSelectedKey] = useState(keyOf(sampleReport.entries[0]));
  const [role, setRole] = useState("ALL");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [opponentId, setOpponentId] = useState(sampleReport.opponent_prep?.teams[0]?.team_id ?? "");
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
  const teamBrief = useMemo(() => buildTeamBrief(report), [report]);
  const opponentTeams = report.opponent_prep?.teams ?? [];
  const displayedEntries = visibleEntries.slice(0, visibleLimit);
  const selected = visibleEntries.find((entry) => keyOf(entry) === selectedKey) ?? visibleEntries[0] ?? report.entries[0];
  const selectedBrief = teamBrief.find((card) => keyOf(card.entry) === selectedKey) ?? teamBrief[0];
  const selectedOpponent = opponentTeams.find((team) => team.team_id === opponentId) ?? opponentTeams[0];
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
      setVisibleLimit(12);
      setOpponentId(parsed.opponent_prep?.teams[0]?.team_id ?? "");
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
      setVisibleLimit(12);
      setOpponentId(parsed.opponent_prep?.teams[0]?.team_id ?? "");
      manualOverride.current = true;
      setFeedState({ kind: "uploaded", label: "LOCAL FILE", detail: file.name.toUpperCase() });
    } catch {
      setFeedState({ kind: "demo", label: "INVALID LOCAL FILE", detail: "기존 화면 유지" });
    } finally {
      event.target.value = "";
    }
  }

  function downloadTeamBrief() {
    const payload = JSON.stringify(serializeTeamBrief(report), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `team-decision-brief-${report.patch_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadOpponentPrep() {
    if (!report.opponent_prep || !selectedOpponent) return;
    const payload = JSON.stringify({
      schema_version: report.opponent_prep.schema_version,
      artifact_type: report.opponent_prep.artifact_type,
      cutoff: report.opponent_prep.cutoff,
      patch_id: report.opponent_prep.patch_id,
      boundary: report.opponent_prep.boundary,
      source_versions: report.opponent_prep.evidence_index.source_versions,
      team: selectedOpponent,
    }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `opponent-prep-${selectedOpponent.team_name.replace(/[^A-Za-z0-9가-힣_-]+/g, "-")}-${report.patch_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
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
          <a className="active" href="#team-brief">팀 브리프</a>
          <a href="#opponent-prep">상대 분석</a>
          <a href="#radar">메타 레이더</a>
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
          <p className="lede">어떤 캐릭터가 여러 팀과 지역으로 퍼지고 있는지만 먼저 보여줍니다. 카드를 누르면 세부 근거를 확인할 수 있습니다.</p>
          <div className="hero-points" aria-label="분석 요약">
            <span>최근 {report.windows.recent.days}일 vs 이전 {report.windows.prior.days}일</span>
            <span>{report.fixture_only ? "예시 데이터" : "검증된 실데이터"}</span>
            <span>{formatCutoff(report.cutoff)} KST</span>
          </div>
        </div>
        <figure className="hero-visual">
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

      <section className="team-brief" id="team-brief">
        <div className="section-heading brief-heading">
          <div>
            <p className="eyebrow">01 · TEAM DECISION BRIEF</p>
            <h2>오늘 코칭스태프가 검토할 5가지</h2>
            <p className="section-description">단순 순위가 아니라 찬성 근거, 반대 근거, 스크림 질문과 중단 조건까지 한 장에 묶었습니다.</p>
          </div>
          <div className="brief-actions">
            <button type="button" onClick={() => window.print()}>인쇄 / PDF</button>
            <button type="button" onClick={downloadTeamBrief}>JSON 내보내기</button>
          </div>
        </div>

        {selectedBrief ? <div className="brief-layout">
          <div className="brief-queue" aria-label="팀 검토 큐">
            <div className="brief-queue-label"><span>PATCH {report.patch_id}</span><b>REVIEW QUEUE</b></div>
            {teamBrief.map((card, index) => {
              const active = keyOf(card.entry) === keyOf(selectedBrief.entry);
              return <button type="button" className={active ? "active" : ""} key={keyOf(card.entry)} onClick={() => setSelectedKey(keyOf(card.entry))} aria-pressed={active}>
                <span className="brief-rank">{String(index + 1).padStart(2, "0")}</span>
                <img src={championImageUrl(card.entry.champion_id)} alt="" />
                <span className="brief-name"><strong>{card.entry.champion_id}</strong><small>{roleLabels[card.entry.role] ?? card.entry.role}</small></span>
                <b className={`decision-chip ${card.decision.toLowerCase()}`}>{card.decisionLabel}</b>
              </button>;
            })}
          </div>

          <article className="decision-sheet">
            <header>
              <div className="decision-champion">
                <img src={championImageUrl(selectedBrief.entry.champion_id)} alt={`${selectedBrief.entry.champion_id} 챔피언`} />
                <div><span>검토 카드 #{String(selectedBrief.entry.rank).padStart(2, "0")}</span><h3>{selectedBrief.entry.champion_id} · {roleLabels[selectedBrief.entry.role] ?? selectedBrief.entry.role}</h3></div>
              </div>
              <b className={`decision-chip ${selectedBrief.decision.toLowerCase()}`}>{selectedBrief.decisionLabel}</b>
            </header>
            <div className="decision-cells">
              <section className="evidence-for"><span>왜 지금 보나</span><p>{selectedBrief.reason}</p></section>
              <section className="evidence-against"><span>반대 근거</span><p>{selectedBrief.counterEvidence}</p></section>
              <section className="practice-question"><span>스크림 질문</span><p>{selectedBrief.practiceQuestion}</p></section>
              <section className="stop-condition"><span>중단 조건</span><p>{selectedBrief.stopCondition}</p></section>
            </div>
            <div className="decision-boundary"><b>팀 데이터 경계</b><p>선수 숙련도 · 스크림 결과 · 팀 의도는 공개 경기로 추측하지 않습니다. 현재 카드는 검토 시작점이며 출전 권고가 아닙니다.</p><span>{selectedBrief.entry.evidence_event_ids.length} EVIDENCE EVENTS</span></div>
          </article>
        </div> : <div className="brief-empty">검토 기준을 통과한 공개 경기 신호가 없습니다.</div>}
      </section>

      <section className="opponent-prep" id="opponent-prep">
        <div className="section-heading opponent-heading">
          <div>
            <p className="eyebrow">02 · OPPONENT PREP PACK</p>
            <h2>상대팀 드래프트 준비 자료</h2>
            <p className="section-description">최근 동일 패치 경기만 사용해 진영, 1·2페이즈 픽/밴, 반복 로테이션을 근거 경기와 함께 정리합니다.</p>
          </div>
          {selectedOpponent && <div className="opponent-controls">
            <label>상대팀<select value={selectedOpponent.team_id} onChange={(event) => setOpponentId(event.target.value)}>{opponentTeams.map((team) => <option key={team.team_id} value={team.team_id}>{team.team_name} · {team.leagues.join("/")} · {team.game_count}G</option>)}</select></label>
            <button type="button" onClick={downloadOpponentPrep}>선택 팀 JSON</button>
          </div>}
        </div>

        {selectedOpponent ? <div className="opponent-pack">
          <header className="opponent-profile">
            <div className="team-monogram" aria-hidden="true">{selectedOpponent.team_name.slice(0, 2).toUpperCase()}</div>
            <div><span>{selectedOpponent.leagues.join(" · ")} · PATCH {report.patch_id}</span><h3>{selectedOpponent.team_name}</h3><p>{formatCutoff(selectedOpponent.evidence.first_observed_at)}부터 {formatCutoff(selectedOpponent.evidence.last_observed_at)}까지</p></div>
            <div className="opponent-flags">{selectedOpponent.quality_flags.length ? selectedOpponent.quality_flags.map((flag) => <b key={flag}>{opponentFlagLabels[flag] ?? flag}</b>) : <b className="clear">표본 경고 없음</b>}</div>
          </header>

          <div className="opponent-summary" aria-label="상대팀 표본 요약">
            <article><span>분석 경기</span><strong>{selectedOpponent.game_count}</strong><small>최대 {report.opponent_prep?.config.maximum_games_per_team}경기</small></article>
            <article><span>공개 경기 승률</span><strong>{percent(selectedOpponent.win_rate)}</strong><small>{selectedOpponent.win_count}승 · 결과는 픽 강도와 동일하지 않음</small></article>
            <article><span>선픽 비율</span><strong>{percent(selectedOpponent.first_pick_rate)}</strong><small>{selectedOpponent.first_pick_count}경기에서 전체 1픽</small></article>
            <article><span>근거 기록</span><strong>{selectedOpponent.evidence.draft_event_ids.length}</strong><small>{selectedOpponent.evidence.match_ids.length}개 원본 경기 ID</small></article>
          </div>

          <div className="opponent-content">
            <div className="draft-tendencies">
              <article><header><span>가져간 픽</span><b>게임 비율</b></header><ChampionTendencyList items={selectedOpponent.priority_picks} emptyLabel="반복 픽 기록 없음" /></article>
              <article><header><span>상대가 한 밴</span><b>게임 비율</b></header><ChampionTendencyList items={selectedOpponent.frequent_bans} emptyLabel="밴 기록 없음" /></article>
              <article><header><span>상대가 받은 밴</span><b>게임 비율</b></header><ChampionTendencyList items={selectedOpponent.received_bans} emptyLabel="상대 밴 기록 없음" /></article>
            </div>

            <div className="opponent-lower">
              <article className="rotation-panel"><header><span>관측된 1차 로테이션</span><b>반복 횟수순 · 의도 추정 아님</b></header><div>{selectedOpponent.first_rotations.length ? selectedOpponent.first_rotations.map((rotation) => <div className="rotation" key={`${rotation.side}:${rotation.champions.join(":")}`}><b>{rotation.side === "BLUE" ? "BLUE" : "RED"}</b><span>{rotation.champions.map((champion) => <span className="rotation-champion" key={champion}><img src={championImageUrl(champion)} alt="" /><small>{champion}</small></span>)}</span><strong>{rotation.game_count}회</strong></div>) : <p className="tendency-empty">1차 로테이션 표본이 없습니다.</p>}</div></article>

              <aside className="staff-checklist"><span>STAFF CHECKLIST</span><h3>회의에서 확인할 질문</h3><ol>{preparationQuestions(selectedOpponent).map((question) => <li key={question}>{question}</li>)}</ol></aside>
            </div>

            <div className="side-evidence-row">
              <div className="side-cards">{(["BLUE", "RED"] as const).map((side) => { const stat = selectedOpponent.side_stats[side]; return <article className={side.toLowerCase()} key={side}><span>{side} SIDE</span><strong>{stat?.game_count ?? 0}G</strong><small>{stat?.win_rate === null || stat === undefined ? "표본 없음" : `${percent(stat.win_rate)} 공개 경기 승률`}</small></article>; })}</div>
              <details className="opponent-evidence"><summary>근거 경기 ID와 데이터 경계 보기 <span>＋</span></summary><p>이 자료는 공개 경기에서 반복된 사실만 기술합니다. 밴의 의도, 코치의 지시, 선수 숙련도와 스크림 계획은 추정하지 않습니다.</p><div>{selectedOpponent.evidence.match_ids.map((id) => <code key={id}>{id}</code>)}</div></details>
            </div>
          </div>
        </div> : <div className="brief-empty">현재 발행본에는 상대팀 드래프트 자료가 없습니다. 다음 검증된 피드부터 표시됩니다.</div>}
      </section>

      <section className="workspace" id="radar">
        <div className="section-heading">
          <div><p className="eyebrow">03 · 신호 목록</p><h2>전체 메타 신호 탐색</h2><p className="section-description">팀 브리프의 결론을 직접 검증하거나 다른 역할의 후보를 탐색할 때 사용합니다.</p></div>
          <div className="controls">
            <label>포지션<select value={role} onChange={(event) => { setRole(event.target.value); setVisibleLimit(12); }}>{roles.map((item) => <option key={item}>{item === "ALL" ? "전체" : (roleLabels[item] ?? item)}</option>)}</select></label>
            <label className="toggle"><input type="checkbox" checked={eligibleOnly} onChange={(event) => setEligibleOnly(event.target.checked)} /><span /> 기준 통과만</label>
          </div>
        </div>

        <div className="radar-grid">
          <div className="candidate-table" aria-label="메타 레이더 후보">
            <div className="list-guide"><strong>우선 검토 순서</strong><span>카드를 선택하면 오른쪽에서 지역별 근거를 볼 수 있습니다.</span></div>
            {displayedEntries.length ? displayedEntries.map((entry) => {
              const active = Boolean(selected && keyOf(entry) === keyOf(selected));
              const signal = signalFor(entry);
              return (
                <button className={`candidate ${active ? "selected" : ""}`} type="button" key={keyOf(entry)} onClick={() => setSelectedKey(keyOf(entry))} aria-pressed={active}>
                  <span className="champion-portrait"><img src={championImageUrl(entry.champion_id)} alt={`${entry.champion_id} 캐릭터`} loading="lazy" /><b>{String(entry.rank).padStart(2, "0")}</b></span>
                  <span className="champion"><strong>{entry.champion_id}</strong><small>{roleLabels[entry.role] ?? entry.role}</small></span>
                  <span className="signal-metrics"><span><small>픽 점유율</small><strong>{percent(entry.metrics.current_pick_presence)} <em>{points(entry.metrics.pick_presence_delta)}</em></strong></span><span><small>팀 수요</small><strong className={entry.metrics.demand_velocity >= 0 ? "positive" : "negative"}>{points(entry.metrics.demand_velocity)}</strong></span></span>
                  <span className={`status ${entry.eligible_for_review ? "eligible" : "watch"}`}>{signal}</span>
                </button>
              );
            }) : <div className="empty-state">현재 필터에 맞는 후보가 없습니다.</div>}
            {visibleEntries.length > 0 && <div className="candidate-more"><p>전체 {visibleEntries.length}개 중 {Math.min(displayedEntries.length, visibleEntries.length)}개 표시</p>{displayedEntries.length < visibleEntries.length && <button type="button" onClick={() => setVisibleLimit((current) => current + 12)}>12개 더 보기 <span>＋</span></button>}</div>}
          </div>

          {selected ? <aside className="detail" id="evidence">
            <div className="detail-head"><div className="detail-identity"><img src={championImageUrl(selected.champion_id)} alt={`${selected.champion_id} 캐릭터`} /><div><span>선택한 신호</span><h3>{selected.champion_id} · {roleLabels[selected.role] ?? selected.role}</h3></div></div><b>{String(selected.rank).padStart(2, "0")}</b></div>
            <p className="verdict">{verdictFor(selected)}</p>
            <div className="region-bars" aria-label="지역별 픽 점유율">
              {regions.map((region) => <div className={!region.sample_eligible ? "weak" : ""} key={region.region}><span>{regionLabels[region.region] ?? region.region}</span><i><b style={{ width: `${Math.min(region.pick_presence * 100, 100)}%` }} /></i><strong>{percent(region.pick_presence)}</strong></div>)}
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
        <div><p className="eyebrow">04 · 레이더 읽는 법</p><h2>점수 하나보다, 네 가지 판단 단서.</h2></div>
        <div className="method-grid">
          <article><b>01</b><h3>팀 수요 속도</h3><p>한 팀의 반복 사용이 아니라, 서로 다른 팀으로 채택이 넓어지는지 봅니다.</p></article>
          <article><b>02</b><h3>픽 점유율 변화</h3><p>동일 패치 안에서 최근 구간과 바로 이전 구간의 경기 점유율을 비교합니다.</p></article>
          <article><b>03</b><h3>지역 편차</h3><p>충분한 경기 표본이 있는 지역만 글로벌 점유율과 비교합니다.</p></article>
          <article><b>04</b><h3>근거와 경고</h3><p>모든 후보에서 원본 이벤트와 표본 부족 여부를 함께 확인합니다.</p></article>
        </div>
      </section>
      <footer><span>종합 점수 없음</span><p>팀 수요 속도 → 픽 점유율 변화 → 지역 편차 순서로 읽습니다.</p><b>SCHEMA v{report.schema_version}</b></footer>
      <section className="legal-notice" aria-label="Riot Games 비제휴 고지">
        캐릭터 이미지는 Riot Games Data Dragon을 통해 제공됩니다. Pro Meta Intelligence isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
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
