"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadPlayerSeasonHistory,
  PLAYER_SEASON_PATH,
  PLAYER_SEASON_YEAR,
  sourceIsOlder,
  type SeasonHistory,
  type SeasonScope,
} from "./player-season-history";
import { basisKey, type RosterBasis, type RosterRole } from "./roster-scenario";
import {
  assignedChampionEvidence,
  type AssignedEvidenceRow,
  type LoadedSeasonHistory,
} from "./simulation-player-evidence";
import type { SimulationInputSnapshot } from "./simulation-scenario";

const roleLabels: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const day = (iso: string | null) => iso ? iso.slice(0, 10) : "—";

/** Histories validated per (url, basis). Failures are never cached and are retried. */
const cache = new Map<string, LoadedSeasonHistory>();

type LoadState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; loaded: LoadedSeasonHistory }
  | { key: string; status: "error"; error: string };

type Props = {
  /** The current ready input, or null when the input is not (or no longer) ready. */
  snapshot: SimulationInputSnapshot | null;
  /** Roster basis of the current report; the file is validated against it. */
  basis: RosterBasis;
  /** Publication root relative to the page (e.g. "./" or "../"). */
  publicationRoot: string;
  nameOf: (championId: string) => string;
};

/**
 * Collapsed, read-only season evidence for the champions assigned in the current ready input.
 * The season file is requested only when opened; closing, a basis change or unmount aborts it and
 * a late response is dropped. Rows are always recomputed from the current snapshot, so a new
 * player or role never shows a previous player's numbers; the file itself is reused per basis.
 */
export function SimulationPlayerEvidence({ snapshot, basis, publicationRoot, nameOf }: Props) {
  const bKey = basisKey(basis);
  const key = `${publicationRoot}${PLAYER_SEASON_PATH}|${bKey}`;
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<LoadState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const currentKey = useRef(key);

  useEffect(() => {
    currentKey.current = key;
    return () => { controller.current?.abort(); controller.current = null; };
  }, [key]);

  function start() {
    const cached = cache.get(key);
    if (cached) { setLoad({ key, status: "ready", loaded: cached }); return; }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoad({ key, status: "loading" });
    const url = new URL(PLAYER_SEASON_PATH, new URL(publicationRoot, document.baseURI));
    loadPlayerSeasonHistory(url, { basis, season: PLAYER_SEASON_YEAR }, request.signal).then((result) => {
      if (request.signal.aborted || currentKey.current !== key) return;
      controller.current = null;
      if (result.ok) {
        const loaded = { basisKey: bKey, history: result.value };
        cache.set(key, loaded);
        setLoad({ key, status: "ready", loaded });
      } else setLoad({ key, status: "error", error: result.error });
    }, () => { /* aborted: the view that asked for it is gone */ });
  }

  function toggle(nextOpen: boolean) {
    if (nextOpen === open) return;
    setOpen(nextOpen);
    if (nextOpen) { if (!(load?.key === key && load.status === "ready")) start(); }
    else if (controller.current) { controller.current.abort(); controller.current = null; setLoad(null); }
  }

  // Only offered for a ready input; once opened it stays to say the input is no longer ready.
  if (!snapshot && !open) return null;
  const current = load?.key === key ? load : null;
  return <details className="simulation-evidence" open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
    <summary>배정 챔피언의 선수 기록 <small>{PLAYER_SEASON_YEAR} 연간 자료 · 펼칠 때 불러옴</small></summary>
    {open && <div className="simulation-evidence-body">
      <p className="simulation-evidence-note">현재 입력 추가 참고입니다. 고정 입력·입력 JSON(manager-scenario)·A/B 파일에는 연간 자료가 포함되지 않으며, 횟수는 효과나 승률이 아닙니다.</p>
      {!snapshot
        ? <p className="simulation-evidence-status" role="status" data-evidence-state="not-ready">현재 입력이 준비되지 않아 선수 기록을 표시하지 않습니다.</p>
        : !current
          ? <button type="button" onClick={start}>연간 자료 불러오기</button>
          : current.status === "loading"
            ? <p className="simulation-evidence-status" role="status" data-evidence-state="loading">연간 자료 불러오는 중…</p>
            : current.status === "error"
              ? <div className="simulation-evidence-status"><p role="alert" data-evidence-state="error">연간 자료 확인 불가: {current.error} 밴픽·역할·로스터와 고정 입력은 그대로입니다.</p>
                <button type="button" onClick={start}>연간 자료 다시 불러오기</button></div>
              : <EvidenceBody snapshot={snapshot} loaded={current.loaded} nameOf={nameOf} />}
    </div>}
  </details>;
}

