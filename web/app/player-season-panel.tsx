"use client";

import { useEffect, useRef, useState } from "react";
import { useChampionNames } from "./champion-names";
import type { PoolChampionState, PoolSelection } from "./player-pool-evidence";
import {
  loadPlayerSeasonHistory,
  PLAYER_SEASON_YEAR,
  seasonSlot,
  sourceIsOlder,
  type SeasonHistory,
  type SeasonScope,
  type SeasonSlot,
} from "./player-season-history";
import type { OpponentTeam } from "./radar-types";
import { basisKey, playerKey, ROSTER_ROLES, type RosterBasis, type RosterIndex, type RosterState } from "./roster-scenario";
import { seasonSlotIdentity, type SeasonSlotIdentity } from "./roster-season-slots";
import { SeasonSlotNote } from "./roster-season-slot-note";
import type { SeasonCardCatalog, TeamSeasonSlots } from "./season-player-cards";

const roleLabels: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const roleLabel = (role: string) => roleLabels[role] ?? `역할 미확인(${role})`;
const stateLabels: Record<PoolChampionState, string> = {
  AVAILABLE: "선택 가능", FEARLESS_LOCKED: "이전 세트 픽 잠금", BANNED_NOW: "이번 세트 밴", PICKED_NOW: "이번 세트 픽",
};
const day = (iso: string | null) => iso ? iso.slice(0, 10) : "—";

/** Successfully validated files per (url, basis); failures are retried on the next open. */
const cache = new Map<string, SeasonHistory>();

type LoadState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; history: SeasonHistory }
  | { key: string; status: "error"; error: string };

type Props = {
  basis: RosterBasis;
  /** Publication root relative to the page (e.g. "./" or "../"). */
  publicationRoot: string;
  path: string;
  index: RosterIndex;
  rosters: RosterState;
  blueTeam: OpponentTeam;
  redTeam: OpponentTeam;
  selections: readonly PoolSelection[];
  previousPicks: readonly string[];
  /** Past-season players assigned in the roster editor; their slots are named instead of "빈칸". */
  seasonLineups?: TeamSeasonSlots;
  seasonCatalog?: SeasonCardCatalog | null;
};
const NO_SEASON: TeamSeasonSlots = {};

/**
 * Season per-role records for the current virtual roster, kept apart from the snapshot pool above.
 * The file is requested only when this section is opened; closing it, changing the basis or the
 * team pair aborts the request and a late response is dropped instead of reaching a new view.
 */
export function PlayerSeasonSection({ basis, publicationRoot, path, index, rosters, blueTeam, redTeam, selections, previousPicks, seasonLineups = NO_SEASON, seasonCatalog = null }: Props) {
  const key = `${publicationRoot}${path}|${basisKey(basis)}`;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SeasonScope>("season");
  const [load, setLoad] = useState<LoadState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const currentKey = useRef(key);

  useEffect(() => {
    currentKey.current = key;
    return () => { controller.current?.abort(); controller.current = null; };
  }, [key]);

  function start() {
    const cached = cache.get(key);
    if (cached) { setLoad({ key, status: "ready", history: cached }); return; }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoad({ key, status: "loading" });
    const url = new URL(path, new URL(publicationRoot, document.baseURI));
    loadPlayerSeasonHistory(url, { basis, season: PLAYER_SEASON_YEAR }, request.signal).then((result) => {
      if (request.signal.aborted || currentKey.current !== key) return;
      controller.current = null;
      if (result.ok) { cache.set(key, result.value); setLoad({ key, status: "ready", history: result.value }); }
      else setLoad({ key, status: "error", error: result.error });
    }, () => { /* aborted: the view that asked for it is gone */ });
  }

  function toggle(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) { if (!(load?.key === key && load.status === "ready")) start(); }
    else if (controller.current) { controller.current.abort(); controller.current = null; setLoad(null); }
  }

  const current = load?.key === key ? load : null;
  return <details className="player-season" open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
    <summary>{PLAYER_SEASON_YEAR} 연간 역할별 기록 <small>현재 스냅샷 목록과 별도 · 펼칠 때 불러옴</small></summary>
    {open && <div className="player-season-body">
      <p className="player-season-status" data-history-coverage-notice="">2014년 이후 자료를 순차 확보 중이며, 이 섹션은 {PLAYER_SEASON_YEAR}년 자료만 표시합니다. 연도·대회별 누락이 있을 수 있습니다.</p>
      {!current
        ? <button type="button" className="player-season-retry" onClick={start}>연간 자료 불러오기</button>
        : current.status === "loading"
        ? <p className="player-season-status" role="status">연간 자료 불러오는 중…</p>
        : current.status === "error"
          ? <div><p className="player-season-status" role="alert" data-season-error="">연간 자료 미연결: {current.error} 위 현재 스냅샷 근거와 밴픽·로스터는 그대로입니다.</p><button type="button" className="player-season-retry" onClick={start}>연간 자료 다시 불러오기</button></div>
          : <PlayerSeasonBody history={current.history} scope={scope} onScope={setScope} index={index} rosters={rosters}
            blueTeam={blueTeam} redTeam={redTeam} selections={selections} previousPicks={previousPicks} seasonLineups={seasonLineups} seasonCatalog={seasonCatalog} />}
    </div>}
  </details>;
}

