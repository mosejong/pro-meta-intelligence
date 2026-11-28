"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RadarReport } from "./radar-types";
import { playerKey, ROSTER_ROLES, type RosterIndex, type RosterState } from "./roster-scenario";
import type { SeasonCardCatalog, TeamSeasonSlots } from "./season-player-cards";
import type { RosterObservationContext } from "./roster-observation-context";
import {
  createObservationPreparationSession, OBSERVATION_PREPARATION_IDLE,
  type ObservationPreparation, type ObservationPreparationSession, type ObservationPreparationStatus,
} from "./roster-observation-session";
import { setObservationFlag, useObservationFlag } from "./roster-observation-flag";
import "./roster-observation.css";

/**
 * Explicit practice-restore request for the owner: `expected` is the saved context already
 * re-verified by the library against the SAVED report and the loaded catalog (null when the library
 * could not verify it). Applied at most once per token, after the owner applied the restored roster.
 */
export type ObservationRestore = { token: number; expected: RosterObservationContext | null };

const roleLabels: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
const short = (hash: string) => `${hash.slice(0, 12)}…`;

/**
 * "관측 문맥 준비" inside the roster editor (the verified catalog owner). Opt-in (default off).
 * One explicit click captures the exact ten slots, report and loaded catalog and builds a verified
 * reference record; any lineup/source/lock change, cancel or newer request withdraws it, and a late
 * result is discarded. It never edits the roster, never computes ability/effect/win-rate values and
 * never becomes an experiment or simulation input.
 */
export function RosterObservationPanel({ ownerKey, report, catalog, teamIds, teamName, index, rosters, seasonLineups, blocked, restore = null, onPublish }: {
  ownerKey: string;
  report: RadarReport;
  catalog: SeasonCardCatalog | null;
  teamIds: readonly [string, string];
  teamName: (teamId: string) => string;
  index: RosterIndex;
  rosters: RosterState;
  seasonLineups: TeamSeasonSlots;
  /** The owner's room/disabled/reading/restore block. */
  blocked: boolean;
  restore?: ObservationRestore | null;
  /** Ready value or null on withdrawal. Must be stable or tolerate being read through a ref. */
  onPublish: (value: ObservationPreparation | null) => void;
}) {
  const enabled = useObservationFlag();
  const [status, setStatus] = useState<ObservationPreparationStatus>(OBSERVATION_PREPARATION_IDLE);
  const sessionRef = useRef<ObservationPreparationSession | null>(null);
  const publishRef = useRef(onPublish);
  const restoreToken = useRef(0);
  useLayoutEffect(() => { publishRef.current = onPublish; }, [onPublish]);
  useEffect(() => {
    const session = createObservationPreparationSession({ onPublish: (value) => publishRef.current(value), onStatus: setStatus });
    sessionRef.current = session;
    return () => { session.dispose(); if (sessionRef.current === session) sessionRef.current = null; };
  }, []);

  // Withdrawal: every committed change of the lineup, sources, lock or flag invalidates (A→B→A too).
  // An explicit restore request (new token) instead rebuilds from the state applied in this commit.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (restore && restore.token > restoreToken.current) {
      restoreToken.current = restore.token;
      if (restore.expected && enabled) {
        void session.prepare({ ownerKey, report, catalog, teamIds, rosters, seasonLineups, analysisAsOf: restore.expected.analysis_as_of, blocked, expected: restore.expected });
        return;
      }
    }
    session.invalidate();
  }, [ownerKey, report, catalog, teamIds, rosters, seasonLineups, blocked, enabled, restore]);

  function prepareNow() {
    const session = sessionRef.current;
    if (!session || !enabled) return;
    // The preparation time is captured once, at this click.
    void session.prepare({ ownerKey, report, catalog, teamIds, rosters, seasonLineups, analysisAsOf: new Date().toISOString(), blocked });
  }

  const preparing = status.phase === "PREPARING";
  return <section className="roster-observation" aria-labelledby="roster-observation-title" lang="ko">
    <header>
      <h4 id="roster-observation-title">관측 문맥 준비</h4>
      <label><input type="checkbox" checked={enabled} onChange={(event) => setObservationFlag(event.currentTarget.checked)} /> 사용(기본 꺼짐)</label>
    </header>
    {!enabled ? <p className="roster-observation-note">켜면 현재·시즌 선수로 채운 두 팀 10역할의 선수 참조와 자료 기준을 명시적으로 고정해 연습 보관함에 함께 보관할 수 있습니다. 꺼져 있으면 기존 저장 방식 그대로입니다.</p> : <>
      <p className="roster-observation-note">버튼을 누른 시점의 10역할 선수 참조·분석 데이터·시즌 자료 버전을 검증해 고정합니다. 능력치·효과·승률은 만들지 않고, 실험·시뮬레이션 입력으로 쓰지 않습니다. 선수 구성을 바꾸면 준비는 철회됩니다.</p>
      <div className="roster-observation-actions">
        <button type="button" onClick={prepareNow} disabled={blocked || preparing}>관측 문맥 준비</button>
        {preparing && <button type="button" onClick={() => sessionRef.current?.invalidate()}>준비 취소</button>}
      </div>
      <ObservationStatus status={status} teamIds={teamIds} teamName={teamName} index={index} catalog={catalog} />
    </>}
  </section>;
}

