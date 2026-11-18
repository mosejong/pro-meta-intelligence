"use client";

import { useEffect, useRef, useState } from "react";
import {
  annualText,
  compareAssignedEvidence,
  explainRow,
  hasRoleRecord,
  type ComparisonEvidenceRow,
  type SideEvidence,
} from "./comparison-player-evidence";
import type { DraftComparisonSnapshot } from "./draft-comparison";
import {
  loadPlayerSeasonHistory,
  PLAYER_SEASON_PATH,
  PLAYER_SEASON_YEAR,
  sourceIsOlder,
  type SeasonHistory,
} from "./player-season-history";
import { basisKey, type RosterBasis, type RosterRole } from "./roster-scenario";
import type { LoadedSeasonHistory } from "./simulation-player-evidence";
import "./comparison-player-evidence.css";

const roleLabels: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const sideLabel = (side: "BLUE" | "RED") => side === "BLUE" ? "블루" : "레드";
const day = (iso: string | null) => iso ? iso.slice(0, 10) : "—";

/** Histories validated per (url, basis). Failures are never cached and can be retried. */
const cache = new Map<string, LoadedSeasonHistory>();

type LoadState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; loaded: LoadedSeasonHistory }
  | { key: string; status: "error"; error: string };

type Props = {
  /** Frozen baseline A (detached; its roles are what was recorded at freeze time, or null). */
  a: DraftComparisonSnapshot;
  /** Current B (its roles come from the current ready simulation input, or null). */
  b: DraftComparisonSnapshot;
  /** Roster basis of the current report; the season file is validated against it. */
  basis: RosterBasis;
  /** Publication root relative to the page (e.g. "./" or "../"). */
  publicationRoot: string;
  nameOf: (championId: string) => string;
  /** Switch to the simulation-readiness tab where roles are assigned. */
  onOpenRoles?: () => void;
};

/**
 * Collapsed "player · champion observation differences" for the live A/B result. The season file is
 * requested only when the user opens it and only when both A and B have a role record. Closing, a
 * basis change or unmount aborts the request; a late response is dropped. Rows are recomputed from
 * the current A/B on every render (the validated file is reused per basis), so a changed player or
 * role never shows a previous row's numbers. Nothing here touches the draft, roster, A or storage.
 */
export function ComparisonPlayerEvidence({ a, b, basis, publicationRoot, nameOf, onOpenRoles }: Props) {
  const bKey = basisKey(basis);
  const key = `${publicationRoot}${PLAYER_SEASON_PATH}|${bKey}`;
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<LoadState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const currentKey = useRef(key);
  const eligible = hasRoleRecord(a) && hasRoleRecord(b);

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
    if (nextOpen) { if (eligible && !(load?.key === key && load.status === "ready")) start(); }
    else if (controller.current) { controller.current.abort(); controller.current = null; setLoad(null); }
  }

  const current = load?.key === key ? load : null;
  return <details className="comparison-evidence" open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
    <summary>선수·챔피언 경험 차이 <small>{eligible ? `${PLAYER_SEASON_YEAR} 연간 자료 · 펼칠 때 불러옴` : "역할 배정 기록 필요"}</small></summary>
    {open && <div className="comparison-evidence-body">
      <p className="comparison-evidence-note" role="note">현재 추가 참고입니다. 지금 불러온 연간 자료로 A와 B를 각각 다시 집계하며, 기준 A 고정 당시의 연간 자료를 보관한 것이 아닙니다. 이 연간 수치는 A/B 비교 JSON에 포함되지 않아 파일로 재현되지 않습니다. 횟수는 관측 기록이며 효과·실력·승률이 아닙니다.</p>
      {!eligible
        ? <RolesMissing a={a} b={b} onOpenRoles={onOpenRoles} />
        : !current
          ? <button type="button" onClick={start}>연간 자료 불러오기</button>
          : current.status === "loading"
            ? <p className="comparison-evidence-status" role="status" data-evidence-state="loading">연간 자료 불러오는 중…</p>
            : current.status === "error"
              ? <div className="comparison-evidence-status"><p role="alert" data-evidence-state="error">연간 자료 확인 불가: {current.error} 밴픽·로스터·역할·기준 A와 A/B 비교는 그대로입니다.</p>
                <button type="button" onClick={start}>연간 자료 다시 불러오기</button></div>
              : <EvidenceBody a={a} b={b} loaded={current.loaded} nameOf={nameOf} />}
    </div>}
  </details>;
}