const scopeLabel = (history: SeasonHistory, scope: SeasonScope) =>
  scope === "season" ? "연간" : scope === "recent" ? `최근 ${history.recent_game_limit}` : `패치 ${history.reference_patch}`;

function EvidenceBody({ snapshot, loaded, nameOf }: { snapshot: SimulationInputSnapshot; loaded: LoadedSeasonHistory; nameOf: (id: string) => string }) {
  const result = assignedChampionEvidence(snapshot, loaded);
  if (!result.ok) return <p className="simulation-evidence-status" role="alert" data-evidence-state="error">연간 자료 확인 불가: {result.message}</p>;
  const { history } = loaded;
  const summary = history.import_summary;
  return <>
    <p className="simulation-evidence-source" data-source-older={sourceIsOlder(history) ? "true" : "false"}>
      원본 취득 {history.source.retrieved_at.slice(0, 10)} · 집계 경기 {day(summary.season_first_observed_at)}~{day(summary.season_last_observed_at)}(마지막 유효 경기)
      · 검증 통과 {summary.season_accepted_game_count}경기{summary.rejected_game_count !== null && <> · 원본 제외 {summary.rejected_game_count}경기</>}
      · 참조 패치 {history.reference_patch}. 같은 원팀·선수 ID의 해당 포지션 경기만 세며 올해 모든 실제 경기는 아닙니다.
      {sourceIsOlder(history) && <> 원본이 분석 기준 시각보다 오래되어, 원본 취득 이후 경기는 포함하지 않습니다.</>}
    </p>
    <div className="simulation-evidence-teams">{(["BLUE", "RED"] as const).map((side) => {
      const team = snapshot.draft.teams[side];
      return <section key={side} className={`simulation-evidence-team ${side.toLowerCase()}`} aria-label={`${side === "BLUE" ? "블루" : "레드"} ${team.name} 배정 챔피언 기록`}>
        <h4>{side === "BLUE" ? "블루" : "레드"} {team.name}</h4>
        <ul>{result.rows.filter((row) => row.side === side).map((row) => <EvidenceRow key={row.role} row={row} history={history} nameOf={nameOf} />)}</ul>
      </section>;
    })}</div>
  </>;
}

function EvidenceRow({ row, history, nameOf }: { row: AssignedEvidenceRow; history: SeasonHistory; nameOf: (id: string) => string }) {
  const role = roleLabels[row.role];
  const attrs = { "data-role": row.role, "data-status": row.status, "data-player-key": row.player_key || undefined, "data-champion": row.champion_id };
  const head = <p className="simulation-evidence-head"><b>{role}</b> {nameOf(row.champion_id)} · {row.status === "EMPTY" ? "선수 빈칸" : <>
    <strong>{row.player_name}</strong> <small>({row.source_team_name} 기록{row.virtual ? " · 가상 배정" : ""})</small></>}</p>;
  if (row.status === "EMPTY") return <li {...attrs}>{head}</li>;
  if (row.status === "UNCONFIRMED") return <li {...attrs}>{head}<p>자료 없음/확인 불가 <small>(이 원팀·선수 ID 기록 미확인 · 0경기 아님)</small></p></li>;
  const scopes = row.scopes!;
  const others = row.other_roles.length
    ? <small> · 다른 역할 연간 {row.other_roles.map((item) => `${roleLabels[item.role]} ${item.games}`).join(", ")}경기 (합치지 않음)</small> : null;
  if (row.status === "ZERO_IN_ROLE") return <li {...attrs}>{head}<p>{role} 0경기 <small>(연간 이 역할 기록 없음)</small>{others}</p></li>;
  return <li {...attrs}>{head}
    <p className="simulation-evidence-counts">{(["season", "recent", "patch"] as const).map((scope) => {
      const count = scopes[scope];
      return <span key={scope} data-scope={scope} data-picks={count.picks} data-games={count.games}>
        {scopeLabel(history, scope)} {count.games ? `${count.picks}/${count.games}경기` : `${role} 0경기`}
      </span>;
    })}</p>
    <p><small>{role}로 뛴 경기 중 이 챔피언을 고른 횟수 · 연간 {day(scopes.season.first_observed_at)}~{day(scopes.season.last_observed_at)}</small>{others}</p>
  </li>;
}

export default SimulationPlayerEvidence;
