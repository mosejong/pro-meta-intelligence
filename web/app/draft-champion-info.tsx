"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use Riot Data Dragon */

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { championAssetId, championImageUrl, DATA_DRAGON_VERSION } from "./champion-assets";
import { draftCandidateEvidence } from "./draft-candidate-evidence";
import "./draft-candidate-evidence.css";
import type { SeasonHistory } from "./player-season-history";
import type { DraftSelection, DraftSide } from "./draft-agent";
import type { OpponentChampionTendency, OpponentTeam, RadarReport } from "./radar-types";

export const CHAMPION_ROLE_ORDER = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"] as const;

export const championRoleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

/**
 * priority_picks / frequent_bans / received_bans are bounded summary lists (most frequent only).
 * A champion missing from a list is UNKNOWN (null), never "0 times". recent_games are separate:
 * they are complete per-game records, so a count there is an actual observation within those games.
 */
export type ChampionTeamEvidence = {
  side: DraftSide;
  team_name: string;
  team_game_count: number;
  summary_pick_count: number | null;
  summary_ban_count: number | null;
  summary_received_ban_count: number | null;
  recent_game_count: number;
  recent_pick_count: number;
  evidence_count: number;
};

export type ChampionRadarEvidence = {
  role: string;
  current_pick_count: number;
  current_distinct_team_count: number;
  eligible_for_review: boolean;
  evidence_count: number;
};

export type ChampionEvidenceSummary = {
  champion_id: string;
  /** Roles seen in public samples only. A flex champion keeps every observed role. */
  observed_roles: string[];
  teams: ChampionTeamEvidence[];
  radar: ChampionRadarEvidence[];
  has_public_sample: boolean;
};

const same = (left: string, right: string) => championAssetId(left).toLowerCase() === championAssetId(right).toLowerCase();

/**
 * Names and roles do not establish whether rows refer to the same games.
 * Merge fully cited rows by event identity. Identical summary rows are safe to deduplicate,
 * but incomplete overlapping summaries cannot establish an exact combined count.
 */
function summaryCount(items: OpponentChampionTendency[], championId: string): number | null {
  const matching = items.filter((item) => same(item.champion_id, championId));
  const unique = [...new Map(matching.map((item) => [
    JSON.stringify([item.role ?? "", item.game_count, [...new Set(item.evidence_event_ids)].sort()]), item,
  ])).values()];
  if (!unique.length) return null;
  if (unique.length === 1) return unique[0].game_count;
  if (unique.every((item) => item.game_count === new Set(item.evidence_event_ids).size)) {
    return new Set(unique.flatMap((item) => item.evidence_event_ids)).size;
  }
  return null;
}

function teamEvidence(side: DraftSide, team: OpponentTeam, championId: string): ChampionTeamEvidence {
  const tendencies = [...team.priority_picks, ...team.frequent_bans, ...team.received_bans].filter((item) => same(item.champion_id, championId));
  const games = team.recent_games ?? [];
  const pickedGames = games.filter((game) => game.picks.some((pick) => same(pick.champion_id, championId)));
  const recentPickIds = pickedGames.flatMap((game) => game.picks).filter((pick) => same(pick.champion_id, championId)).map((pick) => pick.evidence_event_id);
  const ids = new Set([...tendencies.flatMap((item) => item.evidence_event_ids), ...recentPickIds]);
  return {
    side,
    team_name: team.team_name,
    team_game_count: team.game_count,
    summary_pick_count: summaryCount(team.priority_picks, championId),
    summary_ban_count: summaryCount(team.frequent_bans, championId),
    summary_received_ban_count: summaryCount(team.received_bans, championId),
    recent_game_count: new Set(games.map((game) => game.match_id)).size,
    recent_pick_count: new Set(pickedGames.map((game) => game.match_id)).size,
    evidence_count: ids.size,
  };
}