function RolesMissing({ a, b, onOpenRoles }: { a: DraftComparisonSnapshot; b: DraftComparisonSnapshot; onOpenRoles?: () => void }) {
  return <div className="comparison-evidence-status" data-evidence-state="roles-missing">
    <ul>
      {!a.roles && <li>기준 A: 역할 배정 기록 없음. 시뮬레이션 준비 탭에서 역할을 배정해 입력이 준비된 상태로 기준 A를 다시 고정해야 A에 역할이 기록됩니다.</li>}
      {!b.roles && <li>현재 B: 역할 배정 기록 없음. 현재 밴픽·로스터에 맞게 시뮬레이션 준비 탭에서 두 팀 역할 10개를 배정하세요.</li>}
    </ul>
    <p>픽 순서로 역할을 추정하지 않습니다. 위의 픽·밴·로스터 비교와 파일 저장·재현은 그대로 쓸 수 있습니다.</p>
    {onOpenRoles && <button type="button" className="comparison-evidence-cta" onClick={onOpenRoles}>시뮬레이션 준비 탭에서 역할 배정</button>}
  </div>;
}

function EvidenceBody({ a, b, loaded, nameOf }: { a: DraftComparisonSnapshot; b: DraftComparisonSnapshot; loaded: LoadedSeasonHistory; nameOf: (id: string) => string }) {
  const result = compareAssignedEvidence(a, b, loaded);
  if (!result.ok) return <p className="comparison-evidence-status" role="alert" data-evidence-state="hold" data-hold={result.code}>비교 보류: {result.message}</p>;
  const { history } = loaded;
  const summary = history.import_summary;
  const unconfirmed = (row: ComparisonEvidenceRow) =>
    [row.a.row.status, row.b.row.status].some((status) => status === "UNCONFIRMED" || status === "EMPTY");
  const unknown = result.rows.filter(unconfirmed);
  const changed = result.rows.filter((row) => !unconfirmed(row) && row.changed);
  const same = result.rows.filter((row) => !unconfirmed(row) && !row.changed);
  return <>
    <p className="comparison-evidence-source" data-source-older={sourceIsOlder(history) ? "true" : "false"}>
      출처 {history.source.source_id} · 원본 취득 {history.source.retrieved_at.slice(0, 10)} · 집계 경기 {day(summary.season_first_observed_at)}~{day(summary.season_last_observed_at)}
      · 검증 통과 {summary.season_accepted_game_count}경기{summary.rejected_game_count !== null && <> · 원본 제외 {summary.rejected_game_count}경기</>}
      · 참조 패치 {history.reference_patch}. 같은 원팀·선수 ID의 해당 역할 경기만 세며 올해 모든 실제 경기는 아닙니다. 파일에 없는 선수는 0이 아니라 확인 불가입니다.
      {sourceIsOlder(history) && <> 원본이 분석 기준 시각보다 오래되어 원본 취득 이후 경기는 포함하지 않습니다.</>}
    </p>
    <p className="comparison-evidence-note">다음 세트 남은 관측 풀: 선수의 해당 역할 연간 챔피언 중 이전 세트와 이번 세트의 양 팀 픽을 잠그고 남은 수/관측한 종류 수입니다. 이번 세트 밴은 다음 세트에 풀리므로 빼지 않습니다.</p>
    <p className="comparison-evidence-summary" role="status">달라진 행 {changed.length}개 · 같은 행 {same.length}개 · 기록 확인 불가 {unknown.length}개 (팀 ID·역할 기준)</p>
    {changed.length > 0 && <ul className="comparison-evidence-rows">{changed.map((row) => <EvidenceCard key={`${row.team_id}-${row.role}`} row={row} history={history} nameOf={nameOf} />)}</ul>}
    {same.length > 0 && <details className="comparison-evidence-same">
      <summary>같은 행 {same.length}개 보기</summary>
      <ul className="comparison-evidence-rows">{same.map((row) => <EvidenceCard key={`${row.team_id}-${row.role}`} row={row} history={history} nameOf={nameOf} />)}</ul>
    </details>}
    {unknown.length > 0 && <details className="comparison-evidence-unconfirmed">
      <summary>기록 확인 불가 {unknown.length}행 보기 (0·동일 아님)</summary>
      <p>한쪽 이상에 자료가 없어 경험·관측 풀의 동일 여부를 판정하지 않습니다.</p>
      <ul className="comparison-evidence-rows">{unknown.map((row) => <EvidenceCard key={`${row.team_id}-${row.role}`} row={row} history={history} nameOf={nameOf} />)}</ul>
    </details>}
  </>;
}

