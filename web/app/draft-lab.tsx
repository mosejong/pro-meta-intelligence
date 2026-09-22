"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use Riot Data Dragon */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { championAssetId, championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  applyDraftSelection,
  buildDraftAgentFrame,
  completeFearlessGame,
  fearlessLocks,
  previewOpponentPick,
  DRAFT_MODEL_VERSION,
  isChampionLocked,
  nextDraftTurn,
  serializeDraftScenario,
  draftSequence,
  STANDARD_DRAFT_SEQUENCE,
  type DraftActionKind,
  type DraftAgentOption,
  type DraftSelection,
  type DraftSide,
  type DraftGame,
} from "./draft-agent";
import { productSpaceHref, type ProductSpace } from "./product-space";
import { MAX_DRAFT_FILE_BYTES, parseDraftSession, readLocalDraft, writeLocalDraft, type DraftSession } from "./draft-session";
import type { OpponentTeam, RadarReport } from "./radar-types";
import { WorldsPreparationPanel } from "./worlds-preparation-panel";
import { NationalTeamPanel } from "./national-team-panel";
import { TeamChooser } from "./team-chooser";
import "./draft-workspace.css";

type DraftLabProps = {
  currentSpace: ProductSpace;
  report: RadarReport;
  feedLabel: string;
};

const laneLabels: Record<DraftAgentOption["lane"], string> = {
  SAFE: "안전안",
  PRESSURE: "압박안",
  EXPERIMENT: "실험안",
};

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function findT1(teams: OpponentTeam[]) {
  return teams.find((team) => team.team_name.trim().toLocaleUpperCase("en-US") === "T1") ?? null;
}

function selectionsFor(selections: DraftSelection[], side: DraftSide, kind: DraftActionKind) {
  return selections.filter((selection) => selection.side === side && selection.kind === kind).sort((left, right) => left.slot - right.slot);
}

function TeamDraftColumn({
  side,
  team,
  selections,
  active,
  staged,
  nameOf,
}: {
  side: DraftSide;
  team: OpponentTeam | null;
  selections: DraftSelection[];
  active: boolean;
  staged: DraftSelection | null;
  nameOf: (championId: string) => string;
}) {
  const bans = selectionsFor(selections, side, "BAN");
  const picks = selectionsFor(selections, side, "PICK");
  return <section className={`draft-team-column ${side.toLowerCase()} ${active ? "active" : ""}`} aria-label={`${side} 팀 밴픽`}>
    <header><span>{side} SIDE</span><h2>{team?.team_name ?? "팀 선택"}</h2><small>{team ? `${team.game_count}경기 공개 표본 · ${team.leagues.join("/")}` : "근거 없음"}</small></header>
    <div className="draft-ban-row" aria-label={`${side} 밴`}>
      {Array.from({ length: 5 }, (_, index) => {
        const preview = staged?.side === side && staged.kind === "BAN" && staged.slot === index + 1 ? staged : null;
        const selection = bans.find((item) => item.slot === index + 1) ?? preview;
        return <div className={preview ? "staged" : selection ? "filled" : ""} key={index} title={selection ? `${nameOf(selection.champion_id)}${preview ? " · 확정 전" : ""}` : `${index + 1}번째 밴`}>
          {selection ? <img src={championImageUrl(selection.champion_id)} alt={nameOf(selection.champion_id)} /> : <span>×</span>}<b>B{index + 1}</b>
        </div>;
      })}
    </div>
    <div className="draft-pick-stack">
      {Array.from({ length: 5 }, (_, index) => {
        const preview = staged?.side === side && staged.kind === "PICK" && staged.slot === index + 1 ? staged : null;
        const selection = picks.find((item) => item.slot === index + 1) ?? preview;
        return <article className={preview ? "staged" : selection ? "filled" : ""} key={index}>
          <b>{side === "BLUE" ? "B" : "R"}{index + 1}</b>
          {selection ? <><img src={championImageUrl(selection.champion_id)} alt="" /><div><strong>{nameOf(selection.champion_id)}</strong><span>{preview ? "올려놓음 · 확정 전" : `선택 확정 · TURN ${selection.turn}`}</span></div></> : <div><strong>선택 대기</strong><span>{index < 3 ? "1차 픽" : "2차 픽"}</span></div>}
        </article>;
      })}
    </div>
  </section>;
}

