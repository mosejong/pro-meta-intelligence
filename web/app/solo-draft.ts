import { championAssetId } from "./champion-assets";
import { applyDraftSelection, buildDraftAgentFrame, nextDraftTurn, type DraftSelection, type DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import type { SeasonHistory } from "./player-season-history";
import { soloRoleCandidates, canCoverRoles } from "./solo-role-candidates";
import { SHARE_CHAMPIONS } from "./share-champion-ids";

export type SoloDraftSuggestion = {
  champion_id: string;
  role_supported?: boolean;
  reason: string;
  source: "TEAM_RECORD" | "PLAYER_SEASON" | "RADAR" | "PATCH_PRESENCE" | "FALLBACK";
};

/**
 * Ban candidate policy. PATCH_PRESENCE is the default since it passed the walk-forward adoption rules
 * (docs/benchmarks/DRAFT_BAN_POLICY_CANDIDATES_2026-11-23.md). The PATCH_* policies need
 * report.patch_presence; without it they fall back to OPPONENT_RECORD (the previous default).
 */
export type SoloBanPolicy = "OPPONENT_RECORD" | "PATCH_PRESENCE" | "PATCH_PRESENCE_WITH_OPPONENT";
export const DEFAULT_BAN_POLICY: SoloBanPolicy = "PATCH_PRESENCE";
export type SoloDraftInput = {
  banPolicy?: SoloBanPolicy;
  seasonHistory?: SeasonHistory | null;
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  selections: DraftSelection[];
  previousPicks: string[];
  firstPickSide: DraftSide;
  manualSide: DraftSide;
};

const canonicalIds = new Map(SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
function canonical(value: unknown): string | undefined {
  return typeof value === "string" ? canonicalIds.get(championAssetId(value).toLowerCase()) : undefined;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const observedRoles = new Set(["TOP", "JUNGLE", "MID", "BOTTOM", "ADC", "SUPPORT"]);

/** Deterministic public-record practice opponent; does not assign champion roles. */
export function suggestSoloDraftTurn(input: SoloDraftInput): SoloDraftSuggestion | null {
  return soloContext(input)?.select(new Set()) ?? null;
}

/** The evidence row that actually produced a candidate (finer than `source`, which is unchanged). */
export type SoloDraftEvidence = "TEAM_PRIORITY" | "PLAYER_CURRENT" | "PLAYER_SEASON" | "RADAR_META" | "RADAR_FRAME" | "PATCH_PRESENCE" | "FALLBACK";
export type SoloDraftExplainedChoice = SoloDraftSuggestion & { inferred_roles: string[]; evidence: SoloDraftEvidence };
export type SoloDraftExplanation = {
  turn: number;
  kind: "BAN" | "PICK";
  side: DraftSide;
  /** Lookup target only: the team whose public records the rules try first. Not proof that rows existed. */
  record_team: string;
  record_scope: "OPPOSING_TEAM" | "ACTING_TEAM";
  /**
   * true only when the selector's own season eligibility (soloRoleCandidates) produced at least one
   * acting-team current-player season candidate. false = missing/incompatible/unmatched: unknown, not zero use.
   */
  season_evidence: boolean;
  selected: SoloDraftExplainedChoice;
  alternatives: SoloDraftExplainedChoice[];
};

/**
 * Read-only explanation for the same pre-choice state. Alternatives are what the unchanged rules
 * pick when earlier candidates are made unavailable; replay/Fearless legality is still enforced.
 */
export function explainSoloDraftTurn(input: SoloDraftInput): SoloDraftExplanation | null {
  const ctx = soloContext(input);
  const selected = ctx?.select(new Set());
  if (!ctx || !selected) return null;
  const excluded = new Set([selected.champion_id]);
  const alternatives: SoloDraftSuggestion[] = [];
  while (alternatives.length < 2) {
    const next = ctx.select(excluded);
    if (!next || excluded.has(next.champion_id)) break;
    alternatives.push(next);
    excluded.add(next.champion_id);
  }
  const withRoles = (s: SoloDraftSuggestion): SoloDraftExplainedChoice =>
    ({ ...s, inferred_roles: ctx.turn.kind === "PICK" ? ctx.rolesOf(s.champion_id) : [], evidence: ctx.evidenceOf(s) });
  return {
    turn: ctx.replayLength + 1, kind: ctx.turn.kind, side: ctx.turn.side,
    record_team: ctx.target.team_name || ctx.target.team_id,
    record_scope: ctx.turn.kind === "BAN" ? "OPPOSING_TEAM" : "ACTING_TEAM",
    season_evidence: ctx.seasonEvidence, selected: withRoles(selected), alternatives: alternatives.map(withRoles),
  };
}

function soloContext(input: SoloDraftInput) {
  const { report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide } = input;
  if (!blueTeam || !redTeam || !blueTeam.team_id || !redTeam.team_id || blueTeam.team_id === redTeam.team_id ||
    !["BLUE", "RED"].includes(firstPickSide) || !["BLUE", "RED"].includes(manualSide) ||
    !Array.isArray(selections) || selections.length > 20 || !Array.isArray(previousPicks)) return null;
  const locks = previousPicks.map(canonical);
  if (locks.some(id => !id)) return null;
  const previous = locks as string[];
  let replay: DraftSelection[] = [];
  for (const selection of selections) {
    const expected = nextDraftTurn(replay, firstPickSide);
    const id = canonical(selection?.champion_id);
    if (!expected || !id || selection.turn !== replay.length + 1 || selection.side !== expected.side ||
      selection.kind !== expected.kind || selection.phase !== expected.phase || selection.slot !== expected.slot) return null;
    const next = applyDraftSelection(replay, id, previous, firstPickSide);
    if (next === replay) return null;
    replay = next;
  }
  const turn = nextDraftTurn(replay, firstPickSide);
  if (!turn || turn.side === manualSide) return null;
  const acting = turn.side === "BLUE" ? blueTeam : redTeam;
  const opposing = turn.side === "BLUE" ? redTeam : blueTeam;
  const target = turn.kind === "BAN" ? opposing : acting;
  const legal = (id: string) => applyDraftSelection(replay, id, previous, firstPickSide) !== replay;
  const frame = buildDraftAgentFrame(report, blueTeam, redTeam, replay, previous, firstPickSide);
  const priorities = [...target.priority_picks].sort((a, b) => b.game_rate - a.game_rate ||
    b.phase_1_count - a.phase_1_count || compare(canonical(a.champion_id) ?? a.champion_id, canonical(b.champion_id) ?? b.champion_id));
  const priorityIds = new Set(priorities.map(p => canonical(p.champion_id)).filter(Boolean));

  // A strict hint requires all observed team rows to agree on one recognized role.
  const strictRole = (id: string): string | null => {
    const rows = acting.priority_picks.filter(p => canonical(p.champion_id) === id);
    const roles = new Set(rows.map(p => p.role === "ADC" ? "BOTTOM" : p.role));
    const role = rows[0]?.role === "ADC" ? "BOTTOM" : rows[0]?.role;
    return roles.size === 1 && role && observedRoles.has(role) ? role : null;
  };
  const covered = new Set(replay.filter(s => s.side === turn.side && s.kind === "PICK").map(s => strictRole(s.champion_id)).filter(Boolean));
  const repeatsRole = (id: string) => { const role = strictRole(id); return role !== null && covered.has(role); };
  const roleCandidates = soloRoleCandidates(acting, report, input.seasonHistory);
  const picked = replay.filter(s => s.side === turn.side && s.kind === "PICK").map(s => s.champion_id);
  const candidateById = new Map(roleCandidates.map(row => [row.champion_id, row]));
  const metaRows = report.entries.filter(e => e.eligible_for_review).sort((a, b) => a.rank - b.rank || compare(a.champion_id, b.champion_id));
  const metaIds = [...new Set(metaRows.map(e => canonical(e.champion_id)).filter((id): id is string => !!id))];
  const metaSet = new Set(metaIds);
  const rolePool = [...roleCandidates, ...metaRows.flatMap(e => {
    const id = canonical(e.champion_id), role = e.role === "ADC" ? "BOTTOM" : e.role;
    return id && observedRoles.has(role) ? [{ champion_id: id, roles: [role as import("./roster-scenario").RosterRole], score: 0, season: false }] : [];
  })];
  const roleFeasible = (id: string) => canCoverRoles(picked, rolePool, id);
  const rolesOf = (id: string) => [...new Set(rolePool.filter(row => row.champion_id === id).flatMap(row => row.roles))];
  // Fixed, untuned scores: presence = (picks + bans) / same-patch matches; the blend adds the opposing
  // team's observed game rate for that champion. Ties break by canonical id.
  const presenceRows = report.patch_presence && report.patch_presence.patch_id === report.patch_id && report.patch_presence.match_count > 0
    ? report.patch_presence : null;
  const banPolicy = input.banPolicy ?? DEFAULT_BAN_POLICY;
  const presenceBan = turn.kind === "BAN" && banPolicy !== "OPPONENT_RECORD" && presenceRows ? (available: (id: string) => boolean) => {
    const scores = new Map<string, number>();
    for (const row of presenceRows.champions) {
      const id = canonical(row.champion_id);
      if (id) scores.set(id, (scores.get(id) ?? 0) + (row.picks + row.bans) / presenceRows.match_count);
    }
    if (banPolicy === "PATCH_PRESENCE_WITH_OPPONENT") for (const p of target.priority_picks) {
      const id = canonical(p.champion_id);
      if (id) scores.set(id, (scores.get(id) ?? 0) + p.game_rate);
    }
    return [...scores.entries()].filter(([id]) => available(id)).sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0]?.[0] ?? null;
  } : null;
  const select = (excluded: ReadonlySet<string>): SoloDraftSuggestion | null => {
  // Exclusions only narrow availability; replay and Fearless legality stay in `legal`.
  const available = (id: string) => !excluded.has(id) && legal(id);
  const records = [...new Set([
    ...frame.options.map(o => canonical(o.champion_id)).filter((id): id is string => !!id && priorityIds.has(id)),
    ...priorities.map(p => canonical(p.champion_id)).filter((id): id is string => !!id),
  ])].filter(available);
  // Current review-eligible meta first; season familiarity is a separate fallback, never patch strength.
  const expanded = [...new Set([...records.filter(id => metaSet.has(id)), ...metaIds, ...records, ...roleCandidates.map(row => row.champion_id)])].filter(available);
  const record = turn.kind === "PICK" ? expanded.find(roleFeasible) ?? records.find(id => !repeatsRole(id)) ?? expanded[0] : records[0];
  const finish = (choice: SoloDraftSuggestion): SoloDraftSuggestion => {
    if (turn.kind !== "PICK") return choice;
    const supported = roleFeasible(choice.champion_id);
    return { ...choice, role_supported: supported, reason: supported ? choice.reason : `${choice.reason} 남은 후보의 포지션 근거가 부족해 조합 구성을 보장하지 않습니다.` };
  };
  if (record && turn.kind === "PICK" && metaSet.has(record) && !priorityIds.has(record)) return finish({
    champion_id: record, source: "RADAR", reason: "현재 레이더의 검토 가능 메타와 남은 포지션을 참고한 연습 픽입니다. 선수의 실제 선택을 예측하지 않습니다.",
  });
  if (record && turn.kind === "PICK" && candidateById.get(record)?.season) return finish({
    champion_id: record, source: "PLAYER_SEASON", reason: "현재 관측 선수의 같은 팀·시즌 역할별 기록과 남은 포지션을 참고한 연습 픽입니다. 시즌 기록은 현재 패치의 강함을 뜻하지 않습니다.",
  });
  if (turn.kind === "BAN" && presenceBan) {
    const ban = presenceBan(available);
    if (ban) return { champion_id: ban, source: "PATCH_PRESENCE", reason: "같은 패치의 공개 픽·밴 빈도를 참고한 연습 밴입니다. 실제 팀의 선택을 예측하지 않습니다." };
  }
  if (record) return finish({ champion_id: record, source: "TEAM_RECORD", reason: turn.kind === "BAN"
    ? "상대 팀의 공개 우선 픽 기록을 바탕으로 한 연습 밴입니다."
    : "행동 팀의 공개 우선 픽 기록을 바탕으로 한 연습 픽입니다." });
  const radar = [...new Set([
    ...frame.options.map(o => canonical(o.champion_id)),
    ...report.entries.filter(e => e.eligible_for_review).sort((a, b) => a.rank - b.rank || compare(canonical(a.champion_id) ?? a.champion_id, canonical(b.champion_id) ?? b.champion_id)).map(e => canonical(e.champion_id)),
  ])].find((id): id is string => !!id && available(id));
  if (radar) return finish({ champion_id: radar, source: "RADAR", reason: "공개 레이더의 검토 가능 후보를 사용한 연습 선택입니다." });
  const fallback = [...canonicalIds.values()].sort(compare).find(available);
  return fallback ? finish({ champion_id: fallback, source: "FALLBACK", reason: "남은 기록 후보가 없어 고정 챔피언 목록 순서로 선택했습니다." }) : null;
  };
  // Read-only classification of an already-made choice; mirrors the branches above without affecting them.
  const evidenceOf = (choice: SoloDraftSuggestion): SoloDraftEvidence => {
    if (choice.source === "FALLBACK" || choice.source === "PLAYER_SEASON" || choice.source === "PATCH_PRESENCE") return choice.source;
    if (choice.source === "RADAR") return metaSet.has(choice.champion_id) ? "RADAR_META" : "RADAR_FRAME";
    return priorityIds.has(choice.champion_id) || !candidateById.has(choice.champion_id) ? "TEAM_PRIORITY" : "PLAYER_CURRENT";
  };
  return { turn, target, replayLength: replay.length, select, rolesOf, evidenceOf, seasonEvidence: roleCandidates.some(row => row.season) };
}