const scopeLabels = (history: SeasonHistory): Record<SeasonScope, string> => ({
  season: `${history.season} 연간 전체`,
  recent: `최근 최대 ${history.recent_game_limit}경기`,
  patch: `현재 패치 ${history.reference_patch}`,
});

/** Loaded annual body; exported for rendering tests only. */
export function PlayerSeasonBody({ history, scope, onScope, index, rosters, blueTeam, redTeam, selections, previousPicks, seasonLineups = NO_SEASON, seasonCatalog = null }: {
  history: SeasonHistory; scope: SeasonScope; onScope: (scope: SeasonScope) => void; index: RosterIndex; rosters: RosterState;
  blueTeam: OpponentTeam; redTeam: OpponentTeam; selections: readonly PoolSelection[]; previousPicks: readonly string[];
  seasonLineups?: TeamSeasonSlots; seasonCatalog?: SeasonCardCatalog | null;
}) {
  const labels = scopeLabels(history);
  const summary = history.import_summary;
  const older = sourceIsOlder(history);
  return <>
    <p className="player-season-note" role="note" data-source-older={older ? "true" : "false"}>
      원본 취득 {new Date(history.source.retrieved_at).toISOString().slice(0, 16).replace("T", " ")} UTC{older && <b> · 현재 스냅샷 기준({history.cutoff.slice(0, 10)})보다 오래된 원본이라 취득 이후 경기는 포함되지 않습니다</b>}.
      {" "}집계 경기 기간 {day(summary.season_first_observed_at)}~{day(summary.season_last_observed_at)}, 정규화 검증을 통과한 {history.season}년 경기 {summary.season_accepted_game_count}경기만 셉니다
      {summary.accepted_game_count !== null && summary.rejected_game_count !== null && <> (원본 파일 전체 유효 {summary.accepted_game_count} · 제외 {summary.rejected_game_count}경기 · 파일 전체 통계이며 선수별 누락률이 아님)</>}.
      {" "}같은 원팀·선수 ID 기록만 보고 이름이나 다른 팀 기록을 합치지 않습니다. 역할은 그 경기에서 실제로 맡은 역할입니다.
      범위에 없는 챔프는 실력 부재가 아니라 이 범위에서 관측되지 않았다는 뜻이며, 추천·예측에는 반영되지 않습니다.
    </p>
    <fieldset className="player-season-scope">
      <legend>범위</legend>
      {(Object.keys(labels) as SeasonScope[]).map((value) => <label key={value}>
        <input type="radio" name="player-season-scope" value={value} checked={scope === value} onChange={() => onScope(value)} />{labels[value]}
      </label>)}
    </fieldset>
    <div className="player-pool-teams">
      {([["BLUE", blueTeam], ["RED", redTeam]] as const).map(([side, team]) => <section key={side} className={`player-season-team ${side.toLowerCase()}`} aria-label={`${side} ${team.team_name} 연간 역할별 기록`}>
        <h4><span>{side}</span>{team.team_name}</h4>
        <ul>{ROSTER_ROLES.map((role) => {
          const assigned = rosters[team.team_id]?.[role] ?? null;
          const slot = seasonSlot({ history, role, assigned, scope, selections, previousPicks });
          const name = assigned ? index.players.get(playerKey(assigned.source_team_id, assigned.player_id))?.player_name ?? assigned.player_id : "";
          const seasonPlayer = assigned ? null : seasonSlotIdentity({ lineups: seasonLineups, catalog: seasonCatalog, rosters, teamId: team.team_id, role });
          return <SeasonRow key={role} slot={slot} name={name} playerKey={assigned ? playerKey(assigned.source_team_id, assigned.player_id) : ""}
            scopeLabel={labels[scope]} seasonSlot={seasonPlayer} year={history.season} />;
        })}</ul>
      </section>)}
    </div>
  </>;
}