export function DraftLab({ currentSpace, report: liveReport, feedLabel }: DraftLabProps) {
  const [seriesReport, setSeriesReport] = useState<RadarReport | null>(null);
  const report = seriesReport ?? liveReport;
  const [games, setGames] = useState<DraftGame[]>([]);
  const previousPicks = useMemo(() => fearlessLocks(games), [games]);
  const { catalog, matches, nameOf } = useChampionNames();
  const teams = useMemo(() => report.opponent_prep?.teams ?? [], [report.opponent_prep?.teams]);
  const t1 = useMemo(() => findT1(teams), [teams]);
  const defaultOpponent = useMemo(() => teams
    .filter((team) => team.team_id !== t1?.team_id)
    .sort((left, right) => (
      Number(Boolean(t1 && right.leagues.some((league) => t1.leagues.includes(league)))) -
      Number(Boolean(t1 && left.leagues.some((league) => t1.leagues.includes(league)))) ||
      right.game_count - left.game_count ||
      left.team_name.localeCompare(right.team_name)
    ))[0] ?? null, [t1, teams]);
  const [blueTeamId, setBlueTeamId] = useState(t1?.team_id ?? teams[0]?.team_id ?? "");
  const [redTeamId, setRedTeamId] = useState(defaultOpponent?.team_id ?? teams[1]?.team_id ?? "");
  const [selections, setSelections] = useState<DraftSelection[]>([]);
  const [firstPickSide, setFirstPickSide] = useState<DraftSide>("BLUE");
  const [query, setQuery] = useState("");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [pendingReset, setPendingReset] = useState<"GAME" | "SERIES" | null>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const [pendingChampion, setPendingChampion] = useState<string | null>(null);
  const [timer, setTimer] = useState(30);
  const [timerRunning, setTimerRunning] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [importing, setImporting] = useState(false);
  const [storageMessage, setStorageMessage] = useState("저장된 시리즈 확인 중…");
  const [importMessage, setImportMessage] = useState("");
  const blueTeam = teams.find((team) => team.team_id === blueTeamId) ?? null;
  const redTeam = teams.find((team) => team.team_id === redTeamId) ?? null;
  const turn = nextDraftTurn(selections, firstPickSide);
  const frame = useMemo(
    () => buildDraftAgentFrame(report, blueTeam, redTeam, selections, previousPicks, firstPickSide),
    [blueTeam, redTeam, report, selections, previousPicks, firstPickSide],
  );
  const preview = useMemo(() => previewOpponentPick(report, blueTeam, redTeam, selections, pendingChampion, previousPicks, 3, firstPickSide),
    [report, blueTeam, redTeam, selections, pendingChampion, previousPicks, firstPickSide]);
  const canSelect = sessionReady && !importing && Boolean(blueTeam && redTeam) && (Boolean(seriesReport) || feedLabel !== "FEED CONNECTING");
  const hasCurrentWork = selections.length > 0 || Boolean(pendingChampion);

  useEffect(() => {
    if (pendingReset) { resetDialog.current?.showModal(); cancelReset.current?.focus(); }
    else resetDialog.current?.close();
  }, [pendingReset]);

  const restoreSession = useCallback((session: DraftSession) => {
    setSeriesReport(session.report);
    setBlueTeamId(session.blueTeamId);
    setRedTeamId(session.redTeamId);
    setGames(session.games);
    setSelections(session.selections);
    setFirstPickSide(session.firstPickSide);
    setPendingChampion(session.stagedChampion);
    setQuery("");
    setTimer(30);
    setTimerRunning(false);
  }, []);

  useEffect(() => {
    let active = true;
    readLocalDraft().then((saved) => {
      if (!active) return;
      if (saved) {
        const result = parseDraftSession(saved);
        if (result.ok) {
          restoreSession(result.session);
          setStorageMessage("저장된 시리즈를 복원했습니다. 타이머는 일시정지 상태입니다.");
        } else setStorageMessage(`기존 기록 복원 실패: ${result.error}`);
      } else setStorageMessage("선택하면 이 기기에 자동 저장됩니다.");
    }).catch(() => {
      if (active) setStorageMessage("기기 저장을 사용할 수 없습니다. JSON으로 저장하세요.");
    }).finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, [restoreSession]);

  useEffect(() => {
    if (!sessionReady || !seriesReport || !blueTeam || !redTeam || importing) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setStorageMessage("기기에 저장 중…");
      writeLocalDraft(serializeDraftScenario(seriesReport, blueTeam, redTeam, selections, games, pendingChampion, firstPickSide))
        .then(() => { if (active) setStorageMessage("이 기기에 저장됨 · 새로고침 후 이어서 분석할 수 있습니다."); })
        .catch(() => { if (active) setStorageMessage("기기 저장에 실패했습니다. JSON으로 저장하세요."); });
    }, 300);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [sessionReady, seriesReport, blueTeam, redTeam, selections, games, pendingChampion, importing, firstPickSide]);

  useEffect(() => {
    if (!timerRunning || !turn || timer <= 0) return;
    const timeout = window.setTimeout(() => setTimer((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [timer, timerRunning, turn]);

  useEffect(() => {
    const validBlue = teams.some((team) => team.team_id === blueTeamId);
    const validRed = teams.some((team) => team.team_id === redTeamId);
    if (validBlue && validRed) return;
    const nextBlue = findT1(teams) ?? teams[0] ?? null;
    const nextRed = defaultOpponent ?? teams.find((team) => team.team_id !== nextBlue?.team_id) ?? null;
    const restore = window.setTimeout(() => {
      setBlueTeamId(nextBlue?.team_id ?? "");
      setRedTeamId(nextRed?.team_id ?? "");
      setSelections([]);
      setPendingChampion(null);
      setTimer(30);
      setTimerRunning(false);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [blueTeamId, redTeamId, teams, defaultOpponent]);

  const championPool = useMemo(() => {
    const champions = new Map<string, string>();
    const add = (championId: string) => {
      const canonical = championAssetId(championId).toLocaleLowerCase("en-US");
      if (!champions.has(canonical)) champions.set(canonical, championId);
    };
    for (const team of teams) {
      [...team.priority_picks, ...team.frequent_bans, ...team.received_bans].forEach((item) => add(item.champion_id));
    }
    report.entries.forEach((entry) => add(entry.champion_id));
    Object.keys(catalog).forEach(add);
    return Array.from(champions.values())
      .filter((championId) => matches(championId, query))
      .sort((left, right) => nameOf(left).localeCompare(nameOf(right), "ko-KR"));
  }, [catalog, matches, nameOf, query, report.entries, teams]);
  const visibleChampions = availableOnly
    ? championPool.filter((championId) => !isChampionLocked(selections, championId, previousPicks))
    : championPool;

  function openPreparation(id: string) {
    const panel = document.getElementById(id);
    if (!(panel instanceof HTMLDetailsElement)) return;
    panel.open = true;
    panel.querySelector("summary")?.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "start" });
  }

  function resetDraft() {
    setSelections([]);
    setPendingChampion(null);
    setTimer(30);
    setTimerRunning(false);
  }

  function chooseChampion(championId: string) {
    if (!canSelect || !turn || isChampionLocked(selections, championId, previousPicks)) return;
    if (!seriesReport) setSeriesReport(structuredClone(report));
    setPendingChampion(championId);
  }

  function confirmChampion() {
    if (!canSelect || !turn || !pendingChampion || !blueTeam || !redTeam || blueTeam.team_id === redTeam.team_id) return;
    setSelections((current) => applyDraftSelection(current, pendingChampion, previousPicks, firstPickSide));
    setPendingChampion(null);
    setTimer(30);
    setQuery("");
  }

  function changeTeam(side: DraftSide, teamId: string) {
    if (games.length || hasCurrentWork) return;
    if (side === "BLUE") {
      setBlueTeamId(teamId);
      if (teamId === redTeamId) setRedTeamId(teams.find((team) => team.team_id !== teamId)?.team_id ?? "");
    } else {
      setRedTeamId(teamId);
      if (teamId === blueTeamId) setBlueTeamId(teams.find((team) => team.team_id !== teamId)?.team_id ?? "");
    }
    resetDraft();
  }

  function chooseWorldsOpponent(teamId: string) {
    if (!canSelect || !t1 || games.length || selections.length || pendingChampion) return;
    if (!teams.some((team) => team.team_id === teamId) || teamId === t1.team_id) return;
    setBlueTeamId(t1.team_id);
    setRedTeamId(teamId);
    resetDraft();
    document.getElementById("draft-workspace")?.scrollIntoView({ block: "start" });
  }

  function swapSides() {
    if (hasCurrentWork) return;
    setBlueTeamId(redTeamId);
    setRedTeamId(blueTeamId);
    resetDraft();
  }

  function undo() {
    setSelections((current) => current.slice(0, -1));
    setPendingChampion(null);
    setTimer(30);
  }

  function nextGame() {
    if (!blueTeam || !redTeam) return;
    const next = completeFearlessGame(games, { blue_team_id: blueTeamId, red_team_id: redTeamId, selections });
    if (next === games) return;
    setGames(next);
    resetDraft();
  }

  function reopenPreviousGame() {
    const last = games.at(-1);
    if (!last) return;
    setGames(games.slice(0, -1));
    setBlueTeamId(last.blue_team_id);
    setRedTeamId(last.red_team_id);
    resetDraft();
    setSelections(last.selections);
    setFirstPickSide(last.selections[0].side);
  }

  function resetSeries() {
    setGames([]);
    resetDraft();
    // Keep the captured data: starting the same draft again reproduces its output.
  }

  function downloadScenario() {
    if (!blueTeam || !redTeam) return;
    const blob = new Blob([serializeDraftScenario(report, blueTeam, redTeam, selections, games, pendingChampion, firstPickSide)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-scenario-${blueTeam.team_name}-vs-${redTeam.team_name}-${report.patch_id}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importScenario(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    try {
      if (file.size > MAX_DRAFT_FILE_BYTES) {
        setImportMessage("시나리오 파일은 16MB 이하여야 합니다.");
        return;
      }
      const result = parseDraftSession(await file.text());
      if (!result.ok) { setImportMessage(`${result.error} 현재 작업은 유지했습니다.`); return; }
      restoreSession(result.session);
      setImportMessage("시리즈와 고정 데이터를 불러왔습니다. 확정 전 선택도 복원했습니다.");
    } catch { setImportMessage("파일을 읽을 수 없습니다. 현재 작업은 유지했습니다."); }
    finally { input.value = ""; setImporting(false); }
  }

  const phaseLabel = turn ? `${turn.phase}차 ${turn.kind === "BAN" ? "밴" : "픽"}` : "밴픽 완료";
  const staged = turn && pendingChampion ? { ...turn, turn: selections.length + 1, champion_id: pendingChampion } : null;
  return <main className="draft-lab">
    <header className="draft-lab-topbar">
      <a className="brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label="Pro Meta Intelligence 홈"><span className="brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span></a>
      <nav aria-label="Draft Lab 이동"><a href={productSpaceHref(currentSpace, "T1")}>T1 브리프</a><a href={productSpaceHref(currentSpace, "TEAM")}>팀 분석</a><a href={productSpaceHref(currentSpace, "RADAR")}>근거 레이더</a></nav>
      <div><span>{seriesReport ? report.fixture_only ? "고정 예제 데이터" : "고정된 분석 데이터" : feedLabel}</span><b>PATCH {report.patch_id}</b></div>
    </header>

    <section className="draft-lab-intro draft-lab-intro-compact">
      <div><span>DRAFT LAB · STANDARD 5 BAN / 5 PICK</span><h1>가상 밴픽 <em>연습실</em></h1><p>올려놓기 → 상대 후보 비교 → 직접 확정. 같은 조건에서는 같은 결과를 보여줍니다.</p></div>
      <aside><b>규칙 기반 분석</b><span>AI 자동판단 잠금</span><small>승률 예측이 아닌 공개 기록 기반 검토</small></aside>
    </section>

    <nav className="draft-workspace-nav" aria-label="밴픽 작업 이동"><a href="#draft-workspace">밴픽 진행</a><button type="button" onClick={() => openPreparation("draft-worlds")}>월즈 상대 준비</button><button type="button" onClick={() => openPreparation("draft-national")}>국가대표 성향 관찰</button><a href={productSpaceHref(currentSpace, "PROOF")}>예측 검증 결과</a></nav>

    <section id="draft-workspace" className="draft-match-setup" aria-label="밴픽 팀 설정" inert={!canSelect}>
      <TeamChooser label="BLUE TEAM" teams={teams} value={blueTeamId} onChange={(id) => changeTeam("BLUE", id)} disabled={games.length > 0 || hasCurrentWork} />
      <button type="button" onClick={swapSides} disabled={hasCurrentWork} aria-label="블루와 레드 팀 교체">⇄<small>진영 교체</small></button>
      <TeamChooser label="RED TEAM" teams={teams} value={redTeamId} onChange={(id) => changeTeam("RED", id)} disabled={games.length > 0 || hasCurrentWork} />
      {(hasCurrentWork || games.length > 0) && <p className="draft-setup-hint">팀은 빈 시리즈에서, 진영은 각 세트 시작 전에 변경할 수 있습니다.</p>}
    </section>

    <section className="draft-series" aria-label="피어리스 시리즈">
      <label className="draft-first-selection">선픽 진영
        <select value={firstPickSide} disabled={!canSelect || selections.length > 0 || Boolean(pendingChampion)} onChange={(event) => {
          const side = event.target.value;
          if (side === "BLUE" || side === "RED") { setFirstPickSide(side); if (!seriesReport) setSeriesReport(structuredClone(report)); }
        }}><option value="BLUE">블루 선픽</option><option value="RED">레드 선픽</option></select>
        <span>진영과 선픽은 별도 선택 · 각 세트 시작 전에 설정</span>
      </label>
      <header><h2>피어리스 · {games.length + 1}세트</h2><span>이전 세트 양 팀 픽 {previousPicks.length}개 자동 잠금 · 일반 밴은 세트마다 초기화</span></header>
      <details className="draft-session-details"><summary>저장·불러오기 및 시리즈 관리</summary>
      <p>분석 데이터 {seriesReport ? "고정됨" : "첫 선택 시 고정"} · 패치 {report.patch_id} · 기준 {report.cutoff} · {DRAFT_MODEL_VERSION}</p>
      <div className="draft-session-controls"><label>시나리오 불러오기<input type="file" accept=".json,application/json" disabled={!sessionReady || importing} onChange={(event) => void importScenario(event.currentTarget)} /></label><button type="button" onClick={downloadScenario} disabled={!canSelect}>시리즈 JSON 저장</button></div>
      <p role="status">{storageMessage}</p>
      {importMessage && <p role="status">{importMessage}</p>}
      <div className="draft-series-actions" inert={!sessionReady || importing}><button type="button" onClick={reopenPreviousGame} disabled={!games.length || hasCurrentWork}>이전 세트 수정</button><button type="button" onClick={() => setPendingReset("SERIES")} disabled={!games.length && !hasCurrentWork}>시리즈 초기화</button></div>
      </details>
      {games.map((game, index) => <details key={index}><summary>{index + 1}세트 픽 · 다음 세트 사용 불가</summary><div className="draft-series-locks">{game.selections.filter((selection) => selection.kind === "PICK").map((selection) => <span key={selection.champion_id}><img src={championImageUrl(selection.champion_id)} alt="" />{nameOf(selection.champion_id)}</span>)}</div></details>)}
    </section>

    <section className="draft-stage" aria-label="실시간 가상 밴픽" inert={!canSelect}>
      <TeamDraftColumn side="BLUE" team={blueTeam} selections={selections} staged={staged} active={turn?.side === "BLUE"} nameOf={nameOf} />
      <section className="draft-control-room">
        <div className={`draft-clock ${timer <= 10 ? "urgent" : ""}`}><span>{`TURN ${Math.min(selections.length + 1, STANDARD_DRAFT_SEQUENCE.length)} / ${STANDARD_DRAFT_SEQUENCE.length}`}</span><strong>{String(timer).padStart(2, "0")}</strong><button type="button" onClick={() => setTimerRunning((running) => !running)} disabled={!turn}>{timerRunning ? "일시정지" : "타이머 시작"}</button></div>
        <div className={`draft-current-turn ${turn?.side.toLowerCase() ?? "complete"}`} role="status"><span>{phaseLabel}</span><h2>{turn ? `${frame.acting_team_name} · ${turn.side === "BLUE" ? "블루" : "레드"} 차례` : "시나리오 완성"}</h2><p>{turn ? `${turn.slot}번째 ${turn.kind === "BAN" ? "밴" : "픽"} · 챔피언을 올려놓으면 상대 후보를 비교할 수 있습니다.` : "양 팀의 픽 10개가 다음 세트부터 자동으로 잠깁니다."}</p>{!turn && <button type="button" onClick={nextGame}>세트 저장하고 다음 세트</button>}</div>
        <progress className="draft-turn-progress" value={selections.length} max={20} aria-label={`밴픽 ${selections.length}/20 확정`} />
        <section className="draft-picker" aria-label="챔피언 선택판">
          <div className="draft-catalog">
          <label htmlFor="draft-search">챔피언 검색</label>
          <div className="draft-search-field"><input id="draft-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="한글 또는 영문 이름" /><button type="button" disabled={!query} onClick={() => setQuery("")} aria-label="챔피언 검색 지우기">지우기</button></div>
          <div className="draft-picker-filter"><label><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />선택 가능한 챔피언만</label><span role="status">{visibleChampions.length}개</span></div>
          <div className="draft-picker-grid">{visibleChampions.map((championId) => {
            const fearless = isChampionLocked([], championId, previousPicks);
            const locked = isChampionLocked(selections, championId, previousPicks);
            return <button type="button" aria-pressed={pendingChampion === championId} disabled={locked || !turn} onClick={() => chooseChampion(championId)} key={championAssetId(championId)} title={fearless ? `${nameOf(championId)} · 이전 세트 픽` : locked ? `${nameOf(championId)} · 이미 선택됨` : nameOf(championId)}><img src={championImageUrl(championId)} alt="" loading="lazy" /><span>{nameOf(championId)}</span>{locked && <b>{fearless ? "피어리스" : "LOCK"}</b>}</button>;
          })}</div>
          {!visibleChampions.length && <p className="draft-search-empty" role="status">{championPool.length ? "검색된 챔피언이 모두 잠겨 있습니다. 필터를 해제하면 잠금 사유를 볼 수 있습니다." : "검색 결과가 없습니다. 한글 또는 영문 이름을 다시 확인하세요."}</p>}
          </div>
          <section id="draft-preview" className="draft-response-preview" aria-label="확정 전 상대 픽 예상" aria-live="polite">
            <h3>{pendingChampion ? `${nameOf(pendingChampion)} ${turn?.kind === "BAN" ? "밴" : "픽"}을 확정한다면` : "챔피언을 올려놓고 상대 픽을 비교하세요"}</h3>
            {preview.status === "READY" ? <>
              <p>{preview.team_name}의 다음 픽 예상 후보 · TURN {preview.target_turn}</p>
              <small>{preview.intervening_turns > 0 ? `사이에 남은 ${preview.intervening_turns}개 밴·픽은 미정입니다. 현재 사용 가능한 후보를 비교합니다.` : "바로 다음 상대 픽 차례입니다."} 공개 빈도 순위이며 픽 확률이나 카운터 예측은 아닙니다.</small>
              <ol>{preview.candidates.map((candidate) => <li key={candidate.champion_id}><img src={championImageUrl(candidate.champion_id)} alt="" /><div><strong>{nameOf(candidate.champion_id)}</strong><p>{candidate.observation}</p><small>{candidate.confidence === "LOW" ? "낮은 표본" : "팀 공개 근거 있음"} · {candidate.evidence_team_name} 근거 {candidate.team_evidence_ids.length}건 · 글로벌 근거 {candidate.global_evidence_ids.length}건</small><details><summary>근거 기록 보기</summary><p>팀 기록: {candidate.team_evidence_ids.join(", ") || "없음"}</p><p>글로벌 기록: {candidate.global_evidence_ids.join(", ") || "없음"}</p></details></div></li>)}</ol>
              {!preview.candidates.length && <p>현재 남은 챔피언 중 공개 근거가 있는 상대 픽 후보가 없습니다.</p>}
            </> : preview.status === "NO_FUTURE_PICK" ? <p>이번 선택 이후 상대의 픽 차례는 남아 있지 않습니다.</p> : <p>선택만으로 확정되지 않습니다. 후보를 바꿔 비교한 뒤 확정 버튼을 누르세요.</p>}
          </section>
          <div className="draft-lock-in" aria-live="polite">
            <div>{pendingChampion && <img src={championImageUrl(pendingChampion)} alt="" />}<span><small>{pendingChampion ? "올려놓음 · 아직 확정 전" : "선택 → 비교 → 확정"}</small>{pendingChampion ? nameOf(pendingChampion) : turn ? "챔피언을 선택하세요" : "밴픽 완료"}</span></div>
            {pendingChampion && <button className="draft-cancel-stage" type="button" onClick={() => setPendingChampion(null)}>선택 취소</button>}
            <button type="button" onClick={confirmChampion} disabled={!turn || !pendingChampion || !blueTeam || !redTeam}>{turn?.kind === "BAN" ? "밴 확정" : "픽 확정"}</button>
          </div>
        </section>
        <div className="draft-actions"><button type="button" onClick={undo} disabled={!selections.length}>한 수 되돌리기</button><button type="button" onClick={() => setPendingReset("GAME")} disabled={!hasCurrentWork}>현재 세트 초기화</button><button type="button" onClick={downloadScenario} disabled={!selections.length && !games.length}>시나리오 JSON</button></div>
        <ol className="draft-sequence-mini" aria-label="전체 밴픽 순서">{draftSequence(firstPickSide).map((item, index) => <li className={index < selections.length ? "done" : index === selections.length ? "current" : ""} key={index}><span>{index + 1}</span><b>{item.side === "BLUE" ? "B" : "R"}{item.kind === "BAN" ? "B" : "P"}{item.slot}</b></li>)}</ol>
      </section>
      <TeamDraftColumn side="RED" team={redTeam} selections={selections} staged={staged} active={turn?.side === "RED"} nameOf={nameOf} />
    </section>

    <section className="draft-agent-panel" aria-labelledby="draft-agent-title" inert={!canSelect}>
      <header><div><span>TURN-BY-TURN EVIDENCE AGENT</span><h2 id="draft-agent-title">{turn ? `${frame.acting_team_name}의 다음 ${turn.kind === "BAN" ? "밴" : "픽"} 검토안` : "밴픽 시나리오 완료"}</h2><p>{frame.boundary}</p></div><b>{frame.evidence_match_count} MATCHES</b></header>
      <div className="draft-agent-options">{frame.options.length ? frame.options.map((option) => <button type="button" className={option.lane.toLowerCase()} onClick={() => { chooseChampion(option.champion_id); document.getElementById("draft-preview")?.scrollIntoView({ block: "center" }); }} key={`${option.lane}:${option.champion_id}`}>
        <span>{laneLabels[option.lane]} · {option.confidence === "HIGH" ? "근거 높음" : option.confidence === "MEDIUM" ? "근거 보통" : "낮은 표본"}</span>
        <div><img src={championImageUrl(option.champion_id)} alt="" /><h3>{nameOf(option.champion_id)}</h3><small>{roleLabels[option.role ?? ""] ?? option.role ?? "역할 확인"}</small></div>
        <p>{option.observation}</p><em>{option.question}</em><b>{option.evidence_team_name} 근거 {option.team_evidence_ids.length}건 · 글로벌 {option.global_evidence_ids.length}건 · 올려놓기 →</b>
      </button>) : <div className="draft-agent-empty"><b>{frame.status === "COMPLETE" ? "COMPLETE" : "NO GROUNDED OPTION"}</b><p>{frame.status === "COMPLETE" ? "완성된 결과를 저장하고 실제 경기 결과와 비교할 수 있습니다." : "현재 조건에서 공개 근거가 있는 선택지를 만들 수 없습니다. 아래 전체 챔피언 목록에서 사람이 직접 선택하세요."}</p></div>}</div>
    </section>

    <div className="draft-preparation-library">
      <WorldsPreparationPanel report={report} nameOf={nameOf} onChooseOpponent={chooseWorldsOpponent} previousPicks={previousPicks} canChangeMatchup={canSelect && games.length === 0 && !hasCurrentWork} />
      <NationalTeamPanel report={liveReport} nameOf={nameOf} />
      <a href="#draft-workspace">밴픽으로 돌아가기 ↑</a>
    </div>
    <dialog ref={resetDialog} className="draft-reset-dialog" aria-labelledby="draft-reset-title" aria-describedby="draft-reset-description" onCancel={() => setPendingReset(null)}>
      <h2 id="draft-reset-title">{pendingReset === "SERIES" ? "시리즈 전체를 초기화할까요?" : "현재 세트를 초기화할까요?"}</h2>
      <p id="draft-reset-description">{pendingReset === "SERIES" ? "이전 세트와 현재 선택이 모두 삭제됩니다." : "현재 세트의 밴·픽과 올려놓은 선택이 삭제됩니다. 이전 세트는 유지됩니다."} 이 작업은 되돌릴 수 없습니다.</p>
      <div><button ref={cancelReset} type="button" onClick={() => setPendingReset(null)}>계속 분석하기</button><button type="button" onClick={() => { if (pendingReset === "SERIES") resetSeries(); else if (pendingReset === "GAME") resetDraft(); setPendingReset(null); }}>초기화</button></div>
    </dialog>
    <footer className="draft-lab-boundary"><b>검증 경계</b><p>이 에이전트는 공개 대회 픽·밴 빈도와 현재 레이더만 사용합니다. 조합 시너지·카운터·패치 강도 모델은 아직 검증되지 않았으므로 자동 승률과 최종 추천을 표시하지 않습니다.</p><a href={productSpaceHref(currentSpace, "PROOF")}>현재 제품 검증 상태 →</a></footer>
  </main>;
}