function ObservationStatus({ status, teamIds, teamName, index, catalog }: {
  status: ObservationPreparationStatus; teamIds: readonly [string, string]; teamName: (id: string) => string; index: RosterIndex; catalog: SeasonCardCatalog | null;
}) {
  if (status.phase === "IDLE") return <p className="roster-observation-status" role="status">준비된 관측 문맥 없음</p>;
  if (status.phase === "PREPARING") return <p className="roster-observation-status" role="status">{status.restoring ? "저장된 관측 문맥을 적용된 선수 구성으로 다시 확인하는 중…" : "관측 문맥을 검증하는 중… 선수 구성은 바뀌지 않습니다."}</p>;
  if (status.phase === "REFUSED") return <p className="roster-observation-status refused" role="alert">{status.restoring ? "저장된 관측 문맥은 복원하지 않았습니다(밴픽·선수 구성은 유지). " : "준비하지 않았습니다. 선수 구성은 그대로입니다. "}{status.message}</p>;
  const { context, restored } = status.ready;
  const card = (cardId: string) => catalog?.cards.find((c) => c.id === cardId) ?? null;
  return <div className="roster-observation-card" role="status" aria-label="검증된 관측 문맥">
    <p className="roster-observation-ready"><b>{restored ? "저장된 관측 문맥을 다시 확인해 복원했습니다" : "검증된 관측 문맥"}</b> · 준비 시각 <time dateTime={context.analysis_as_of}>{context.analysis_as_of}</time></p>
    <dl className="roster-observation-basis">
      <div><dt>context_key</dt><dd title={context.context_key}><code>{short(context.context_key)}</code></dd></div>
      <div><dt>분석 데이터 digest</dt><dd title={context.report_evidence_digest}><code>{short(context.report_evidence_digest)}</code></dd></div>
      <div><dt>분석 데이터 cutoff</dt><dd>{context.report_cutoff}</dd></div>
      <div><dt>시즌 자료 provenance digest</dt><dd title={context.catalog_provenance_digest}><code>{short(context.catalog_provenance_digest)}</code></dd></div>
      <div><dt>시즌 자료 cutoff</dt><dd>{context.catalog_cutoff}</dd></div>
      <div><dt>analysis_as_of</dt><dd>{context.analysis_as_of}</dd></div>
    </dl>
    <div className="roster-observation-teams">
      {teamIds.slice().sort().map((teamId) => <section key={teamId} aria-label={`${teamName(teamId)} 선수 참조`}>
        <h5>{teamName(teamId)}</h5>
        <ol>{ROSTER_ROLES.map((role) => {
          const slot = context.teams[teamId]?.[role];
          if (!slot) return null;
          if (slot.kind === "CURRENT") {
            const player = index.players.get(playerKey(slot.source_team_id, slot.player_id));
            return <li key={role} data-kind="CURRENT"><span>{roleLabels[role]}</span><b>{player?.player_name ?? "선수 이름 미확인"}</b><small>현재 · {slot.player_id}</small></li>;
          }
          const seasonCard = card(slot.card_id);
          return <li key={role} data-kind="SEASON"><span>{roleLabels[role]}</span><b>{seasonCard?.player_name ?? "시즌 선수"}</b><small>{seasonCard ? `${seasonCard.season} 시즌` : "시즌"} · 카드 {short(slot.card_id)}</small></li>;
        })}</ol>
      </section>)}
    </div>
    <p className="roster-observation-note">선수 참조와 자료 기준만 담은 기록입니다. 현재 실력·효과·승률이 아니며 실험 입력이 아닙니다.</p>
  </div>;
}

/** Read-only summary for the experiment/simulation area. It is never an experiment input. */
export function RosterObservationSummary({ preparation }: { preparation: ObservationPreparation | null }) {
  if (!preparation) return null;
  const { context } = preparation;
  let season = 0, current = 0;
  for (const teamId of context.team_ids) for (const role of ROSTER_ROLES) { if (context.teams[teamId]?.[role]?.kind === "SEASON") season++; else current++; }
  return <aside className="roster-observation-summary" lang="ko" aria-label="검증된 관측 문맥 요약">
    <b>검증된 관측 문맥</b> · 현재 선수 {current} · 시즌 선수 {season} · 준비 시각 {context.analysis_as_of} · key <code title={context.context_key}>{short(context.context_key)}</code>
    <small>요약 표시만 합니다. 실험 입력·기준 A·시뮬레이션에는 포함되지 않으며, 시즌 선수가 있는 구성의 실험 실행 차단은 그대로입니다.</small>
  </aside>;
}