/** Summarises only what the frozen public report records for one champion. Nothing is inferred. */
export function summarizeChampionEvidence(
  report: RadarReport,
  blueTeam: OpponentTeam | null,
  redTeam: OpponentTeam | null,
  championId: string,
): ChampionEvidenceSummary {
  const roles = new Set<string>();
  const addRole = (role: string | undefined) => { if (role && role in championRoleLabels) roles.add(role); };
  const teams: ChampionTeamEvidence[] = [];
  for (const [side, team] of [["BLUE", blueTeam], ["RED", redTeam]] as const) {
    if (!team) continue;
    team.priority_picks.filter((item) => same(item.champion_id, championId)).forEach((item) => addRole(item.role));
    (team.recent_games ?? []).flatMap((game) => game.picks).filter((pick) => same(pick.champion_id, championId)).forEach((pick) => addRole(pick.role));
    teams.push(teamEvidence(side, team, championId));
  }
  // One radar row per role; alias duplicates of the same role are merged, evidence ids de-duplicated.
  const radarByRole = new Map<string, ChampionRadarEvidence & { ids: Set<string> }>();
  for (const entry of report.entries.filter((item) => same(item.champion_id, championId))) {
    addRole(entry.role);
    const row = radarByRole.get(entry.role);
    if (!row) {
      radarByRole.set(entry.role, {
        role: entry.role,
        current_pick_count: entry.metrics.current_pick_count,
        current_distinct_team_count: entry.metrics.current_distinct_team_count,
        eligible_for_review: entry.eligible_for_review,
        evidence_count: 0,
        ids: new Set(entry.evidence_event_ids),
      });
      continue;
    }
    row.current_pick_count = Math.max(row.current_pick_count, entry.metrics.current_pick_count);
    row.current_distinct_team_count = Math.max(row.current_distinct_team_count, entry.metrics.current_distinct_team_count);
    row.eligible_for_review ||= entry.eligible_for_review;
    entry.evidence_event_ids.forEach((id) => row.ids.add(id));
  }
  const radar = [...radarByRole.values()].map(({ ids, ...row }) => ({ ...row, evidence_count: ids.size }));
  const observedTeams = teams.filter((item) => item.evidence_count > 0 || item.summary_pick_count !== null || item.summary_ban_count !== null
    || item.summary_received_ban_count !== null || item.recent_pick_count > 0);
  return {
    champion_id: championId,
    observed_roles: CHAMPION_ROLE_ORDER.filter((role) => roles.has(role)),
    teams,
    radar,
    has_public_sample: observedTeams.length > 0 || radar.length > 0,
  };
}

/** `inspected` marks a confirmed slot the user opened for reading only; it never changes the draft. */
export type ChampionFocus = {
  champion_id: string;
  status: "STAGED" | "CONFIRMED";
  selection: Pick<DraftSelection, "side" | "kind" | "slot">;
  inspected?: boolean;
};

const summaryText = (label: string, count: number | null) => count === null ? `${label} 집계 미확인` : `${label} ${count}경기`;

const infoTabs = [
  { id: "OVERVIEW", label: "개요" },
  { id: "RUNES", label: "룬" },
  { id: "ITEMS", label: "아이템" },
  { id: "EVIDENCE", label: "근거" },
] as const;
export type ChampionInfoTab = (typeof infoTabs)[number]["id"];

function focusLabel(focus: ChampionFocus) {
  const side = focus.selection.side === "BLUE" ? "블루" : "레드";
  const kind = focus.selection.kind === "BAN" ? "밴" : "픽";
  if (focus.status === "STAGED") return `${side} ${focus.selection.slot}번째 ${kind} · 올려놓음(확정 전)`;
  return `${side} ${focus.selection.slot}번째 ${kind} · 확정됨${focus.inspected ? " · 정보 열람 중" : ""}`;
}

