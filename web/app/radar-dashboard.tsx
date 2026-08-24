"use client";

/* eslint-disable @next/next/no-img-element -- this dual vinext/Vite build uses stable Riot CDN and relative static assets */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { championImageUrl } from "./champion-assets";
import { CreatorExportLab } from "./creator-export";
import { isHistoryStatus, isRadarReport, isScheduleSnapshot, type OpponentChampionTendency, type OpponentTeam, type RadarEntry, type RadarReport, type ScheduleSnapshot } from "./radar-types";
import { buildEmergencyBrief } from "./emergency-brief";
import { buildMatchupBattlecard, type BattlecardSignal } from "./matchup-battlecard";
import { sampleReport } from "./sample-report";
import { buildTeamContext } from "./team-context";
import { buildTeamBrief, serializeTeamBrief } from "./team-brief";

const MY_TEAM_STORAGE_KEY = "pmi:my-team-id";

const flagLabels: Record<string, string> = {
  INSUFFICIENT_RECENT_MATCHES: "최근 경기 표본 부족",
  INSUFFICIENT_PRIOR_MATCHES: "이전 경기 표본 부족",
  LOW_CURRENT_PICK_COUNT: "최근 픽 표본 부족",
  INSUFFICIENT_REGIONAL_SAMPLES: "지역 표본 부족",
  UNMAPPED_LEAGUE_EVIDENCE: "미등록 리그 포함",
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
const historyGateLabels: Record<string, string> = {
  RETRIEVALS: "일일 수집",
  UNIQUE_STATES: "고유 데이터 상태",
  COLLECTION_SPAN: "수집 기간",
  MATURED_CUTOFFS: "미래 결과 확보",
};
const historyUnitLabels: Record<string, string> = {
  snapshots: "회",
  states: "개",
  days: "일",
  cutoffs: "개",
};
const historyActionLabels: Record<string, string> = {
  KEEP_DAILY_COLLECTION: "일일 수집 계속",
  WAIT_FOR_DISTINCT_SOURCE_STATES: "새 경기 상태 대기",
  WAIT_FOR_OUTCOME_HORIZON: "미래 결과 기간 대기",
  REVIEW_SKIPPED_CUTOFFS: "제외된 평가 구간 검토",
  REVIEW_BENCHMARK_RESULTS: "실데이터 결과 검토",
  REVIEW_HISTORY_BLOCKERS: "차단 원인 검토",
};

type FeedState = {
  kind: "connecting" | "published" | "demo" | "uploaded";
  label: string;
  detail: string;
};

function keyOf(entry: RadarEntry) {
  return `${entry.champion_id}::${entry.role}`;
}

export function matchesTeamQuery(team: OpponentTeam, query: string) {
  const terms = query.trim().normalize("NFKD").toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchable = [team.team_name, ...team.team_name_aliases, ...team.leagues]
    .join(" ")
    .normalize("NFKD")
    .toLocaleLowerCase("en-US");
  return terms.every((term) => searchable.includes(term));
}

function pinSelectedTeam(teams: OpponentTeam[], selected: OpponentTeam | undefined) {
  return selected && !teams.some((team) => team.team_id === selected.team_id) ? [selected, ...teams] : teams;
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

function formatScheduleTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    weekday: "short",
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

function BattlecardSignalList({ items, emptyLabel }: { items: BattlecardSignal[]; emptyLabel: string }) {
  if (!items.length) return <p className="battlecard-empty">{emptyLabel}</p>;
  return <div className="battlecard-signal-list">{items.slice(0, 2).map((item) => <article key={`${item.champion_id}:${item.role ?? "UNKNOWN"}`}>
    <img src={championImageUrl(item.champion_id)} alt="" loading="lazy" />
    <div><strong>{item.champion_id}</strong><span>{item.role ? roleLabels[item.role] ?? item.role : "역할 미상"} · 근거 {item.evidence_ids.length}건</span><small>{item.observation}</small></div>
    <p>{item.staff_question}</p>
  </article>)}</div>;
}

export function RadarDashboard() {
  const [report, setReport] = useState<RadarReport>(sampleReport);
  const [selectedKey, setSelectedKey] = useState(keyOf(sampleReport.entries[0]));
  const [role, setRole] = useState("ALL");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [myTeamId, setMyTeamId] = useState("");
  const [myTeamSearch, setMyTeamSearch] = useState("");
  const [opponentSearch, setOpponentSearch] = useState("");
  const [schedule, setSchedule] = useState<ScheduleSnapshot | null>(null);
  const [scheduleCheckedAt, setScheduleCheckedAt] = useState<string | null>(null);
  const [scheduleState, setScheduleState] = useState<"connecting" | "connected" | "stale" | "unavailable">("connecting");
  const [opponentId, setOpponentId] = useState(sampleReport.opponent_prep?.teams[0]?.team_id ?? "");
  const [feedState, setFeedState] = useState<FeedState>({
    kind: "connecting",
    label: "FEED CONNECTING",
    detail: "발행 피드를 확인하는 중",
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const emergencyTrigger = useRef<HTMLButtonElement>(null);
  const emergencyDialog = useRef<HTMLElement>(null);
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
  const todayDecisions = teamBrief.slice(0, 3);
  const opponentTeams = useMemo(() => report.opponent_prep?.teams ?? [], [report.opponent_prep?.teams]);
  const effectiveSchedule = scheduleState === "connected" ? schedule : null;
  const teamContext = useMemo(
    () => buildTeamContext(report, myTeamId, effectiveSchedule, scheduleCheckedAt),
    [effectiveSchedule, myTeamId, report, scheduleCheckedAt],
  );
  const selectedMyTeam = teamContext?.my_team;
  const opponentPriorities = useMemo(() => teamContext?.opponent_priorities ?? [], [teamContext]);
  const rankedOpponentTeams = useMemo(() => teamContext
    ? opponentPriorities.map((priority) => priority.team)
    : opponentTeams, [opponentPriorities, opponentTeams, teamContext]);
  const displayedEntries = visibleEntries.slice(0, visibleLimit);
  const selected = visibleEntries.find((entry) => keyOf(entry) === selectedKey) ?? visibleEntries[0] ?? report.entries[0];
  const selectedBrief = teamBrief.find((card) => keyOf(card.entry) === selectedKey) ?? teamBrief[0];
  const selectedOpponent = rankedOpponentTeams.find((team) => team.team_id === opponentId) ?? rankedOpponentTeams[0];
  const myTeamSearchResults = useMemo(() => opponentTeams
    .filter((team) => matchesTeamQuery(team, myTeamSearch))
    .sort((left, right) => left.team_name.localeCompare(right.team_name)), [myTeamSearch, opponentTeams]);
  const myTeamOptions = useMemo(
    () => pinSelectedTeam(myTeamSearchResults, opponentTeams.find((team) => team.team_id === myTeamId)),
    [myTeamId, myTeamSearchResults, opponentTeams],
  );
  const opponentSearchResults = useMemo(
    () => rankedOpponentTeams.filter((team) => matchesTeamQuery(team, opponentSearch)),
    [opponentSearch, rankedOpponentTeams],
  );
  const opponentOptions = useMemo(
    () => pinSelectedTeam(opponentSearchResults, selectedOpponent),
    [opponentSearchResults, selectedOpponent],
  );
  const selectedPriority = opponentPriorities.find((priority) => priority.team.team_id === selectedOpponent?.team_id);
  const emergencyBrief = selectedOpponent ? buildEmergencyBrief(report, selectedOpponent, selectedMyTeam, effectiveSchedule, scheduleCheckedAt) : null;
  const matchupBattlecard = useMemo(() => (
    selectedMyTeam && selectedOpponent && selectedMyTeam.team_id !== selectedOpponent.team_id
      ? buildMatchupBattlecard(report, selectedMyTeam, selectedOpponent, selectedPriority)
      : null
  ), [report, selectedMyTeam, selectedOpponent, selectedPriority]);
  const nextOwnEvent = teamContext?.own_upcoming_events[0];
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
      let publishedReport = parsed;
      try {
        const statusUrl = new URL("feed/history-status.json", document.baseURI);
        const statusResponse = await fetch(statusUrl, { cache: "no-store" });
        if (statusResponse.ok) {
          const status: unknown = await statusResponse.json();
          if (isHistoryStatus(status)) publishedReport = { ...parsed, history_status: status };
        }
      } catch {
        // The Radar remains usable when the independently published status is unavailable.
      }
      try {
        const scheduleUrl = new URL("feed/schedule.json", document.baseURI);
        const scheduleResponse = await fetch(scheduleUrl, { cache: "no-store" });
        if (!scheduleResponse.ok) throw new Error(`schedule returned ${scheduleResponse.status}`);
        const schedulePayload: unknown = await scheduleResponse.json();
        if (!isScheduleSnapshot(schedulePayload)) throw new Error("unsupported schedule");
        const checkedAt = new Date().toISOString();
        const ageHours = (Date.parse(checkedAt) - Date.parse(schedulePayload.retrieved_at)) / (60 * 60 * 1000);
        setSchedule(schedulePayload);
        setScheduleCheckedAt(checkedAt);
        setScheduleState(ageHours <= 36 ? "connected" : "stale");
      } catch {
        setSchedule(null);
        setScheduleCheckedAt(null);
        setScheduleState("unavailable");
      }
      setReport(publishedReport);
      setSelectedKey(publishedReport.entries[0] ? keyOf(publishedReport.entries[0]) : "");
      setRole("ALL");
      setEligibleOnly(false);
      setVisibleLimit(12);
      setOpponentId(publishedReport.opponent_prep?.teams[0]?.team_id ?? "");
      setFeedState({
        kind: publishedReport.fixture_only ? "demo" : "published",
        label: publishedReport.fixture_only ? "PUBLISHED DEMO FEED" : "LIVE PUBLISHED FEED",
        detail: publishedReport.fixture_only ? "자동 연결됨 · 합성 데이터" : "자동 연결됨 · 검증된 발행본",
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
    const storedTeamId = window.localStorage.getItem(MY_TEAM_STORAGE_KEY);
    const restore = window.setTimeout(() => {
      if (storedTeamId) setMyTeamId(storedTeamId);
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (!evidenceOpen && !emergencyOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEvidenceOpen(false);
        setEmergencyOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [emergencyOpen, evidenceOpen]);

  useEffect(() => {
    if (!emergencyOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = emergencyTrigger.current;
    document.body.style.overflow = "hidden";
    emergencyDialog.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [emergencyOpen]);

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

  function selectMyTeam(teamId: string) {
    setMyTeamId(teamId);
    setOpponentId("");
    setMyTeamSearch("");
    setOpponentSearch("");
    if (teamId) window.localStorage.setItem(MY_TEAM_STORAGE_KEY, teamId);
    else window.localStorage.removeItem(MY_TEAM_STORAGE_KEY);
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
      schedule_source: schedule ? {
        source_id: schedule.source_id,
        source_url: schedule.source_url,
        retrieved_at: schedule.retrieved_at,
        content_hash: schedule.content_hash,
      } : null,
      perspective_team: selectedMyTeam ?? null,
      priority_context: selectedPriority ?? null,
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

  function downloadEmergencyBrief() {
    if (!emergencyBrief) return;
    const blob = new Blob([JSON.stringify(emergencyBrief, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `match-day-brief-${emergencyBrief.opponent.team_name.replace(/[^A-Za-z0-9가-힣_-]+/g, "-")}-${report.patch_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMatchupBattlecard() {
    if (!matchupBattlecard) return;
    const blob = new Blob([JSON.stringify(matchupBattlecard, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-battlecard-${matchupBattlecard.own_team.team_name.replace(/[^A-Za-z0-9가-힣_-]+/g, "-")}-vs-${matchupBattlecard.opponent.team_name.replace(/[^A-Za-z0-9가-힣_-]+/g, "-")}-${report.patch_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printEmergencyBrief() {
    document.body.classList.add("print-emergency");
    window.print();
    window.setTimeout(() => document.body.classList.remove("print-emergency"), 0);
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
          <a className="active" href="#team-brief">오늘 결정</a>
          <a href="#opponent-prep">상대전</a>
          <a href="#creator-export">콘텐츠</a>
          <a href="#radar">전체 탐색</a>
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

      <section className="decision-hero" id="top">
        <div className="decision-hero-copy">
          <div className="kicker-row"><p className="eyebrow">PATCH {report.patch_id} · TEAM MODE</p><span>{feedState.detail}</span></div>
          <h1>오늘 팀이<br /><em>결정할 3가지.</em></h1>
          <p className="lede">티어표가 아니라 회의 시작점입니다. 지금 테스트할 후보, 더 지켜볼 후보, 보류할 근거를 공개 경기 데이터로 압축했습니다.</p>
          <div className="decision-hero-actions">
            <a href="#team-brief">3분 브리프 보기</a>
            <a href="#opponent-prep">상대팀 준비 자료</a>
          </div>
          <div className="hero-points" aria-label="분석 기준">
            <span>최근 {report.windows.recent.days}일 vs 이전 {report.windows.prior.days}일</span>
            <span>{report.fixture_only ? "예시 데이터" : "검증된 실데이터"}</span>
            <span>{formatCutoff(report.cutoff)} KST</span>
          </div>
        </div>
        <aside className="today-queue" aria-label="오늘의 팀 의사결정 3개">
          <header><div><span>LIVE DECISION QUEUE</span><h2>먼저 볼 후보</h2></div><b>{todayDecisions.length} / 3</b></header>
          {todayDecisions.length > 0 ? <div>{todayDecisions.map((card, index) => <a href="#team-brief" key={keyOf(card.entry)} onClick={() => setSelectedKey(keyOf(card.entry))}>
            <span className="today-rank">{String(index + 1).padStart(2, "0")}</span>
            <img src={championImageUrl(card.entry.champion_id)} alt="" />
            <span className="today-name"><strong>{card.entry.champion_id}</strong><small>{roleLabels[card.entry.role] ?? card.entry.role} · {card.entry.metrics.current_distinct_team_count}팀 채택</small></span>
            <span className="today-signal"><small>수요 변화</small><strong>{points(card.entry.metrics.demand_velocity)}</strong></span>
            <b className={`decision-chip ${card.decision.toLowerCase()}`}>{card.decisionLabel}</b>
          </a>)}</div> : <p className="today-empty">공개 경기 기준을 통과한 검토 후보가 아직 없습니다.</p>}
          <footer><span>후보를 선택하면 찬성·반대 근거와 중단 조건으로 이동합니다.</span><b>근거 우선 · 출전 권고 아님</b></footer>
        </aside>
      </section>

      <section className="summary" aria-label="요약 지표">
        <article><span>검토할 후보</span><strong>{String(eligibleCount).padStart(2, "0")}</strong><small>최소 표본 기준 통과</small></article>
        <article><span>비교 경기 수</span><strong>{String(report.windows.recent.match_count).padStart(2, "0")} <b>/ {String(report.windows.prior.match_count).padStart(2, "0")}</b></strong><small>최근 구간 / 이전 구간</small></article>
        <article><span>활성 팀</span><strong>{String(report.windows.recent.active_team_count).padStart(2, "0")}</strong><small>최근 구간의 고유 팀</small></article>
        <article><span>데이터 품질</span><strong className={`quality ${quality.label === "CHECK" ? "caution" : quality.label === "AUDITED" ? "audited" : ""}`}>{quality.label === "AUDITED" ? "검토 완료" : quality.label === "PASS" ? "통과" : "확인 필요"}</strong><small>제외 {quality.excluded} · 위반 {quality.blocking} · 미등록 {quality.unknown}</small></article>
      </section>

      <section className={`team-lens ${selectedMyTeam ? "active" : "setup"}`} id="team-setup" aria-label="내 팀 분석 기준">
        <div className="team-lens-copy">
          <span>STEP 1 · MY TEAM LENS</span>
          <strong>{selectedMyTeam ? selectedMyTeam.team_name : "소속 팀을 먼저 선택하세요"}</strong>
          <p>{selectedMyTeam ? `${selectedMyTeam.leagues.join(" · ")} · 공개 경기 ${selectedMyTeam.game_count}개를 기준으로 상대 준비 순서를 다시 계산합니다.` : "선택 전에는 글로벌 메타만 표시합니다. 팀 선택값은 이 브라우저에만 저장됩니다."}</p>
          <em className={`schedule-state ${scheduleState}`}>{scheduleState === "connected" ? `공식 일정 연결 · ${schedule?.events.length ?? 0}경기` : scheduleState === "stale" ? "공식 일정 36시간 경과 · 우선순위에서 제외" : scheduleState === "connecting" ? "공식 일정 연결 중" : "공식 일정 미연결 · 분석 점수만 사용"}</em>
        </div>
        <div className="team-picker">
          <label htmlFor="my-team-search">팀명 또는 리그 검색</label>
          <div className="team-picker-fields">
            <input id="my-team-search" type="search" value={myTeamSearch} onChange={(event) => setMyTeamSearch(event.target.value)} placeholder="예: T1, LCK, G2" autoComplete="off" />
            <select id="my-team-select" value={myTeamId} onChange={(event) => selectMyTeam(event.target.value)} aria-label="내 팀 선택">
              <option value="">내 팀 선택</option>
              {myTeamOptions.map((team) => <option key={team.team_id} value={team.team_id}>{team.team_name} · {team.leagues.join("/")} · {team.game_count}G</option>)}
            </select>
          </div>
          <small aria-live="polite">{myTeamSearch ? `${myTeamSearchResults.length}개 검색 결과` : `전체 ${opponentTeams.length}개 팀`}{selectedMyTeam ? ` · 현재 ${selectedMyTeam.team_name}` : ""}</small>
        </div>
        <a href="#opponent-prep">{selectedMyTeam ? "상대 우선순위 보기" : "분석 기준 설정"} <span>→</span></a>
      </section>

      <nav className="decision-flow" aria-label="팀 분석 진행 단계">
        <a className={selectedMyTeam ? "complete" : "active"} href="#team-setup"><b>1</b><span><small>내 팀</small><strong>{selectedMyTeam?.team_name ?? "선택 필요"}</strong></span></a>
        <a className={selectedMyTeam ? "complete" : "locked"} href="#opponent-prep"><b>2</b><span><small>준비할 상대</small><strong>{selectedMyTeam ? selectedOpponent?.team_name ?? "순위 계산 중" : "팀 선택 후 자동 계산"}</strong></span></a>
        <a className={matchupBattlecard ? "ready" : "locked"} href="#draft-battlecard"><b>3</b><span><small>드래프트 배틀카드</small><strong>{matchupBattlecard ? "확인 준비 완료" : "상대 선택 후 생성"}</strong></span></a>
      </nav>

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

      {report.history_status && <details className={`history-readiness ${report.history_status.benchmark_ready ? "ready" : "collecting"}`} aria-label="과거 검증 데이터 준비 상태">
        <summary className="history-summary">
          <div><span>HISTORY · WALK-FORWARD</span><h2>실데이터 검증 준비도</h2></div>
          <p>{report.history_status.benchmark_ready ? "미래 데이터와 분리된 실제 백테스트 결과를 검토할 수 있습니다." : "과거 파일을 오늘 데이터로 재구성하지 않고, 실제 일일 스냅샷이 쌓이기를 기다립니다."}</p>
          <div className="history-summary-action"><b>{historyActionLabels[report.history_status.next_action] ?? report.history_status.next_action}</b><span>{report.history_status.gates.filter((gate) => gate.passed).length}/{report.history_status.gates.length} 충족 · 상세 보기</span></div>
        </summary>
        <div className="history-detail">
          <div className="history-gates">{report.history_status.gates.map((gate) => {
            const progress = gate.required > 0 ? Math.min(100, (gate.current / gate.required) * 100) : 0;
            const unit = historyUnitLabels[gate.unit] ?? gate.unit;
            return <article className={gate.passed ? "passed" : ""} key={gate.id}>
              <span>{historyGateLabels[gate.id] ?? gate.id}</span>
              <strong>{gate.current}<small> / {gate.required}{unit}</small></strong>
              <i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i>
              <em>{gate.passed ? "충족" : "수집 중"}</em>
            </article>;
          })}</div>
          <footer><span>마지막 스냅샷 {report.history_status.as_of ? formatCutoff(report.history_status.as_of) : "아직 없음"}</span><p>준비도는 예측 성능이 아닙니다. Recall@K와 오탐률은 성숙한 미래 결과가 확보된 뒤에만 표시합니다.</p><b>{report.history_status.blocking_reasons.length} GATES OPEN</b></footer>
        </div>
      </details>}

      <section className="opponent-prep" id="opponent-prep">
        <div className="section-heading opponent-heading">
          <div>
            <p className="eyebrow">02 · MY TEAM → OPPONENT PRIORITY</p>
            <h2>내 팀 기준 상대 준비 순서</h2>
            <p className="section-description">공식 대진 일정, 동일 리그, 양 팀의 픽 충돌, 현재 메타와의 겹침, 공개 경기 표본을 합쳐 먼저 볼 상대를 정합니다. 미확정 대진과 스크림은 추정하지 않습니다.</p>
          </div>
          {selectedOpponent && <div className="opponent-controls">
            <div className="opponent-picker">
              <label htmlFor="opponent-search">상대 검색</label>
              <div><input id="opponent-search" type="search" value={opponentSearch} onChange={(event) => setOpponentSearch(event.target.value)} placeholder="팀명 또는 리그" autoComplete="off" /><select value={selectedOpponent.team_id} onChange={(event) => { setOpponentId(event.target.value); setOpponentSearch(""); }} aria-label="준비할 상대 선택">{opponentOptions.map((team) => { const priority = opponentPriorities.find((item) => item.team.team_id === team.team_id); return <option key={team.team_id} value={team.team_id}>{priority ? `${priority.tier} · ${priority.score}점 · ` : ""}{team.team_name} · {team.leagues.join("/")} · {team.game_count}G</option>; })}</select></div>
              <small aria-live="polite">{opponentSearch ? `${opponentSearchResults.length}개 검색 결과` : `${rankedOpponentTeams.length}개 상대 · 우선순위순`}</small>
            </div>
            <button ref={emergencyTrigger} className="emergency-open" type="button" onClick={() => setEmergencyOpen(true)}>3분 브리프</button>
            <button type="button" onClick={downloadOpponentPrep}>선택 팀 JSON</button>
          </div>}
        </div>

        {teamContext ? <div className="team-priority-board">
          <article className="my-team-card">
            <header><div className="team-monogram" aria-hidden="true">{selectedMyTeam?.team_name.slice(0, 2).toUpperCase()}</div><div><span>MY TEAM · ANALYSIS ANCHOR</span><h3>{selectedMyTeam?.team_name}</h3><p>{selectedMyTeam?.leagues.join(" · ")}</p></div></header>
            <div className="my-team-stats"><span><b>{selectedMyTeam?.game_count}</b> 공개 경기</span><span><b>{percent(selectedMyTeam?.first_pick_rate ?? null)}</b> 선픽</span><span><b>{selectedMyTeam?.evidence.draft_event_ids.length}</b> 근거 기록</span></div>
            <div className={`next-fixture ${nextOwnEvent ? "scheduled" : "empty"}`}><span>NEXT OFFICIAL FIXTURE</span>{nextOwnEvent ? <><strong>{nextOwnEvent.participants.map((participant) => participant.code).join(" vs ")}</strong><small>{formatScheduleTime(nextOwnEvent.start_at)} KST · {nextOwnEvent.league} {nextOwnEvent.block} · {nextOwnEvent.best_of ? `Bo${nextOwnEvent.best_of}` : "형식 미정"}</small></> : <><strong>{scheduleState === "connected" ? "확정 상대 일정 없음" : scheduleState === "stale" ? "일정 갱신 필요" : "일정 미연결"}</strong><small>{scheduleState === "connected" ? "TBD가 확정되면 다음 수집에서 자동 반영" : scheduleState === "stale" ? "36시간이 지난 일정은 우선순위에서 제외" : "공개 경기 분석 점수만 유지"}</small></>}</div>
            <div className="my-team-picks"><span>관측된 우선 픽</span><div>{selectedMyTeam?.priority_picks.slice(0, 3).map((pick) => <div key={`${pick.champion_id}:${pick.role}`}><img src={championImageUrl(pick.champion_id)} alt="" /><strong>{pick.champion_id}</strong><small>{roleLabels[pick.role ?? ""] ?? pick.role}</small></div>)}</div></div>
            <p className="team-data-boundary">공개 경기 성향만 사용 · 선수 숙련도와 스크림 미포함</p>
          </article>
          <div className="priority-queue">
            <header><div><span>OPPONENT PRIORITY QUEUE</span><h3>먼저 준비할 상대</h3></div><b>상위 4팀</b></header>
            <div>{opponentPriorities.slice(0, 4).map((priority, index) => {
              const topPick = priority.team.priority_picks[0];
              const active = priority.team.team_id === selectedOpponent?.team_id;
              return <button type="button" className={`${active ? "active" : ""} ${priority.next_meeting ? "scheduled" : ""}`} key={priority.team.team_id} onClick={() => setOpponentId(priority.team.team_id)} aria-pressed={active}>
                <span className={`priority-tier ${priority.tier.toLowerCase()}`}>{priority.tier}</span>
                <span className="priority-order">{String(index + 1).padStart(2, "0")}</span>
                {topPick ? <img src={championImageUrl(topPick.champion_id)} alt="" /> : <span className="priority-placeholder" />}
                <span className="priority-team"><strong>{priority.team.team_name}</strong><small>{priority.reasons.join(" · ")}</small></span>
                <span className="priority-score"><strong>{priority.score}</strong><small>/ 100</small></span>
              </button>;
            })}</div>
            <footer><b>정렬·점수</b><span>확정 대진은 경기 시간순 선배치 · 공식 대진 최대 30 · 동일 리그 30 · 상승 메타 최대 24 · 픽 충돌 최대 18 · 표본 최대 18 · 품질 경고 감점</span></footer>
          </div>
        </div> : <div className="team-priority-setup">
          <span>STEP 01</span><h3>내 팀을 선택하면 상대 우선순위가 열립니다.</h3><p>현재 발행본의 {opponentTeams.length}개 팀 중 소속 팀을 고르면, 자기 팀을 제외한 상대만 공개 근거로 다시 정렬합니다.</p><a href="#top">위에서 내 팀 선택 ↑</a>
        </div>}

        {matchupBattlecard ? <section className="draft-battlecard" id="draft-battlecard" aria-label={`${matchupBattlecard.own_team.team_name} 대 ${matchupBattlecard.opponent.team_name} 드래프트 배틀카드`}>
          <header className="battlecard-head">
            <div>
              <span>DRAFT BATTLECARD · PUBLIC EVIDENCE</span>
              <h3>{matchupBattlecard.own_team.team_name} <em>vs</em> {matchupBattlecard.opponent.team_name}</h3>
              <p>픽·밴을 자동 추천하지 않고, 회의 전에 합의할 보호·충돌·견제·교환 질문만 압축합니다.</p>
            </div>
            <div><b className={`battlecard-quality ${matchupBattlecard.evidence_quality.toLowerCase()}`}>{matchupBattlecard.evidence_quality === "OBSERVED" ? "공개 표본 확인" : matchupBattlecard.evidence_quality === "LOW_SAMPLE" ? "낮은 표본" : "불완전 근거"}</b><button type="button" onClick={downloadMatchupBattlecard}>배틀카드 JSON</button></div>
          </header>

          <div className="battlecard-grid">
            <article className="battlecard-lane protect">
              <header><span>01 · PROTECT</span><h4>보호 자원</h4><b>{matchupBattlecard.protect.length}</b></header>
              <p>우리 우선 픽과 상대의 관측 밴이 겹치는 지점</p>
              <BattlecardSignalList items={matchupBattlecard.protect} emptyLabel="직접 겹치는 공개 밴 기록이 없습니다. 기본 대체 픽만 확인합니다." />
            </article>
            <article className="battlecard-lane contested">
              <header><span>02 · CONTEST</span><h4>픽 충돌</h4><b>{matchupBattlecard.contested.length}</b></header>
              <p>양 팀이 같은 챔피언·역할을 가져간 기록</p>
              <BattlecardSignalList items={matchupBattlecard.contested} emptyLabel="동일 역할의 직접 픽 충돌이 관측되지 않았습니다." />
            </article>
            <article className="battlecard-lane deny">
              <header><span>03 · DENY REVIEW</span><h4>견제 검토</h4><b>{matchupBattlecard.deny_review.length}</b></header>
              <p>상대 선호와 글로벌 레이더를 함께 볼 후보</p>
              <BattlecardSignalList items={matchupBattlecard.deny_review} emptyLabel="검토할 반복 픽 표본이 없습니다. 기본 메타 응답을 유지합니다." />
            </article>
            <article className="battlecard-lane exchange">
              <header><span>04 · EXCHANGE</span><h4>교환 시나리오</h4><b>{matchupBattlecard.exchange ? "1" : "0"}</b></header>
              <p>서로 다른 공개 우선 픽을 열었을 때의 검증 질문</p>
              {matchupBattlecard.exchange ? <div className="battlecard-exchange">
                <div><img src={championImageUrl(matchupBattlecard.exchange.own.champion_id)} alt="" /><span><small>우리 확보</small><strong>{matchupBattlecard.exchange.own.champion_id}</strong></span></div>
                <b aria-hidden="true">⇄</b>
                <div><img src={championImageUrl(matchupBattlecard.exchange.opponent.champion_id)} alt="" /><span><small>상대 허용</small><strong>{matchupBattlecard.exchange.opponent.champion_id}</strong></span></div>
                <p>{matchupBattlecard.exchange.staff_question}</p>
              </div> : <p className="battlecard-empty">비교 가능한 서로 다른 우선 픽 표본이 없습니다.</p>}
            </article>
          </div>

          <footer className="battlecard-boundary">
            <div><b>아직 모르는 것</b><p>{matchupBattlecard.unknowns.join(" · ")}</p></div>
            <span>{matchupBattlecard.evidence.match_ids.length} MATCHES · {matchupBattlecard.evidence.source_versions.length} SOURCES</span>
          </footer>
        </section> : <section className="battlecard-setup" id="draft-battlecard" aria-label="드래프트 배틀카드 설정">
          <div><span>DRAFT BATTLECARD</span><h3>내 팀을 선택하면 상대별 회의 카드가 생성됩니다.</h3><p>보호 자원 · 픽 충돌 · 견제 검토 · 교환 시나리오를 같은 공개 경기 근거에서 비교합니다.</p></div>
          <b>선수 숙련도 · 스크림 · 내부 밴픽 계획은 추정하지 않음</b>
        </section>}

        {selectedOpponent ? <details className="opponent-raw-disclosure">
          <summary className="opponent-detail-label">
            <div><span>{selectedMyTeam ? `${selectedMyTeam.team_name} → ${selectedOpponent.team_name}` : "GLOBAL → OPPONENT"}</span><h3>원본 상대 통계</h3><p>픽·밴·사이드·로테이션 상세는 필요할 때만 펼쳐보세요.</p></div>
            <div className="opponent-priority-status">{selectedPriority?.next_meeting && <span>{formatScheduleTime(selectedPriority.next_meeting.start_at)} KST · {selectedPriority.next_meeting.block}</span>}{selectedPriority && <b className={`priority-tier ${selectedPriority.tier.toLowerCase()}`}>{selectedPriority.tier} · {selectedPriority.score}점</b>}<em>상세 펼치기 ＋</em></div>
          </summary>
          <div className="opponent-pack">
          <header className="opponent-profile">
            <div className="team-monogram" aria-hidden="true">{selectedOpponent.team_name.slice(0, 2).toUpperCase()}</div>
            <div><span>{selectedOpponent.leagues.join(" · ")} · PATCH {report.patch_id}</span><h3>{selectedOpponent.team_name}</h3><p>{selectedPriority ? selectedPriority.reasons.join(" · ") : "글로벌 목록에서 선택"} · {formatCutoff(selectedOpponent.evidence.first_observed_at)}부터 관측</p></div>
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
        </div>
        </details> : <div className="brief-empty">현재 발행본에는 상대팀 드래프트 자료가 없습니다. 다음 검증된 피드부터 표시됩니다.</div>}
      </section>

      <CreatorExportLab report={report} />

      <section className="workspace" id="radar">
        <div className="section-heading">
          <div><p className="eyebrow">04 · 신호 목록</p><h2>전체 메타 신호 탐색</h2><p className="section-description">팀 브리프의 결론을 직접 검증하거나 다른 역할의 후보를 탐색할 때 사용합니다.</p></div>
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
        <div><p className="eyebrow">05 · 레이더 읽는 법</p><h2>점수 하나보다, 네 가지 판단 단서.</h2></div>
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

      <nav className="mobile-taskbar" aria-label="모바일 빠른 이동">
        <a href="#team-brief"><b>01</b><span>오늘</span></a>
        <a href="#opponent-prep"><b>02</b><span>상대전</span></a>
        <a href="#creator-export"><b>03</b><span>콘텐츠</span></a>
        <a href="#radar"><b>04</b><span>탐색</span></a>
      </nav>

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

      {emergencyOpen && emergencyBrief && selectedOpponent && (
        <div className="emergency-backdrop">
          <button className="dialog-dismiss" type="button" onClick={() => setEmergencyOpen(false)} aria-label="매치데이 브리프 닫기" />
          <section ref={emergencyDialog} className="emergency-dialog" role="dialog" aria-modal="true" aria-labelledby="emergency-title" tabIndex={-1}>
            <header className="emergency-dialog-head">
              <div><span>MATCH-DAY · 3 MIN READ</span><h2 id="emergency-title">{selectedMyTeam ? `${selectedMyTeam.team_name} vs ${selectedOpponent.team_name}` : selectedOpponent.team_name} Emergency Brief</h2></div>
              <button type="button" onClick={() => setEmergencyOpen(false)} aria-label="매치데이 브리프 닫기">×</button>
            </header>

            <div className="emergency-paper">
              <section className="emergency-lead">
                <div className="team-monogram" aria-hidden="true">{selectedOpponent.team_name.slice(0, 2).toUpperCase()}</div>
                <div><span>PATCH {emergencyBrief.patch_id} · {selectedOpponent.leagues.join(" / ")}</span><h3>{emergencyBrief.headline}</h3><p>{selectedPriority ? `${selectedPriority.tier} · 우선순위 ${selectedPriority.score}점 · ` : ""}{selectedOpponent.game_count}경기 공개 드래프트 · 컷오프 {formatCutoff(emergencyBrief.cutoff)} KST</p></div>
                <b className={`brief-quality ${emergencyBrief.opponent.evidence_quality.toLowerCase()}`}>{emergencyBrief.opponent.evidence_quality === "USABLE_WITH_LIMITS" ? "제한부 사용" : emergencyBrief.opponent.evidence_quality === "LOW_SAMPLE" ? "저표본" : "근거 누락"}</b>
              </section>

              <div className="emergency-columns">
                <section className="emergency-alerts">
                  <header><span>01</span><h3>즉시 확인할 드래프트 신호</h3></header>
                  <div>{emergencyBrief.alerts.map((alert) => <article key={`${alert.type}:${alert.title}`}><b>{alert.type}</b><div><h4>{alert.title}</h4><p>{alert.detail}</p><small>{alert.evidence_ids.length}개 근거</small></div></article>)}</div>
                </section>

                <section className="emergency-overlaps">
                  <header><span>02</span><h3>상대 선호 × 글로벌 메타</h3></header>
                  <div>{emergencyBrief.meta_overlaps.length ? emergencyBrief.meta_overlaps.map((overlap) => <article key={`${overlap.champion_id}:${overlap.role}`}>
                    <img src={championImageUrl(overlap.champion_id)} alt="" />
                    <div><h4>{overlap.champion_id} · {roleLabels[overlap.role] ?? overlap.role}</h4><p>상대 {percent(overlap.opponent_game_rate)} · 레이더 #{overlap.radar_rank} · 수요 {points(overlap.demand_velocity)}</p></div>
                    <b className={overlap.review_level.toLowerCase()}>{overlap.review_level === "HIGH_REVIEW" ? "우선 확인" : overlap.review_level === "REVIEW" ? "확인" : "맥락만"}</b>
                  </article>) : <p className="emergency-empty">직접 교집합이 없습니다. 상대 선호와 글로벌 상승 신호를 억지로 연결하지 않습니다.</p>}</div>
                </section>
              </div>

              <section className="emergency-questions">
                <header><span>03</span><h3>회의에서 답할 네 가지</h3></header>
                <ol>{emergencyBrief.staff_questions.map((question) => <li key={question}>{question}</li>)}</ol>
              </section>

              <section className="emergency-review-queue">
                <header><span>04</span><div><h3>별도 패치 테스트 큐</h3><p>상대 대응 추천이 아니라 오늘의 글로벌 검토 후보입니다.</p></div></header>
                <div>{emergencyBrief.patch_review_queue.map((candidate) => <article key={`${candidate.champion_id}:${candidate.role}`}>
                  <img src={championImageUrl(candidate.champion_id)} alt="" />
                  <div><span>{candidate.decision}</span><h4>{candidate.champion_id} · {roleLabels[candidate.role] ?? candidate.role}</h4><p>{candidate.practice_question}</p><small>반대 근거: {candidate.counter_evidence}</small></div>
                </article>)}</div>
              </section>

              <section className="emergency-unknowns">
                <header><span>05</span><h3>모르는 것</h3></header>
                <ul>{emergencyBrief.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}</ul>
              </section>

              <div className="emergency-source-line"><b>PUBLIC EVIDENCE ONLY</b><p>{emergencyBrief.boundary}</p><span>{emergencyBrief.evidence.opponent_match_ids.length} MATCHES · {emergencyBrief.evidence.opponent_draft_event_ids.length} EVENTS</span></div>
            </div>

            <div className="emergency-actions"><button type="button" onClick={printEmergencyBrief}>인쇄 / PDF</button><button type="button" onClick={downloadEmergencyBrief}>근거 포함 JSON</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
