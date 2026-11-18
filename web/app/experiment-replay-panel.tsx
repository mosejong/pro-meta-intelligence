"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import { sameSimulationInput, type SimulationInputSnapshot } from "./simulation-scenario";
import {
  ASSUMPTION_FIELDS,
  BASE_MINUTE_MS,
  buildExperimentRun,
  CORE_TEAM_IDS,
  DEFAULT_SEED,
  INITIAL_PLAYBACK,
  MAX_MINUTE,
  NEUTRAL_DRAFT,
  playbackReducer,
  replayFrame,
  sourceTeamOrder,
  SPEEDS,
  validateRunInputs,
  type AssumptionDraft,
  type AssumptionField,
  type CoreTeamId,
  type ExperimentRun,
} from "./experiment-replay";
import "./experiment-replay-panel.css";

type ExperimentReplayPanelProps = {
  /** Parent's current validated readiness snapshot (detached), or null when not ready. */
  readyInput: SimulationInputSnapshot | null;
  /** Room, restore, import or data loading: no new run. */
  blocked: boolean;
  nameOf: (championId: string) => string;
};

const fieldLabels: Record<AssumptionField, string> = { lane: "라인", tempo: "운영", teamfight: "한타" };
const roleLabels: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const sideLabel = (side: "BLUE" | "RED") => side === "BLUE" ? "블루" : "레드";
const reasonLabel = { BASE_DESTROYED: "모델 기지 내구도 0", TIME_LIMIT: `${MAX_MINUTE}분 제한 도달 (기지·자원 점수)` } as const;
const draftsEqual = (a: AssumptionDraft, b: Record<AssumptionField, number>) =>
  ASSUMPTION_FIELDS.every((field) => Number(a[field]) === b[field] && a[field].trim() !== "");

/**
 * Assumption experiment on the fixed draft input. Runs the abstract manager model once per explicit
 * click; playback, seek and speed only change what part of the frozen run is shown.
 */