function SideBlock({ label, side, history, nameOf }: { label: "A" | "B"; side: SideEvidence; history: SeasonHistory; nameOf: (id: string) => string }) {
  const { row, pool } = side;
  return <div className={`comparison-evidence-side side-${label.toLowerCase()}`} data-side={label} data-status={row.status} data-player-key={row.player_key || undefined} data-champion={row.champion_id}>
    <p><b>{label}</b> {row.status === "EMPTY" ? "선수 빈칸" : <><strong>{row.player_name}</strong> <small>({row.source_team_name} 기록{row.virtual ? " · 가상 배정" : ""})</small></>} · {nameOf(row.champion_id)}</p>
    <p className="comparison-evidence-counts">
      <span data-scope="season" data-picks={row.scopes && row.status === "OBSERVED" ? row.scopes.season.picks : undefined} data-games={row.scopes ? row.scopes.season.games : undefined}>{annualText(side)}</span>
      {row.status === "OBSERVED" && row.scopes && <>
        <span data-scope="recent" data-picks={row.scopes.recent.picks} data-games={row.scopes.recent.games}>최근 {history.recent_game_limit} {row.scopes.recent.picks}/{row.scopes.recent.games}</span>
        <span data-scope="patch" data-picks={row.scopes.patch.picks} data-games={row.scopes.patch.games}>패치 {history.reference_patch} {row.scopes.patch.games ? `${row.scopes.patch.picks}/${row.scopes.patch.games}` : "0경기"}</span>
      </>}
    </p>
    {pool
      ? <details className="comparison-evidence-pool" data-available={pool.available} data-observed={pool.observed_unique}>
        <summary>다음 세트 남은 관측 {pool.available}/{pool.observed_unique}종</summary>
        {pool.remaining.length
          ? <ol>{pool.remaining.map((item) => <li key={item.champion_id}>{nameOf(item.champion_id)} <small>{item.games}경기</small></li>)}</ol>
          : <p>남은 관측 챔피언 없음{pool.observed_unique === 0 ? " (이 역할 관측 0)" : ""}</p>}
        {pool.locked.length > 0 && <p><small>잠김: {pool.locked.map(nameOf).join(", ")}</small></p>}
      </details>
      : <p className="comparison-evidence-pool-unknown" data-available="unknown">다음 세트 남은 관측: 확인 불가 (0 아님)</p>}
  </div>;
}

function EvidenceCard({ row, history, nameOf }: { row: ComparisonEvidenceRow; history: SeasonHistory; nameOf: (id: string) => string }) {
  return <li className="comparison-evidence-card" data-team={row.team_id} data-role={row.role} data-changed={row.changed ? "true" : "false"}>
    <h4>{sideLabel(row.side_b)} {row.team_name} {roleLabels[row.role]}{row.side_a !== row.side_b ? <small> (A에서는 {sideLabel(row.side_a)})</small> : null}</h4>
    <ul className="comparison-evidence-explain">{explainRow(row, nameOf).map((line, index) => <li key={index}>{line}</li>)}</ul>
    <div className="comparison-evidence-sides">
      <SideBlock label="A" side={row.a} history={history} nameOf={nameOf} />
      <SideBlock label="B" side={row.b} history={history} nameOf={nameOf} />
    </div>
  </li>;
}

export default ComparisonPlayerEvidence;