export function DraftChampionInfo({ focus, report, blueTeam, redTeam, nameOf, initialTab = "OVERVIEW", onCloseInspect, seasonHistory, seasonLoading = false }: {
  seasonHistory?: SeasonHistory | null;
  seasonLoading?: boolean;
  focus: ChampionFocus | null;
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  nameOf: (championId: string) => string;
  initialTab?: ChampionInfoTab;
  /** Shown only while an already-confirmed slot is being inspected. */
  onCloseInspect?: () => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<ChampionInfoTab>(initialTab);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (!focus) {
    return <section className="draft-champion-info empty" aria-label="챔피언 정보">
      <p>챔피언을 고르면 공개 표본의 역할과 근거가 여기에 표시됩니다.</p>
    </section>;
  }

  const summary = summarizeChampionEvidence(report, blueTeam, redTeam, focus.champion_id);
  const name = nameOf(focus.champion_id);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = infoTabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setTab(infoTabs[next].id);
    tabRefs.current[next]?.focus();
  }

  return <section className="draft-champion-info" aria-label={`${name} 정보`}>
    <header>
      <img src={championImageUrl(focus.champion_id)} alt="" />
      <div>
        <h3>{name}</h3>
        <span className={`draft-champion-status ${focus.status.toLowerCase()}`}>{focusLabel(focus)}</span>
      </div>
      {focus.inspected && onCloseInspect && <button type="button" className="draft-champion-close" onClick={onCloseInspect}>열람 닫기</button>}
    </header>
    <div className="studio-info-tabs" role="tablist" aria-label={`${name} 정보 분류`}>
      {infoTabs.map((item, index) => <button
        key={item.id}
        ref={(node) => { tabRefs.current[index] = node; }}
        type="button"
        role="tab"
        id={`${id}-tab-${item.id}`}
        aria-selected={tab === item.id}
        aria-controls={`${id}-panel`}
        tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)}
        onKeyDown={(event) => onTabKey(event, index)}
      >{item.label}</button>)}
    </div>
    <div className="studio-info-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
      {tab === "OVERVIEW" && <>
        <section className="draft-candidate-evidence" aria-label="픽 검토 근거">
          {seasonLoading && <p className="studio-info-note" role="status">시즌 선수 기록을 확인하고 있어요…</p>}
          {([blueTeam, redTeam] as const).filter((team): team is OpponentTeam => !!team).map(team => {
            const evidence = draftCandidateEvidence(report, team, focus.champion_id, seasonHistory);
            return <div key={team.team_id} data-candidate-category={evidence.category}>
              <b>{team.team_name} · {evidence.label}</b>
              <p className="studio-info-note">팀·현재 관측 선수 기록 {evidence.teamObserved ? "확인" : "미확인"} · 시즌 사용 기록 {evidence.seasonObserved ? "확인" : "미확인"}</p>
              <p className="studio-info-note">{evidence.boundary}</p>
            </div>;
          })}
        </section>
        <dl>
          <div><dt>공개 기록 역할</dt><dd>{summary.observed_roles.length ? summary.observed_roles.map((role) => championRoleLabels[role]).join(" · ") : "관측 없음"}</dd></div>
          {summary.teams.map((team) => <div key={team.side}><dt>{team.team_name} · 팀 공개 요약</dt><dd>
            {summaryText("픽", team.summary_pick_count)} · {summaryText("밴", team.summary_ban_count)}
            <small>{team.recent_game_count ? `최근 기록 ${team.recent_game_count}경기 중 픽 ${team.recent_pick_count}경기` : "최근 경기 기록 없음"}</small>
          </dd></div>)}
        </dl>
        <p className="studio-info-note">{summary.has_public_sample
          ? "팀 단위 공개 경기 기록이며 선수 개인 기록이 아닙니다. 요약 목록은 자주 나온 챔피언만 담아, 목록에 없으면 0회가 아니라 미확인입니다. 별칭 기록의 중복을 확인할 수 없을 때도 합계는 미확인으로 표시합니다."
          : "선택한 두 팀의 공개 요약과 현재 레이더에서 이 챔피언을 확인하지 못했습니다. 0회라는 뜻도, 약하다는 뜻도 아닙니다."}</p>
      </>}
      {tab === "RUNES" && <p className="studio-info-unlinked"><b>룬 자료 미연결</b>출처와 패치가 확인된 룬 자료를 아직 연결하지 않아 룬을 표시하지 않습니다.</p>}
      {tab === "ITEMS" && <p className="studio-info-unlinked"><b>아이템 자료 미연결</b>출처와 패치가 확인된 아이템·코어 자료를 아직 연결하지 않아 빌드를 표시하지 않습니다.</p>}
      {tab === "EVIDENCE" && <>
        <ul>
          {summary.teams.map((team) => <li key={team.side}>
            <b>{team.side} · {team.team_name}</b>
            <span>공개 요약 · {summaryText("우선 픽", team.summary_pick_count)} · {summaryText("자주 하는 밴", team.summary_ban_count)} · {summaryText("받은 밴", team.summary_received_ban_count)}</span>
            <span>경기별 확인 · {team.recent_game_count ? `최근 ${team.recent_game_count}경기 중 픽 ${team.recent_pick_count}경기` : "최근 경기 기록 없음"}</span>
            <small>근거 기록 {team.evidence_count}건</small>
          </li>)}
          {summary.radar.map((entry) => <li key={entry.role}>
            <b>메타 레이더 · {championRoleLabels[entry.role] ?? entry.role}</b>
            <span>최근 구간 픽 {entry.current_pick_count} · {entry.current_distinct_team_count}개 팀</span>
            <small>{entry.eligible_for_review ? "검토 후보" : "표본 기준 미달"} · 근거 기록 {entry.evidence_count}건</small>
          </li>)}
        </ul>
        {!summary.has_public_sample && <p className="studio-info-note">확인된 공개 근거가 없습니다.</p>}
        <p className="studio-info-source">경기 패치 {report.patch_id} · 기준 {report.cutoff} · 이름·초상 Data Dragon {DATA_DRAGON_VERSION}</p>
      </>}
    </div>
  </section>;
}
