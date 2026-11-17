import type { RadarReport } from "./radar-types";
import {
  basisKey,
  buildRosterIndex,
  pairKey,
  playerKey,
  rosterBasis,
  ROSTER_ROLES,
  validateRosters,
  type RosterAssignment,
  type RosterBasis,
  type RosterIndex,
  type RosterRole,
  type RosterState,
} from "./roster-scenario";

/**
 * Virtual rosters inside the draft A/B comparison.
 *
 * A roster is validated against the player observations of the same report the draft is
 * compared on (no on-demand season history), identified by (source team ID, player ID) and keyed
 * by team ID so a side swap keeps its meaning. Captures are detached copies: later roster edits
 * never reach an already frozen A. Nothing here computes a player effect, win rate or simulation.
 */

export const ROSTER_EVIDENCE_SCOPE = "CURRENT_REPORT_PLAYER_OBSERVATIONS";

/** Roster state published by the roster editor, tagged with the basis and pair it belongs to. */
export type LiveRoster = { basis: RosterBasis; teamIds: readonly [string, string]; rosters: RosterState };

export type RosterSlotRecord = RosterAssignment & { player_name: string; source_team_name: string };
export type RosterCapture = {
  basis: RosterBasis;
  /** Sorted team IDs of the pair. */
  team_ids: [string, string];
  teams: Record<string, Record<RosterRole, RosterSlotRecord | null>>;
};

export type RosterSlotChange = { team_id: string; role: RosterRole; a: RosterSlotRecord | null; b: RosterSlotRecord | null };
export type RosterComparison =
  | { status: "NOT_RECORDED" }
  | { status: "PAIR_CHANGED" }
  | { status: "COMPARED"; changes: RosterSlotChange[] };

export type RosterCaptureResult = { ok: true; capture: RosterCapture } | { ok: false; message: string };

const indexCache = new WeakMap<RadarReport, RosterIndex>();
/** Player index of the report's own team records (reports are immutable studio values). */
export function rosterIndexOf(report: RadarReport) {
  let index = indexCache.get(report);
  if (!index) { index = buildRosterIndex(report.opponent_prep?.teams ?? []); indexCache.set(report, index); }
  return index;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validBasisShape(value: unknown): value is RosterBasis {
  return isObject(value) && typeof value.patch_id === "string" && typeof value.cutoff === "string" && typeof value.fixture_only === "boolean" &&
    Array.isArray(value.source_versions) && value.source_versions.every((item) => typeof item === "string");
}

/**
 * Detached capture of a roster for exactly this pair, re-validated with the report's index:
 * unknown/ambiguous IDs and a player in two slots are rejected, empty slots are kept.
 */
export function captureRoster(report: RadarReport, teamIds: readonly string[], basis: unknown, rosters: unknown): RosterCaptureResult {
  if (!validBasisShape(basis) || basisKey(basis) !== basisKey(rosterBasis(report))) {
    return { ok: false, message: "로스터의 자료 기준(패치·cutoff·출처)이 현재 분석 데이터와 다릅니다." };
  }
  const index = rosterIndexOf(report);
  const validated = validateRosters(rosters, teamIds, index);
  if (!validated.ok) return { ok: false, message: validated.error };
  const sorted = teamIds.slice().sort() as [string, string];
  const teams: RosterCapture["teams"] = {};
  for (const teamId of sorted) {
    const slots = validated.value[teamId];
    teams[teamId] = Object.fromEntries(ROSTER_ROLES.map((role) => {
      const assigned = slots[role];
      const player = assigned ? index.players.get(playerKey(assigned.source_team_id, assigned.player_id)) : undefined;
      return [role, assigned && player ? { source_team_id: assigned.source_team_id, player_id: assigned.player_id,
        player_name: player.player_name, source_team_name: player.source_team_name } : null];
    })) as Record<RosterRole, RosterSlotRecord | null>;
  }
  const expected = rosterBasis(report);
  return { ok: true, capture: { basis: { ...expected, source_versions: [...expected.source_versions] }, team_ids: sorted, teams } };
}

const sameSlot = (left: RosterSlotRecord | null, right: RosterSlotRecord | null) =>
  left === right || Boolean(left && right && left.source_team_id === right.source_team_id && left.player_id === right.player_id);

/** Compare by team ID and role, never by side, so a side swap alone is not a roster change. */
export function compareRosterCaptures(a: RosterCapture | null, b: RosterCapture | null): RosterComparison {
  if (!a || !b) return { status: "NOT_RECORDED" };
  if (pairKey(a.team_ids) !== pairKey(b.team_ids)) return { status: "PAIR_CHANGED" };
  const changes: RosterSlotChange[] = [];
  for (const teamId of a.team_ids) for (const role of ROSTER_ROLES) {
    const before = a.teams[teamId]?.[role] ?? null;
    const after = b.teams[teamId]?.[role] ?? null;
    if (!sameSlot(before, after)) changes.push({ team_id: teamId, role, a: before, b: after });
  }
  return { status: "COMPARED", changes };
}

const assignmentRecord = (slot: RosterSlotRecord | null) => slot ? { source_team_id: slot.source_team_id, player_id: slot.player_id } : null;

/** File form of a capture. `player_name` is a label checked against the embedded report on replay. */
export function rosterExport(capture: RosterCapture) {
  return {
    evidence_scope: ROSTER_EVIDENCE_SCOPE,
    basis: capture.basis,
    rosters: Object.fromEntries(capture.team_ids.map((teamId) => [teamId, Object.fromEntries(ROSTER_ROLES.map((role) => {
      const slot = capture.teams[teamId][role];
      return [role, slot ? { source_team_id: slot.source_team_id, player_id: slot.player_id, player_name: slot.player_name } : null];
    }))])),
  };
}

export function rosterComparisonRecord(comparison: RosterComparison) {
  return comparison.status === "COMPARED"
    ? { status: comparison.status, changes: comparison.changes.map((change) => ({ team_id: change.team_id, role: change.role, a: assignmentRecord(change.a), b: assignmentRecord(change.b) })) }
    : { status: comparison.status };
}

/**
 * Untrusted file roster → `{ basis, rosters }` for `captureRoster`. Requires the recorded scope and
 * display labels to match the embedded report, so an edited name or scope is reported as tampering.
 */
export function parseRosterExport(raw: unknown, report: RadarReport): { ok: true; basis: unknown; rosters: unknown } | { ok: false; message: string } {
  if (!isObject(raw)) return { ok: false, message: "로스터 기록이 없습니다." };
  if (raw.evidence_scope !== ROSTER_EVIDENCE_SCOPE) return { ok: false, message: "로스터 근거 범위가 지원하는 형식이 아닙니다." };
  if (!isObject(raw.rosters)) return { ok: false, message: "로스터 형식이 올바르지 않습니다." };
  const index = rosterIndexOf(report);
  for (const slots of Object.values(raw.rosters)) {
    if (!isObject(slots)) continue; // shape is reported by validateRosters
    for (const slot of Object.values(slots)) {
      if (!isObject(slot)) continue;
      const player = typeof slot.source_team_id === "string" && typeof slot.player_id === "string"
        ? index.players.get(playerKey(slot.source_team_id, slot.player_id)) : undefined;
      if (player && slot.player_name !== player.player_name) return { ok: false, message: `선수 표시 이름이 파일 안의 분석 데이터와 다릅니다: ${slot.player_id}` };
    }
  }
  return { ok: true, basis: raw.basis, rosters: raw.rosters };
}
