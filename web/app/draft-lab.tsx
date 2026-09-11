"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use Riot Data Dragon */

import { useEffect, useMemo, useState } from "react";
import { championAssetId, championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  applyDraftSelection,
  buildDraftAgentFrame,
  isChampionLocked,
  nextDraftTurn,
  serializeDraftScenario,
  STANDARD_DRAFT_SEQUENCE,
  type DraftActionKind,
  type DraftAgentOption,
  type DraftSelection,
  type DraftSide,
} from "./draft-agent";
import { productSpaceHref, type ProductSpace } from "./product-space";
import type { OpponentTeam, RadarReport } from "./radar-types";

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
  nameOf,
}: {
  side: DraftSide;
  team: OpponentTeam | null;
  selections: DraftSelection[];
  active: boolean;
  nameOf: (championId: string) => string;
}) {
  const bans = selectionsFor(selections, side, "BAN");
  const picks = selectionsFor(selections, side, "PICK");
  return <section className={`draft-team-column ${side.toLowerCase()} ${active ? "active" : ""}`} aria-label={`${side} 팀 밴픽`}>
    <header><span>{side} SIDE</span><h2>{team?.team_name ?? "팀 선택"}</h2><small>{team ? `${team.game_count}경기 공개 표본 · ${team.leagues.join("/")}` : "근거 없음"}</small></header>
    <div className="draft-ban-row" aria-label={`${side} 밴`}>
      {Array.from({ length: 5 }, (_, index) => {
        const selection = bans.find((item) => item.slot === index + 1);
        return <div className={selection ? "filled" : ""} key={index} title={selection ? nameOf(selection.champion_id) : `${index + 1}번째 밴`}>
          {selection ? <img src={championImageUrl(selection.champion_id)} alt={nameOf(selection.champion_id)} /> : <span>×</span>}<b>B{index + 1}</b>
        </div>;
      })}
    </div>
    <div className="draft-pick-stack">
      {Array.from({ length: 5 }, (_, index) => {
        const selection = picks.find((item) => item.slot === index + 1);
        return <article className={selection ? "filled" : ""} key={index}>
          <b>{side === "BLUE" ? "B" : "R"}{index + 1}</b>
          {selection ? <><img src={championImageUrl(selection.champion_id)} alt="" /><div><strong>{nameOf(selection.champion_id)}</strong><span>선택 확정 · TURN {selection.turn}</span></div></> : <div><strong>선택 대기</strong><span>{index < 3 ? "1차 픽" : "2차 픽"}</span></div>}
        </article>;
      })}
    </div>
  </section>;
}

