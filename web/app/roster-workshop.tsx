"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import {
  assignSlot,
  basisKey,
  buildRosterIndex,
  MAX_ROSTER_FILE_BYTES,
  observedRosters,
  pairKey,
  parseRosterScenario,
  playerKey,
  rosterBasis,
  ROSTER_ROLES,
  serializeRosterScenario,
  slotStatus,
  type RosterBasis,
  type RosterIndex,
  type RosterPlayer,
  type RosterRole,
  type RosterState,
} from "./roster-scenario";
import { PlayerPoolPanel } from "./player-pool-panel";
import { poolBasis, type PoolBasis, type PoolSelection } from "./player-pool-evidence";
import "./roster-workshop.css";

/** Device copy of the latest edited roster scenario (small, separate from the draft session). */
export const ROSTER_STORAGE_KEY = "pro-meta-roster-scenario-v1";

const roleLabels: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const roleLabel = (role: string) => roleLabels[role] ?? `역할 미확인(${role})`;

type RosterWorkshopProps = {
  report: RadarReport;
  teams: OpponentTeam[];
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  disabled: boolean;
  /** Live draft state, used only for the evidence panel's lock labels. */
  selections?: readonly PoolSelection[];
  previousPicks?: readonly string[];
  focusChampionId?: string | null;
};

const NO_SELECTIONS: readonly PoolSelection[] = [];
const NO_PICKS: readonly string[] = [];

/**
 * Collapsible virtual roster editor next to the team setup. Remounts per snapshot basis and
 * unordered team pair, so a side swap keeps each team's lineup while a new pair starts from
 * its own observations. It never touches the draft, the comparison baseline or analysis.
 */
export function RosterWorkshop({ report, teams, blueTeam, redTeam, disabled, selections = NO_SELECTIONS, previousPicks = NO_PICKS, focusChampionId = null }: RosterWorkshopProps) {
  const basis = useMemo(() => rosterBasis(report), [report]);
  const pool = useMemo(() => poolBasis(report), [report]);
  if (!blueTeam || !redTeam || blueTeam.team_id === redTeam.team_id) return null;
  return <RosterWorkshopBody key={`${basisKey(basis)}|${pairKey([blueTeam.team_id, redTeam.team_id])}`}
    basis={basis} patchId={report.patch_id} teams={teams} blueTeam={blueTeam} redTeam={redTeam} disabled={disabled}
    pool={pool} selections={selections} previousPicks={previousPicks} focusChampionId={focusChampionId} />;
}

type Status = { tone: "info" | "error"; text: string } | null;