function SeasonRow({ slot, name, playerKey: key, scopeLabel, seasonSlot, year }: { slot: SeasonSlot; name: string; playerKey: string; scopeLabel: string; seasonSlot: SeasonSlotIdentity | null; year: number }) {
  const { nameOf } = useChampionNames();
  const head = <b className="player-pool-role">{roleLabel(slot.role)}</b>;
  const attrs = { "data-role": slot.role, "data-status": slot.status, "data-player-key": key || undefined };
  // A season player's slot: never this year's record of a current roster player.
  if (slot.status === "EMPTY" && seasonSlot) return <li data-role={slot.role} data-status="SEASON">{head} <SeasonSlotNote identity={seasonSlot}
    boundary={`${year} 연간 기록은 현재 스냅샷 선수만 대상 · 시즌 기록은 ‘과거 시즌 선수로 구성하기’에서 확인`} /></li>;
  if (slot.status === "EMPTY") return <li {...attrs}>{head} 빈칸</li>;
  if (slot.status === "UNCONFIRMED") return <li {...attrs}>{head} <strong>{name}</strong> · 연간 자료에서 이 원팀·선수 ID 기록 미확인 <small>(0경기가 아니라 자료 없음)</small></li>;
  const player = slot.player!;
  const others = slot.other_roles.length ? <small> · 다른 역할 연간: {slot.other_roles.map((item) => `${roleLabel(item.role)} ${item.games}경기`).join(", ")} (이 역할에 합치지 않음)</small> : null;
  if (slot.status === "ZERO_IN_ROLE") return <li {...attrs}>
    {head} <strong>{name}</strong> · {player.team_name} · {scopeLabel} 배정 {roleLabel(slot.role)} 0경기{others}
  </li>;
  const stats = slot.stats!;
  return <li {...attrs}>
    <p className="player-pool-head">{head} <strong>{name}</strong> <span>· {player.team_name} 기록 · {scopeLabel} {roleLabel(slot.role)} {stats.games}경기 · {day(stats.first_observed_at)}~{day(stats.last_observed_at)}</span>{others}</p>
    <p className="player-pool-count">남은 챔프 {slot.available_count}/{slot.champions.length} <small>(이 범위 관측 전체)</small></p>
    <ul className="player-season-champs">{slot.champions.map((champion) => <li key={champion.champion_id} data-state={champion.state} data-champion={champion.champion_id}
      title={champion.example_event_ids?.length ? `예시 근거 ${champion.example_event_ids.join(", ")} (총 ${champion.games}경기)` : undefined}>
      {nameOf(champion.champion_id)} {champion.games}경기{champion.state !== "AVAILABLE" && <small> · {stateLabels[champion.state]}</small>}
    </li>)}</ul>
    <details className="player-pool-refs"><summary>패치·리그별 표본 (연간 {roleLabel(slot.role)})</summary>
      <p>패치: {slot.by_patch.map((row) => `${row.id} ${row.games}경기(${day(row.first_observed_at)}~${day(row.last_observed_at)})`).join(", ")}</p>
      <p>리그: {slot.by_league.map((row) => `${row.id} ${row.games}경기(${day(row.first_observed_at)}~${day(row.last_observed_at)})`).join(", ")}</p>
      <p>원팀 ID: {player.team_id} · 선수 ID: {player.player_id}</p>
      <p>연간 선택 근거 예시(챔프당 최대 3개, 최근·패치 범위 전용 근거가 아님):</p>
      {player.roles[slot.role]?.season.champions.map(champion => <p key={champion.champion_id}>{nameOf(champion.champion_id)} 연간 {champion.games}경기 · {champion.example_event_ids?.join(", ") || "예시 없음"}</p>)}
    </details>
  </li>;
}