export function DraftLab({ currentSpace, report, feedLabel }: DraftLabProps) {
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
  const [query, setQuery] = useState("");
  const [timer, setTimer] = useState(30);
  const [timerRunning, setTimerRunning] = useState(false);
  const blueTeam = teams.find((team) => team.team_id === blueTeamId) ?? null;
  const redTeam = teams.find((team) => team.team_id === redTeamId) ?? null;
  const turn = nextDraftTurn(selections);
  const frame = useMemo(
    () => buildDraftAgentFrame(report, blueTeam, redTeam, selections),
    [blueTeam, redTeam, report, selections],
  );

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
    const nextRed = teams.find((team) => team.team_id !== nextBlue?.team_id) ?? null;
    const restore = window.setTimeout(() => {
      setBlueTeamId(nextBlue?.team_id ?? "");
      setRedTeamId(nextRed?.team_id ?? "");
      setSelections([]);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [blueTeamId, redTeamId, teams]);

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

  function resetDraft() {
    setSelections([]);
    setTimer(30);
    setTimerRunning(false);
  }

  function chooseChampion(championId: string) {
    if (!turn || isChampionLocked(selections, championId)) return;
    setSelections((current) => applyDraftSelection(current, championId));
    setTimer(30);
    setQuery("");
  }

  function changeTeam(side: DraftSide, teamId: string) {
    if (side === "BLUE") {
      setBlueTeamId(teamId);
      if (teamId === redTeamId) setRedTeamId(teams.find((team) => team.team_id !== teamId)?.team_id ?? "");
    } else {
      setRedTeamId(teamId);
      if (teamId === blueTeamId) setBlueTeamId(teams.find((team) => team.team_id !== teamId)?.team_id ?? "");
    }
    resetDraft();
  }

  function swapSides() {
    setBlueTeamId(redTeamId);
    setRedTeamId(blueTeamId);
    resetDraft();
  }

  function undo() {
    setSelections((current) => current.slice(0, -1));
    setTimer(30);
  }

  function downloadScenario() {
    if (!blueTeam || !redTeam) return;
    const blob = new Blob([serializeDraftScenario(report, blueTeam, redTeam, selections)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-scenario-${blueTeam.team_name}-vs-${redTeam.team_name}-${report.patch_id}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const phaseLabel = turn ? `${turn.phase}차 ${turn.kind === "BAN" ? "밴" : "픽"}` : "밴픽 완료";
  return <main className="draft-lab">
    <header className="draft-lab-topbar">
      <a className="brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label="Pro Meta Intelligence 홈"><span className="brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span></a>
      <nav aria-label="Draft Lab 이동"><a href={productSpaceHref(currentSpace, "T1")}>T1 브리프</a><a href={productSpaceHref(currentSpace, "TEAM")}>팀 분석</a><a href={productSpaceHref(currentSpace, "RADAR")}>근거 레이더</a></nav>
      <div><span>{feedLabel}</span><b>PATCH {report.patch_id}</b></div>
    </header>

    <section className="draft-lab-intro">
      <div><span>DRAFT LAB · STANDARD 5 BAN / 5 PICK</span><h1>실전 순서로 돌리는<br /><em>가상 밴픽 에이전트</em></h1><p>챔피언 선택은 사람이 확정하고, 에이전트는 매 턴 공개 경기 근거가 있는 안전안·압박안·실험안을 다시 계산합니다.</p></div>
      <aside><b>규칙 기반 V1</b><span>AI 자동판단 잠금</span><small>승률 예측이 아닌 코칭스태프 검토용 시나리오</small></aside>
    </section>

    <section className="draft-match-setup" aria-label="밴픽 팀 설정">
      <label><span>BLUE TEAM</span><select value={blueTeamId} onChange={(event) => changeTeam("BLUE", event.target.value)}>{teams.map((team) => <option value={team.team_id} key={team.team_id}>{team.team_name} · {team.leagues.join("/")}</option>)}</select></label>
      <button type="button" onClick={swapSides} aria-label="블루와 레드 팀 교체">⇄<small>진영 교체</small></button>
      <label><span>RED TEAM</span><select value={redTeamId} onChange={(event) => changeTeam("RED", event.target.value)}>{teams.map((team) => <option value={team.team_id} key={team.team_id}>{team.team_name} · {team.leagues.join("/")}</option>)}</select></label>
    </section>

    <section className="draft-stage" aria-label="실시간 가상 밴픽">
      <TeamDraftColumn side="BLUE" team={blueTeam} selections={selections} active={turn?.side === "BLUE"} nameOf={nameOf} />
      <section className="draft-control-room">
        <div className={`draft-clock ${timer <= 10 ? "urgent" : ""}`}><span>{`TURN ${Math.min(selections.length + 1, STANDARD_DRAFT_SEQUENCE.length)} / ${STANDARD_DRAFT_SEQUENCE.length}`}</span><strong>{String(timer).padStart(2, "0")}</strong><button type="button" onClick={() => setTimerRunning((running) => !running)} disabled={!turn}>{timerRunning ? "일시정지" : "타이머 시작"}</button></div>
        <div className="draft-current-turn"><span>{phaseLabel}</span><h2>{turn ? `${frame.acting_team_name} · ${turn.side} ${turn.kind}` : "시나리오 완성"}</h2><p>{turn ? `${turn.side === "BLUE" ? "B" : "R"}${turn.slot} ${turn.kind === "BAN" ? "밴할" : "선택할"} 챔피언을 확정하세요.` : "20개 선택을 모두 기록했습니다. JSON으로 내려받아 회의와 사후검증에 사용하세요."}</p></div>
        <div className="draft-actions"><button type="button" onClick={undo} disabled={!selections.length}>한 수 되돌리기</button><button type="button" onClick={resetDraft} disabled={!selections.length}>처음부터</button><button type="button" onClick={downloadScenario} disabled={!selections.length}>시나리오 JSON</button></div>
        <ol className="draft-sequence-mini" aria-label="전체 밴픽 순서">{STANDARD_DRAFT_SEQUENCE.map((item, index) => <li className={index < selections.length ? "done" : index === selections.length ? "current" : ""} key={index}><span>{index + 1}</span><b>{item.side === "BLUE" ? "B" : "R"}{item.kind === "BAN" ? "B" : "P"}{item.slot}</b></li>)}</ol>
      </section>
      <TeamDraftColumn side="RED" team={redTeam} selections={selections} active={turn?.side === "RED"} nameOf={nameOf} />
    </section>

    <section className="draft-agent-panel" aria-labelledby="draft-agent-title">
      <header><div><span>TURN-BY-TURN EVIDENCE AGENT</span><h2 id="draft-agent-title">{turn ? `${frame.acting_team_name}의 다음 ${turn.kind === "BAN" ? "밴" : "픽"} 검토안` : "밴픽 시나리오 완료"}</h2><p>{frame.boundary}</p></div><b>{frame.evidence_match_count} MATCHES</b></header>
      <div className="draft-agent-options">{frame.options.length ? frame.options.map((option) => <button type="button" className={option.lane.toLowerCase()} onClick={() => chooseChampion(option.champion_id)} key={`${option.lane}:${option.champion_id}`}>
        <span>{laneLabels[option.lane]} · {option.confidence === "HIGH" ? "근거 높음" : option.confidence === "MEDIUM" ? "근거 보통" : "낮은 표본"}</span>
        <div><img src={championImageUrl(option.champion_id)} alt="" /><h3>{nameOf(option.champion_id)}</h3><small>{roleLabels[option.role ?? ""] ?? option.role ?? "역할 확인"}</small></div>
        <p>{option.observation}</p><em>{option.question}</em><b>근거 {option.evidence_ids.length}건 · 선택 →</b>
      </button>) : <div className="draft-agent-empty"><b>{frame.status === "COMPLETE" ? "COMPLETE" : "NO GROUNDED OPTION"}</b><p>{frame.status === "COMPLETE" ? "완성된 결과를 저장하고 실제 경기 결과와 비교할 수 있습니다." : "현재 조건에서 공개 근거가 있는 선택지를 만들 수 없습니다. 아래 전체 챔피언 목록에서 사람이 직접 선택하세요."}</p></div>}</div>
    </section>

    <section className="draft-champion-select" aria-labelledby="champion-select-title">
      <header><div><span>MANUAL CHAMPION SELECT</span><h2 id="champion-select-title">전체 챔피언에서 직접 확정</h2><p>추천 밖의 픽도 선택할 수 있습니다. 이미 밴·픽된 챔피언은 다시 고를 수 없습니다.</p></div><label><span className="visually-hidden">챔피언 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="한글 또는 영문 챔피언 검색" /></label></header>
      <div>{championPool.map((championId) => {
        const locked = isChampionLocked(selections, championId);
        return <button type="button" className={locked ? "locked" : ""} disabled={locked || !turn} onClick={() => chooseChampion(championId)} key={championAssetId(championId)} title={locked ? "이미 선택됨" : nameOf(championId)}><img src={championImageUrl(championId)} alt="" /><span>{nameOf(championId)}</span>{locked && <b>LOCK</b>}</button>;
      })}</div>
    </section>

    <footer className="draft-lab-boundary"><b>검증 경계</b><p>이 에이전트는 공개 대회 픽·밴 빈도와 현재 레이더만 사용합니다. 조합 시너지·카운터·패치 강도 모델은 아직 검증되지 않았으므로 자동 승률과 최종 추천을 표시하지 않습니다.</p><a href={productSpaceHref(currentSpace, "PROOF")}>현재 제품 검증 상태 →</a></footer>
  </main>;
}