function RosterWorkshopBody({ basis, patchId, teams, blueTeam, redTeam, disabled, pool, selections, previousPicks, focusChampionId }: {
  basis: RosterBasis; patchId: string; teams: OpponentTeam[]; blueTeam: OpponentTeam; redTeam: OpponentTeam; disabled: boolean;
  pool: PoolBasis; selections: readonly PoolSelection[]; previousPicks: readonly string[]; focusChampionId: string | null;
}) {
  const index = useMemo(() => buildRosterIndex(teams), [teams]);
  const teamIds = useMemo(() => [blueTeam.team_id, redTeam.team_id].sort() as [string, string], [blueTeam.team_id, redTeam.team_id]);
  const observed = useMemo(() => observedRosters(teams, teamIds, index), [teams, teamIds, index]);
  const [rosters, setRosters] = useState<RosterState>(observed);
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<Status>({ tone: "info", text: "기기 저장 확인 중" });
  const [fileStatus, setFileStatus] = useState<Status>(null);
  const [editStatus, setEditStatus] = useState("");
  const [reading, setReading] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(ROSTER_STORAGE_KEY); }
      catch { setStorage({ tone: "error", text: "이 기기 저장소를 사용할 수 없습니다. 파일 저장은 가능합니다." }); return; }
      if (!saved) { setStorage({ tone: "info", text: "기기에 저장된 가상 로스터 없음 · 원관측 표시" }); return; }
      const result = parseRosterScenario(saved, { basis, teamIds, index });
      if (result.ok) { setRosters(result.value.rosters); setStorage({ tone: "info", text: "기기에 저장된 가상 로스터를 복원했습니다." }); }
      else if (result.code === "TEAM_MISMATCH" || result.code === "BASIS_MISMATCH") {
        setStorage({ tone: "info", text: "기기에 저장된 로스터는 다른 팀 조합 또는 다른 자료 기준이라 적용하지 않았습니다." });
      } else setStorage({ tone: "error", text: `기기에 저장된 로스터를 복원하지 못했습니다: ${result.error}` });
    }, 0);
    return () => window.clearTimeout(restore);
  }, [basis, teamIds, index]);

  function serialize(state: RosterState) {
    return serializeRosterScenario({ basis, team_ids: teamIds, rosters: state }, index);
  }

  function commit(next: RosterState) {
    setRosters(next);
    try { window.localStorage.setItem(ROSTER_STORAGE_KEY, serialize(next)); setStorage({ tone: "info", text: "이 기기에 가상 로스터 저장됨" }); }
    catch { setStorage({ tone: "error", text: "이 기기에 로스터를 저장하지 못했습니다. 파일로 저장해 두세요." }); }
  }

  function choose(teamId: string, role: RosterRole, value: string) {
    const player = value ? index.players.get(value) : null;
    if (value && !player) { setEditStatus("선택한 선수를 현재 자료에서 찾을 수 없어 바꾸지 않았습니다."); return; }
    const result = assignSlot(rosters, teamId, role, player ? { source_team_id: player.source_team_id, player_id: player.player_id } : null, index);
    if (!result.ok) { setEditStatus(result.error); return; }
    const { movedFrom } = result.value;
    setEditStatus(movedFrom && player
      ? `${player.player_name}을(를) ${teamName(movedFrom.teamId)} ${roleLabel(movedFrom.role)}에서 옮겼습니다. 이전 슬롯은 빈칸입니다.`
      : "");
    commit(result.value.state);
  }

  function teamName(teamId: string) {
    return teamId === blueTeam.team_id ? blueTeam.team_name : teamId === redTeam.team_id ? redTeam.team_name : teamId;
  }

  function download() {
    const blob = new Blob([serialize(rosters)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `roster-scenario-${blueTeam.team_name}-vs-${redTeam.team_name}-${patchId}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function openFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || reading) return;
    setReading(true);
    try {
      if (file.size > MAX_ROSTER_FILE_BYTES) { setFileStatus({ tone: "error", text: "로스터 파일이 64KB를 넘어 열지 않았습니다. 현재 로스터를 유지합니다." }); return; }
      const text = await file.text();
      // A team/snapshot change remounts this editor. A stale read must not overwrite
      // the new editor's device copy after it has already saved a different roster.
      if (!mounted.current) return;
      const result = parseRosterScenario(text, { basis, teamIds, index });
      if (!result.ok) { setFileStatus({ tone: "error", text: `${result.error} 현재 로스터를 유지합니다.` }); return; }
      commit(result.value.rosters);
      setEditStatus("");
      setFileStatus({ tone: "info", text: "로스터 파일을 불러왔습니다. 밴픽과 기준 A는 바뀌지 않습니다." });
    } catch { if (mounted.current) setFileStatus({ tone: "error", text: "파일을 읽지 못했습니다. 현재 로스터를 유지합니다." }); }
    finally { input.value = ""; if (mounted.current) setReading(false); }
  }

  const statuses = (side: DraftSide, team: OpponentTeam) => ROSTER_ROLES.map((role) =>
    ({ role, status: slotStatus(team.team_id, role, rosters[team.team_id]?.[role] ?? null, observed[team.team_id]?.[role] ?? null, index), side }));
  const all = [...statuses("BLUE", blueTeam), ...statuses("RED", redTeam)];
  const changedCount = all.filter((item) => item.status.changed).length;
  const emptyCount = all.filter((item) => !item.status.player).length;

  return <details className="roster-workshop" lang="ko" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>가상 로스터·포지션 <small>원관측과 다른 슬롯 {changedCount} · 빈칸 {emptyCount}</small></summary>
    {open && <div className="roster-workshop-body">
      <p className="roster-workshop-note" role="note"><b>기존 추천 순위·예측/시뮬레이션에는 로스터 변경이 아직 반영되지 않습니다.</b> 변경은 아래 선수 근거·남은 관측 챔프 표시에만 반영됩니다. 같은 공개 스냅샷에서 관측된 선수만 고를 수 있으며, CURRENT는 자료상의 관측 표시일 뿐 공식 최신 소속이 아닙니다. 역할 관측이 하나로 정해지지 않으면 빈칸으로 둡니다.</p>
      <div className="roster-workshop-teams">
        <RosterTeam side="BLUE" team={blueTeam} rosters={rosters} observed={observed} index={index} teams={teams} disabled={disabled || reading} onChoose={choose} />
        <RosterTeam side="RED" team={redTeam} rosters={rosters} observed={observed} index={index} teams={teams} disabled={disabled || reading} onChoose={choose} />
      </div>
      <PlayerPoolPanel basis={pool} teams={teams} index={index} rosters={rosters} blueTeam={blueTeam} redTeam={redTeam}
        selections={selections} previousPicks={previousPicks} focusChampionId={focusChampionId} />
      {editStatus && <p className="roster-workshop-status" role="status">{editStatus}</p>}
      <div className="roster-workshop-actions">
        <button type="button" disabled={disabled || reading || changedCount === 0} onClick={() => { setEditStatus("원관측 배치로 되돌렸습니다."); commit(observed); }}>원관측으로 되돌리기</button>
        <button type="button" disabled={disabled} onClick={download}>로스터 파일 저장</button>
        <label className="roster-workshop-file">로스터 파일 열기<input type="file" accept=".json,application/json" disabled={disabled || reading} onChange={(event) => void openFile(event.currentTarget)} /></label>
      </div>
      {storage && <p className="roster-workshop-status" role={storage.tone === "error" ? "alert" : "status"}>{storage.text}</p>}
      {fileStatus && <p className="roster-workshop-status" role={fileStatus.tone === "error" ? "alert" : "status"}>{fileStatus.text}</p>}
    </div>}
  </details>;
}

function playerLabel(player: RosterPlayer, index: RosterIndex) {
  const id = index.collidingNames.has(player.player_name.toLocaleLowerCase("en-US")) ? ` · ID ${player.player_id}` : "";
  return `${player.player_name} · ${roleLabel(player.observed_role)}${player.roster_status === "CURRENT" ? "" : " · 현재 관측 아님"}${id}`;
}

function RosterTeam({ side, team, rosters, observed, index, teams, disabled, onChoose }: {
  side: DraftSide; team: OpponentTeam; rosters: RosterState; observed: RosterState; index: RosterIndex; teams: OpponentTeam[];
  disabled: boolean; onChoose: (teamId: string, role: RosterRole, value: string) => void;
}) {
  const own = [...index.players.values()].filter((player) => player.source_team_id === team.team_id)
    .sort((left, right) => Number(right.roster_status === "CURRENT") - Number(left.roster_status === "CURRENT")
      || ROSTER_ROLES.indexOf(left.observed_role as RosterRole) - ROSTER_ROLES.indexOf(right.observed_role as RosterRole)
      || left.player_name.localeCompare(right.player_name, "en-US") || left.player_id.localeCompare(right.player_id, "en-US"));
  const others = teams.filter((candidate) => candidate.team_id !== team.team_id && (candidate.player_profiles?.length ?? 0) > 0)
    .sort((left, right) => left.team_name.localeCompare(right.team_name, "en-US") || left.team_id.localeCompare(right.team_id, "en-US"));
  const playersOf = (teamId: string) => [...index.players.values()].filter((player) => player.source_team_id === teamId)
    .sort((left, right) => left.player_name.localeCompare(right.player_name, "en-US") || left.player_id.localeCompare(right.player_id, "en-US"));
  const profiles = team.player_profiles ?? [];
  return <section className={`roster-team ${side.toLowerCase()}`} aria-label={`${side} ${team.team_name} 가상 로스터`}>
    <h3><span>{side}</span>{team.team_name}</h3>
    <ol>
      {ROSTER_ROLES.map((role) => {
        const assigned = rosters[team.team_id]?.[role] ?? null;
        const original = observed[team.team_id]?.[role] ?? null;
        const status = slotStatus(team.team_id, role, assigned, original, index);
        const originalPlayer = original ? index.players.get(playerKey(original.source_team_id, original.player_id)) : null;
        return <li key={role} className={status.changed ? "changed" : ""} data-role={role}>
          <label><span>{roleLabel(role)}</span>
            <select aria-label={`${team.team_name} ${roleLabel(role)} 선수`} disabled={disabled}
              value={assigned ? playerKey(assigned.source_team_id, assigned.player_id) : ""}
              onChange={(event) => onChoose(team.team_id, role, event.target.value)}>
              <option value="">빈칸 · 미확인</option>
              <optgroup label={`${team.team_name} 관측 선수`}>
                {own.map((player) => <option key={player.key} value={player.key}>{playerLabel(player, index)}</option>)}
              </optgroup>
              {others.map((other) => <optgroup key={other.team_id} label={`${other.team_name} 관측 (가상 변경)`}>
                {playersOf(other.team_id).map((player) => <option key={player.key} value={player.key}>{playerLabel(player, index)}</option>)}
              </optgroup>)}
            </select>
          </label>
          <p className="roster-slot-flags">
            {!status.player && <em>빈칸 · 미확인</em>}
            {status.player && !status.changed && <em>원관측</em>}
            {status.changed && <b>원관측과 다름 (원관측: {originalPlayer ? originalPlayer.player_name : "빈칸"})</b>}
            {status.otherTeam && <b className="virtual">가상 변경: {status.player?.source_team_name} 관측 선수</b>}
            {status.roleMoved && <b className="virtual">가상 변경: 관측 역할 {roleLabel(status.player?.observed_role ?? "")}</b>}
            {status.player && status.notCurrent && !status.otherTeam && <em>자료상 현재 관측 아님</em>}
          </p>
        </li>;
      })}
    </ol>
    <details className="roster-observed">
      <summary>관측 원명단 {profiles.length}명</summary>
      {profiles.length ? <ul>{profiles.map((profile, position) => <li key={`${profile.player_id}:${position}`}>
        <strong>{profile.player_name}</strong> · {roleLabel(profile.role)} · {profile.roster_status === "CURRENT" ? "자료상 CURRENT 관측" : profile.roster_status === "OTHER_OBSERVED" ? "자료상 다른 관측" : "관측 상태 없음"} · {profile.game_count}경기 · ID {profile.player_id}
        {index.ambiguous.has(playerKey(team.team_id, profile.player_id)) && <em> · 중복 관측으로 선택 불가</em>}
      </li>)}</ul> : <p>이 스냅샷에 관측된 선수 기록이 없습니다.</p>}
    </details>
  </section>;
}
