"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { DraftGame, DraftSelection, DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import { captureRoster, type LiveRoster, type RosterSlotRecord } from "./roster-comparison";
import { basisKey, rosterBasis, ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import {
  buildSimulationReadiness,
  championKey,
  emptyChampionRoles,
  replayManagerScenarioFile,
  sameSimulationInput,
  serializeManagerScenario,
  teamPicks,
  type ChampionRoles,
  type SimulationInputSnapshot,
} from "./simulation-scenario";
import { SimulationPlayerEvidence } from "./simulation-player-evidence-panel";
import "./simulation-readiness-panel.css";

type SimulationReadinessPanelProps = {
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  selections: DraftSelection[];
  games: DraftGame[];
  firstPickSide: DraftSide;
  /** Live roster from the roster editor; null while it restores (never filled with defaults here). */
  roster: LiveRoster | null;
  nameOf: (championId: string) => string;
  /** Publication root relative to the page (e.g. "./" or "../") for the optional season file. */
  publicationRoot?: string;
  disabled?: boolean;
  /** Dedicated workspace panels need no second expansion click. */
  defaultOpen?: boolean;
};

const roleLabels: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const sideLabel = (side: DraftSide) => side === "BLUE" ? "블루" : "레드";
const SIDES = ["BLUE", "RED"] as const;

/** Role edits remember the exact draft context they were made for; a different context starts empty. */
type RoleDraft = Record<string, { context: string; roles: ChampionRoles }>;

function playerLabel(slot: RosterSlotRecord | null | undefined, teamId: string) {
  if (!slot) return "선수 빈칸";
  return slot.source_team_id === teamId ? slot.player_name : `${slot.player_name} (${slot.source_team_name} 관측 · 가상 변경)`;
}

/** Read-only role table of a fixed (or replayed) input. */
function FixedInputView({ snapshot, nameOf }: { snapshot: SimulationInputSnapshot; nameOf: (id: string) => string }) {
  const { draft } = snapshot;
  return <div className="simulation-readiness-fixed">
    <p>블루 {draft.teams.BLUE.name} · 레드 {draft.teams.RED.name} · 선픽 {sideLabel(draft.firstPickSide)} · {draft.games.length + 1}세트 · 패치 {snapshot.patch} · 기준 {snapshot.cutoff}</p>
    <div className="simulation-readiness-teams">{SIDES.map((side) => {
      const team = draft.teams[side];
      return <table key={side} className={side.toLowerCase()}>
        <caption>{sideLabel(side)} {team.name}</caption>
        <thead><tr><th scope="col">역할</th><th scope="col">챔피언</th><th scope="col">선수</th></tr></thead>
        <tbody>{ROSTER_ROLES.map((role) => <tr key={role}>
          <th scope="row">{roleLabels[role]}</th>
          <td>{nameOf(snapshot.roles[team.id][role])}</td>
          <td>{playerLabel(draft.roster.teams[team.id][role], team.id)}</td>
        </tr>)}</tbody>
      </table>;
    })}</div>
  </div>;
}

/**
 * Korean-only input gate before any simulation. Collapsed by default under the comparison panel.
 * Roles are user-assigned per team ID and re-validated against the current picks on every render;
 * the fixed input lives in memory only. Replaying a file is display-only: it never changes the
 * draft, rosters, the A/B baseline or device storage. No outcome or winner is computed here.
 */
export function SimulationReadinessPanel({ report, blueTeam, redTeam, selections, games, firstPickSide, roster, nameOf, publicationRoot = "./", disabled = false, defaultOpen = false }: SimulationReadinessPanelProps) {
  const [roleDraft, setRoleDraft] = useState<RoleDraft>({});
  const [open, setOpen] = useState(defaultOpen);
  const [fixed, setFixed] = useState<SimulationInputSnapshot | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [replay, setReplay] = useState<{ fileName: string; snapshot: SimulationInputSnapshot } | null>(null);
  const [replayMessage, setReplayMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const readToken = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Late file reads after unmount (import/restore remounts this panel) are dropped.
  useEffect(() => {
    const tokens = readToken;
    return () => { tokens.current += 1; };
  }, []);

  const complete = selections.length === 20 && Boolean(blueTeam && redTeam);
  const reportBasis = useMemo(() => rosterBasis(report), [report]);
  const basis = useMemo(() => basisKey(reportBasis), [reportBasis]);
  const contexts = useMemo(() => {
    const result: Record<string, string> = {};
    if (!blueTeam || !redTeam) return result;
    for (const [side, team] of [["BLUE", blueTeam], ["RED", redTeam]] as const) {
      result[team.team_id] = JSON.stringify([basis, [blueTeam.team_id, redTeam.team_id], side, firstPickSide,
        games.length, teamPicks(selections, side).map(championKey)]);
    }
    return result;
  }, [basis, blueTeam, redTeam, firstPickSide, games.length, selections]);
  const rolesOf = (teamId: string): ChampionRoles => {
    const entry = roleDraft[teamId];
    return entry && entry.context === contexts[teamId] ? entry.roles : emptyChampionRoles();
  };
  const currentRoles = blueTeam && redTeam ? { [blueTeam.team_id]: rolesOf(blueTeam.team_id), [redTeam.team_id]: rolesOf(redTeam.team_id) } : {};
  const rolesKey = JSON.stringify(currentRoles);

  const readiness = useMemo(
    () => buildSimulationReadiness({ report, blueTeam, redTeam, selections, games, firstPickSide, roster, roles: JSON.parse(rolesKey) }),
    [report, blueTeam, redTeam, selections, games, firstPickSide, roster, rolesKey],
  );
  const capture = useMemo(() => {
    if (!complete || !roster || !blueTeam || !redTeam) return null;
    const result = captureRoster(report, [blueTeam.team_id, redTeam.team_id], roster.basis, roster.rosters);
    return result.ok ? result.capture : null;
  }, [complete, roster, report, blueTeam, redTeam]);

  function assign(teamId: string, role: RosterRole, championId: string) {
    const context = contexts[teamId];
    if (!context || disabled) return;
    setRoleDraft((current) => {
      const roles = { ...(current[teamId]?.context === context ? current[teamId].roles : emptyChampionRoles()) };
      // One champion per team occupies one role: choosing it again moves it here.
      if (championId) for (const other of ROSTER_ROLES) if (other !== role && roles[other] && championKey(roles[other]!) === championKey(championId)) roles[other] = null;
      roles[role] = championId || null;
      return { ...current, [teamId]: { context, roles } };
    });
  }

  function fix() {
    if (!readiness.ok) return;
    setFixed(readiness.snapshot);
    setExportMessage("");
  }

  function download() {
    if (!fixed) return;
    const result = serializeManagerScenario(report, fixed);
    if (!result.ok) { setExportMessage(result.message); return; }
    const url = URL.createObjectURL(new Blob([result.text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `manager-scenario-${fixed.draft.teams.BLUE.name}-vs-${fixed.draft.teams.RED.name}-${fixed.patch}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
    setExportMessage(`입력 JSON을 저장했습니다 (${Math.ceil(result.bytes / 1024)}KB).`);
  }

  async function openReplay(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || reading) return;
    const token = ++readToken.current;
    setReading(true);
    setReplayMessage({ tone: "status", text: "시나리오 파일을 확인하는 중입니다…" });
    const result = await replayManagerScenarioFile(file);
    if (token !== readToken.current) return; // closed, replaced or unmounted meanwhile
    setReading(false);
    if (result.ok) {
      setReplay({ fileName: file.name, snapshot: result.snapshot });
      setReplayMessage({ tone: "status", text: `"${file.name}" 파일의 입력을 다시 검증했고 기록된 준비 결과와 일치합니다. 읽기 전용으로 표시합니다.` });
    } else {
      setReplay(null);
      setReplayMessage({ tone: "alert", text: `"${file.name}" 파일을 재현하지 못했습니다. ${result.message}` });
    }
  }

  function closeReplay() {
    readToken.current += 1;
    setReading(false);
    setReplay(null);
    setReplayMessage(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const fixedSame = fixed && readiness.ok ? sameSimulationInput(fixed, readiness.snapshot) : false;
  const replaySame = replay && readiness.ok ? sameSimulationInput(replay.snapshot, readiness.snapshot) : false;
  const summaryState = fixed ? "입력 고정됨" : readiness.ok ? "준비 가능" : complete ? "역할·로스터 확인 필요" : `미충족 · 밴픽 ${selections.length}/20`;

  return <details className="simulation-readiness" lang="ko" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>시뮬레이션 입력 준비 <small>{summaryState}</small></summary>
    <div className="simulation-readiness-body">
      <p className="simulation-readiness-note" role="note">역할은 사용자 배정입니다. 선수 근거는 현재 관측이며 연간 자료는 포함하지 않습니다. 학습된 선수/챔피언 효과·상성·룬·아이템·실제 승률은 아직 계산하지 않습니다.</p>
      {!complete && <p className="simulation-readiness-pending" role="status">밴픽 20개를 완료하면 각 팀 픽 5개를 역할에 배정할 수 있습니다. 현재 {selections.length}/20개입니다.</p>}
      {complete && blueTeam && redTeam && <div className="simulation-readiness-teams">{SIDES.map((side) => {
        const team = side === "BLUE" ? blueTeam : redTeam;
        const picks = teamPicks(selections, side);
        const roles = rolesOf(team.team_id);
        return <fieldset key={side} className={`simulation-readiness-team ${side.toLowerCase()}`} disabled={disabled}>
          <legend>{sideLabel(side)} {team.team_name} · 이번 세트 픽 5개</legend>
          <ol>{ROSTER_ROLES.map((role) => {
            const value = roles[role] && picks.some((id) => championKey(id) === championKey(roles[role]!)) ? roles[role]! : "";
            return <li key={role} data-role={role}>
              <label><span>{roleLabels[role]}</span>
                <select value={value} onChange={(event) => assign(team.team_id, role, event.target.value)} aria-label={`${sideLabel(side)} ${team.team_name} ${roleLabels[role]} 챔피언`}>
                  <option value="">챔피언 선택</option>
                  {picks.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
                </select>
              </label>
              <small>{capture ? playerLabel(capture.teams[team.team_id]?.[role], team.team_id) : "로스터 확인 중"}</small>
            </li>;
          })}</ol>
        </fieldset>;
      })}</div>}
      {complete && !readiness.ok && <ul className="simulation-readiness-issues" aria-label="준비 미충족 항목">{readiness.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
      {readiness.ok && <p role="status">입력 준비 완료: 두 팀의 역할 10개와 로스터 10명이 현재 밴픽·분석 데이터와 맞습니다.</p>}
      <SimulationPlayerEvidence snapshot={readiness.ok ? readiness.snapshot : null} basis={reportBasis} publicationRoot={publicationRoot} nameOf={nameOf} />
      <div className="simulation-readiness-actions">
        <button type="button" disabled={!readiness.ok || disabled} onClick={fix}>{fixed ? "현재 입력으로 다시 고정" : "준비된 입력 고정"}</button>
        <button type="button" disabled={!fixed} onClick={download}>입력 JSON 저장</button>
        <button type="button" disabled={!fixed} onClick={() => { setFixed(null); setExportMessage(""); }}>고정 해제</button>
      </div>
      {fixed && <section className="simulation-readiness-fixed-section" aria-label="고정한 시뮬레이션 입력">
        <p><b>고정한 입력</b> (이 화면 메모리에만 있으며 자동 저장되지 않습니다) · {fixedSame ? "현재 입력과 같음" : "고정 뒤 현재 입력이 바뀌었습니다"}</p>
        <FixedInputView snapshot={fixed} nameOf={nameOf} />
      </section>}
      {exportMessage && <p role="status">{exportMessage}</p>}
      <section className="simulation-readiness-replay" aria-label="저장한 입력 파일 재현">
        <h3>저장한 입력 파일 재현</h3>
        <p>파일 안의 분석 데이터로 입력을 다시 검증해 읽기 전용으로 보여 줍니다. 진행 중인 밴픽·가상 로스터·기준 A·기기 저장은 바뀌지 않습니다. 16MB 이하만 엽니다.</p>
        <div className="simulation-readiness-actions">
          <label className="simulation-readiness-file"><span>{reading ? "확인 중…" : "입력 JSON 열기"}</span>
            <input ref={fileInput} type="file" accept="application/json,.json" disabled={reading} onChange={(event) => { void openReplay(event); }} />
          </label>
          <button type="button" disabled={!replay && !replayMessage} onClick={closeReplay}>재현 결과 닫기</button>
        </div>
        {replayMessage && <p role={replayMessage.tone}>{replayMessage.text}</p>}
        {replay && <>
          <p className="simulation-readiness-identity" role="status">{replaySame ? "현재 입력과 같음" : readiness.ok ? "현재 입력과 다름" : "현재 입력과 다름 (현재 입력이 아직 준비되지 않았습니다)"}</p>
          <FixedInputView snapshot={replay.snapshot} nameOf={nameOf} />
        </>}
      </section>
    </div>
  </details>;
}

export default SimulationReadinessPanel;