export function ExperimentReplayPanel({ readyInput, blocked, nameOf }: ExperimentReplayPanelProps) {
  const [seedText, setSeedText] = useState(DEFAULT_SEED);
  const [drafts, setDrafts] = useState<Record<string, AssumptionDraft>>({});
  const [run, setRun] = useState<ExperimentRun | null>(null);
  const [runError, setRunError] = useState("");
  const [playback, dispatch] = useReducer(playbackReducer, INITIAL_PLAYBACK);
  const runCounter = useRef(0);

  // Single display timer. Cleared on pause, seek, speed change, new run and unmount.
  useEffect(() => {
    if (!playback.playing || playback.runId === null) return;
    const runId = playback.runId;
    const timer = setTimeout(() => dispatch({ type: "TICK", runId }), BASE_MINUTE_MS / playback.speed);
    return () => clearTimeout(timer);
  }, [playback.playing, playback.cursor, playback.speed, playback.runId]);

  const order = readyInput ? sourceTeamOrder(readyInput) : null;
  const currentDrafts: Record<string, AssumptionDraft> = {};
  if (order) for (const id of order) currentDrafts[id] = Object.hasOwn(drafts, id) ? drafts[id] : { ...NEUTRAL_DRAFT };
  const validation = validateRunInputs(readyInput, seedText, currentDrafts);
  const canRun = Boolean(readyInput) && !blocked && validation.ok;

  const frame = useMemo(() => run ? replayFrame(run, playback.runId === run.runId ? playback.cursor : 0) : null, [run, playback.runId, playback.cursor]);
  const sameInput = run && readyInput ? sameSimulationInput(run.snapshot, readyInput) : false;
  const sameAssumptions = run && sameInput && validation.ok && run.seed === validation.seed &&
    CORE_TEAM_IDS.every((core) => draftsEqual(currentDrafts[run.teams[core].sourceId], run.teams[core].assumptions));

  function edit(teamId: string, field: AssumptionField, value: string) {
    setDrafts((current) => ({ ...current, [teamId]: { ...(current[teamId] ?? NEUTRAL_DRAFT), [field]: value } }));
  }

  function execute() {
    if (!canRun) return;
    const next = buildExperimentRun(runCounter.current + 1, readyInput, seedText, currentDrafts);
    if (!next.ok) { setRunError(next.issues.map((issue) => issue.message).join(" ")); return; }
    runCounter.current = next.run.runId;
    setRunError("");
    setRun(next.run);
    dispatch({ type: "LOAD", runId: next.run.runId, endMinute: next.run.endMinute });
  }

  const issueOf = (teamId: string | undefined, field: string) => validation.ok ? "" :
    validation.issues.filter((issue) => issue.field === field && issue.teamId === teamId).map((issue) => issue.message).join(" ");
  const blockMessage = blocked ? "방 연결·파일 복원·자료 로딩 중에는 새 실행을 할 수 없습니다."
    : !readyInput ? "위 시뮬레이션 입력 준비가 완료되어야 실행할 수 있습니다 (밴픽 20개·로스터 10명·역할 10개)." : "";
  const seedIssue = issueOf(undefined, "seed");
  const teamOf = (core: CoreTeamId) => run!.teams[core];

  return <section className="experiment-replay" lang="ko" aria-labelledby="experiment-replay-title">
    <header>
      <h3 id="experiment-replay-title">고정 밴픽 가정 실험·재생</h3>
      <p className="experiment-replay-boundary" role="note">사용자 가정에 따른 추상 모델 실행입니다. 실제 LoL 승률이나 실제 경기 재현이 아니며, 챔피언·선수·시즌 기록은 모델 계산에 들어가지 않습니다.</p>
    </header>
    <details className="experiment-replay-help">
      <summary>모델 설명</summary>
      <p>각 팀의 라인·운영·한타 가정(-1~1, 기본 0 중립)과 시드로 작성된 규칙(assumption-manager-v1)을 한 번 실행합니다. 계수는 작성자 규칙이며 학습된 효과가 아닙니다. 모델 자원은 실제 경기 골드가 아니고, 오브젝트는 추상 진행 단계입니다. 같은 입력·시드는 항상 같은 결과를 냅니다. 실행은 이 화면 메모리에만 있으며 저장·공유되지 않습니다.</p>
    </details>

    {/* The parser is the single authority; native constraint checks must never silently block a valid run. */}
    <form className="experiment-replay-inputs" noValidate onSubmit={(event) => { event.preventDefault(); execute(); }} aria-label="실험 가정 입력">
      {order && readyInput ? <div className="experiment-replay-teams">{order.map((id) => {
        const side = readyInput.draft.teams.BLUE.id === id ? "BLUE" : "RED";
        const name = readyInput.draft.teams[side].name;
        return <fieldset key={id} className={`experiment-replay-team ${side.toLowerCase()}`}>
          <legend>{name} <small>현재 {sideLabel(side)}</small></legend>
          {ASSUMPTION_FIELDS.map((field) => {
            const issue = issueOf(id, field);
            const inputId = `experiment-${field}-${id}`.replace(/[^A-Za-z0-9_-]/g, "_");
            return <div key={field} className="experiment-replay-field">
              <label htmlFor={inputId}>{fieldLabels[field]}</label>
              <input id={inputId} type="number" inputMode="decimal" min={-1} max={1} step="any" value={currentDrafts[id][field]}
                aria-invalid={issue ? true : undefined} aria-describedby={issue ? `${inputId}-issue` : undefined}
                onChange={(event) => edit(id, field, event.target.value)} />
              {issue && <small id={`${inputId}-issue`} className="experiment-replay-issue">{issue}</small>}
            </div>;
          })}
        </fieldset>;
      })}</div> : null}
      <div className="experiment-replay-run">
        <div className="experiment-replay-field">
          <label htmlFor="experiment-seed">재현 번호 (시드)</label>
          <input id="experiment-seed" type="number" inputMode="numeric" min={0} max={4294967295} step={1} value={seedText}
            aria-invalid={seedIssue ? true : undefined} aria-describedby={`experiment-seed-help${seedIssue ? " experiment-seed-issue" : ""}`}
            onChange={(event) => setSeedText(event.target.value)} />
          <small id="experiment-seed-help">같은 번호와 가정값이면 언제나 같은 흐름이 나옵니다. 번호를 바꾸면 우연 요소만 달라집니다.</small>
          {seedIssue && <small id="experiment-seed-issue" className="experiment-replay-issue">{seedIssue}</small>}
        </div>
        <button type="submit" disabled={!canRun}>{run ? "현재 입력으로 새 실행" : "가정 실험 실행"}</button>
      </div>
      {blockMessage && <p className="experiment-replay-blocked" role="status">{blockMessage}</p>}
      {runError && <p role="alert">{runError}</p>}
    </form>

    {run && frame && <section className="experiment-replay-result" aria-label="가정 실험 재생">
      <div className="experiment-replay-identity" role="status">
        <b>실행 #{run.runId}</b>{" · "}
        {sameInput ? (sameAssumptions ? "현재 밴픽 입력·가정값과 같음" : "현재 밴픽 입력과 같음 · 가정값/시드 입력란은 이 실행과 다름")
          : "기존 실행 · 실행 뒤 현재 밴픽 입력이 바뀌었습니다 (아래는 실행 당시 고정 입력)"}
      </div>
      <details className="experiment-replay-fixed">
        <summary>실행에 고정한 입력 보기</summary>
        <p>실행 당시 블루 {run.snapshot.draft.teams.BLUE.name} · 레드 {run.snapshot.draft.teams.RED.name} · {run.snapshot.draft.games.length + 1}세트 · 패치 {run.snapshot.patch} · 시드 {run.seed}</p>
        <ul>{CORE_TEAM_IDS.map((core) => {
          const team = teamOf(core);
          return <li key={core}><b>{team.name}</b> ({sideLabel(team.sideAtRun)}) 라인 {team.assumptions.lane} · 운영 {team.assumptions.tempo} · 한타 {team.assumptions.teamfight}
            <small>참고 고정 맥락(모델 미사용): {ROSTER_ROLES.map((role) => `${roleLabels[role]} ${nameOf(run.snapshot.roles[team.sourceId][role])}`).join(" · ")}</small></li>;
        })}</ul>
      </details>

      <div className="experiment-replay-controls" role="group" aria-label="재생 조작">
        {playback.playing
          ? <button type="button" onClick={() => dispatch({ type: "PAUSE" })}>일시정지</button>
          : <button type="button" onClick={() => dispatch({ type: "PLAY" })}>{frame.complete ? "처음부터 재생" : "재생"}</button>}
        <button type="button" onClick={() => dispatch({ type: "RESET" })}>처음</button>
        <button type="button" disabled={frame.complete} onClick={() => dispatch({ type: "STEP" })}>한 단계 (+1분)</button>
        <span className="experiment-replay-speed" role="group" aria-label="표시 속도">{SPEEDS.map((speed) =>
          <button key={speed} type="button" aria-pressed={playback.speed === speed} onClick={() => dispatch({ type: "SPEED", speed })}>{speed}x</button>)}
        </span>
      </div>
      <label className="experiment-replay-seek">
        <span>모델 시각 {frame.minute}분 <small>(최대 {MAX_MINUTE}분 척도)</small></span>
        <input type="range" min={0} max={MAX_MINUTE} step={1} value={frame.minute} aria-valuetext={`${frame.minute}분`}
          onChange={(event) => dispatch({ type: "SEEK", minute: Number(event.target.value) })} />
      </label>

      <div className="experiment-replay-states">{CORE_TEAM_IDS.map((core) => {
        const team = teamOf(core);
        const state = frame.states[core];
        return <div key={core} className={`experiment-replay-state ${team.sideAtRun.toLowerCase()}`} data-core={core}>
          <h4>{team.name}</h4>
          <dl>
            <div><dt>모델 자원 <small>(실제 골드 아님)</small></dt><dd data-stat="gold">{state.gold.toLocaleString("ko-KR")}</dd></div>
            <div><dt>모델 킬</dt><dd data-stat="kills">{state.kills}</dd></div>
            <div><dt>추상 오브젝트</dt><dd data-stat="objectives">{state.objectives}</dd></div>
            <div><dt>기지 내구도</dt><dd data-stat="base">{state.base}/100</dd></div>
          </dl>
          <meter min={0} max={100} value={state.base} aria-label={`${team.name} 모델 기지 내구도`} />
        </div>;
      })}</div>

      <ol className="experiment-replay-log" aria-label="지금까지의 모델 사건">{frame.log.length ? frame.log.slice(-8).map((event, index) => {
        const actor = teamOf(event.actor as CoreTeamId).name;
        const text = event.kind === "SKIRMISH" ? `${actor} 교전 우세 (모델 킬 +${event.amount})`
          : event.kind === "OBJECTIVE" ? `${actor} 추상 오브젝트 +1`
          : `${actor} 상대 기지 피해 ${event.amount}`;
        return <li key={`${event.minute}-${event.kind}-${index}`}><span>{event.minute}분</span>{text}</li>;
      }) : <li>아직 교전·오브젝트 사건이 없습니다.</li>}</ol>

      {frame.outcome ? <p className="experiment-replay-outcome" role="status">
        <b>모델 내부 결과:</b> {teamOf(frame.outcome.winner).name} · {frame.outcome.minute}분 · {reasonLabel[frame.outcome.reason]}. 사용자 가정과 작성 규칙의 결과이며 실제 승패·승률 예측이 아닙니다.
      </p> : <p className="experiment-replay-pending">재생이 끝나면 모델 내부 결과를 표시합니다.</p>}
    </section>}
  </section>;
}

export default ExperimentReplayPanel;
