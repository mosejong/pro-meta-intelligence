"use client";

import { useChampionNames } from "./champion-names";
import type { OpponentTeam } from "./radar-types";
import { teamEvidence, type PoolBasis, type PoolChampionState, type PoolSelection, type SlotEvidence } from "./player-pool-evidence";
import type { RosterIndex, RosterState } from "./roster-scenario";

const roleLabels: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const roleLabel = (role: string) => roleLabels[role] ?? `역할 미확인(${role})`;
const stateLabels: Record<PoolChampionState, string> = {
  AVAILABLE: "선택 가능",
  FEARLESS_LOCKED: "이전 세트 픽 잠금",
  BANNED_NOW: "이번 세트 밴",
  PICKED_NOW: "이번 세트 픽",
};
const day = (iso: string) => iso.slice(0, 10);

type PlayerPoolPanelProps = {
  basis: PoolBasis;
  teams: OpponentTeam[];
  index: RosterIndex;
  rosters: RosterState;
  blueTeam: OpponentTeam;
  redTeam: OpponentTeam;
  selections: readonly PoolSelection[];
  previousPicks: readonly string[];
  focusChampionId: string | null;
};

/**
 * Read-only, collapsed evidence for the current virtual roster: each slot's own public record and
 * which listed champions remain open under this game's bans/picks and earlier games' picks.
 * Nothing here selects, stages or confirms a champion, and it feeds no recommendation.
 */
export function PlayerPoolPanel({ basis, teams, index, rosters, blueTeam, redTeam, selections, previousPicks, focusChampionId }: PlayerPoolPanelProps) {
  const common = { teams, index, basis, selections, previousPicks, focusChampionId, rosters };
  const sides = [
    { side: "BLUE", team: blueTeam, rows: teamEvidence({ ...common, teamId: blueTeam.team_id }) },
    { side: "RED", team: redTeam, rows: teamEvidence({ ...common, teamId: redTeam.team_id }) },
  ];
  const scope = [
    basis.maximum_games_per_team !== null ? `팀당 최대 ${basis.maximum_games_per_team}경기 범위` : null,
  ].filter(Boolean).join(", ");
  return <details className="player-pool">
    <summary>선수 근거·남은 관측 챔프 <small>PATCH {basis.patch_id} · 기준 {basis.cutoff.slice(0, 16).replace("T", " ")}</small></summary>
    <p className="player-pool-note" role="note">
      선수별 공개 스냅샷 요약 목록{scope ? `(${scope})` : ""}입니다.
      시즌 전체·챔프폭·실력 지표가 아니며, 목록에 없는 챔프는 0회가 아니라 미확인입니다.
      관측 역할은 대표 역할이며, 챔프 횟수는 역할을 나누지 않은 선수 요약입니다. 해당 포지션에서만 사용한 횟수가 아닙니다.
      잠금 구분은 이번 세트 밴·픽과 이전 세트 픽(양 팀) 기준이며, 기존 추천 순위·예측/시뮬레이션에는 반영되지 않습니다.
    </p>
    <div className="player-pool-teams">
      {sides.map(({ side, team, rows }) => <section key={side} className={`player-pool-team ${side.toLowerCase()}`} aria-label={`${side} ${team.team_name} 선수 근거`}>
        <h4><span>{side}</span>{team.team_name}</h4>
        <ul>{rows.map((row) => <PoolRow key={row.role} row={row} index={index} />)}</ul>
      </section>)}
    </div>
  </details>;
}

function PoolRow({ row, index }: { row: SlotEvidence; index: RosterIndex }) {
  const { nameOf } = useChampionNames();
  const head = <b className="player-pool-role">{roleLabel(row.role)}</b>;
  if (row.status === "EMPTY") return <li data-role={row.role} data-status="EMPTY">{head} 빈칸 · 선수 근거 미확인</li>;
  if (row.status === "UNRESOLVED" || !row.player) return <li data-role={row.role} data-status="UNRESOLVED">{head} 현재 스냅샷에서 선수 기록을 확인할 수 없음</li>;
  const player = row.player;
  const showId = index.collidingNames.has(player.player_name.toLocaleLowerCase("en-US"));
  return <li data-role={row.role} data-status="OBSERVED" data-player-key={player.key}>
    <p className="player-pool-head">
      {head} <strong>{player.player_name}</strong>{showId && <small> · ID {player.player_id}</small>}
      <span> · 관측 역할 {roleLabel(row.observed_role ?? "")} · {row.source_team_name} 표본 {row.sample_games}경기</span>
      {row.window && <span className="player-pool-window"> · 팀 관측 {day(row.window.first_observed_at)}~{day(row.window.last_observed_at)}</span>}
    </p>
    {(row.from_other_team || !row.role_matches) && <p className="player-pool-flags">
      {row.from_other_team && <em>원팀({row.source_team_name}) 기록 · 이 팀 기록 아님</em>}
      {!row.role_matches && <em>배정 {roleLabel(row.role)} 경험 미검증 · 대표 관측 역할 {roleLabel(row.observed_role ?? "")}</em>}
    </p>}
    {row.list_state === "EMPTY"
      ? <p className="player-pool-count">관측 챔프 목록 없음 · 자료 미확인</p>
      : <>
        <p className="player-pool-count">목록 내 남은 관측 챔프 {row.available_count}/{row.listed_count}{row.list_state === "LIMITED" ? " · 제한된 목록" : ""} <small>(전체 챔프폭 아님)</small></p>
        <ul className="player-pool-champs">{row.champions.map((champion) => <li key={champion.champion_id} data-state={champion.state} data-champion={champion.champion_id}
          title={`근거 ${champion.evidence_event_ids.length}건: ${champion.evidence_event_ids.slice(0, 5).join(", ")}${champion.evidence_event_ids.length > 5 ? " …" : ""}`}>
          {nameOf(champion.champion_id)} {champion.game_count}경기{champion.state !== "AVAILABLE" && <small> · {stateLabels[champion.state]}</small>}
        </li>)}</ul>
      </>}
    {row.focus && <p className="player-pool-focus" data-focus={row.focus.status}>
      선택 챔프 {nameOf(row.focus.champion_id)}: {row.focus.champion ? `목록 내 ${row.focus.champion.game_count}경기 관측` : "목록 밖 · 미확인"}
    </p>}
    <details className="player-pool-refs"><summary>근거 기록 보기 · {row.evidence_match_ids.length}경기</summary>
      <p>원팀 ID: {row.source_team_id} · 선수 ID: {player.player_id}</p>
      <p>경기 ID: {row.evidence_match_ids.join(", ") || "미확인"}</p>
      {row.champions.map(champion => <p key={champion.champion_id}>{nameOf(champion.champion_id)} 선택 근거: {champion.evidence_event_ids.join(", ") || "미확인"}</p>)}
    </details>
  </li>;
}
