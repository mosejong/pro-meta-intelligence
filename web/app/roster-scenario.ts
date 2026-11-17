import type { OpponentPlayerProfile, OpponentTeam, RadarReport } from "./radar-types";

/**
 * Virtual roster/position scenario (roster-scenario v1).
 *
 * Players are identified only by (source team ID, player ID) from one public snapshot; names are
 * display labels and never merge players. `roster_status=CURRENT` is the snapshot's observation
 * label, not an official current-roster claim. A role is filled by default only when exactly one
 * CURRENT observation exists for it; anything ambiguous stays empty for the user to choose.
 * Nothing here feeds analysis, recommendations or simulations yet, and inputs are never mutated.
 */

export const ROSTER_ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"] as const;
export type RosterRole = (typeof ROSTER_ROLES)[number];
export const ROSTER_SCENARIO_ARTIFACT = "roster-scenario";
export const ROSTER_SCENARIO_VERSION = 1;
export const MAX_ROSTER_FILE_BYTES = 64 * 1024;

export type RosterBasis = {
  patch_id: string;
  cutoff: string;
  fixture_only: boolean;
  /** Sorted `source_id@source_version#content_hash` entries of the snapshot. */
  source_versions: string[];
};

export type RosterAssignment = { source_team_id: string; player_id: string };
export type RosterSlots = Record<RosterRole, RosterAssignment | null>;
/** Rosters keyed by team ID, so swapping sides keeps every team's lineup. */
export type RosterState = Record<string, RosterSlots>;

export type RosterScenario = {
  basis: RosterBasis;
  /** Sorted pair; side order is not part of a roster scenario. */
  team_ids: [string, string];
  rosters: RosterState;
};

export type RosterPlayer = {
  key: string;
  source_team_id: string;
  source_team_name: string;
  player_id: string;
  player_name: string;
  observed_role: string;
  roster_status: OpponentPlayerProfile["roster_status"] | null;
  game_count: number;
};

export type RosterIndex = {
  players: Map<string, RosterPlayer>;
  /** (team, player) keys observed more than once in one team: unsafe to select. */
  ambiguous: Set<string>;
  /** Player names shared by more than one player ID (shown with their IDs). */
  collidingNames: Set<string>;
};

export type RosterErrorCode =
  | "TOO_LARGE" | "INVALID_JSON" | "WRONG_TYPE" | "FUTURE_VERSION" | "BAD_VERSION" | "BAD_SHAPE"
  | "BASIS_MISMATCH" | "TEAM_MISMATCH" | "UNKNOWN_PLAYER" | "AMBIGUOUS_PLAYER" | "DUPLICATE_PLAYER";

export type RosterResult<T> = { ok: true; value: T } | { ok: false; code: RosterErrorCode; error: string };

type RosterFailure = { ok: false; code: RosterErrorCode; error: string };
const fail = (code: RosterErrorCode, error: string): RosterFailure => ({ ok: false, code, error });

export const playerKey = (sourceTeamId: string, playerId: string) => JSON.stringify([sourceTeamId, playerId]);
export const isRosterRole = (value: unknown): value is RosterRole => ROSTER_ROLES.includes(value as RosterRole);

export function rosterBasis(report: Pick<RadarReport, "patch_id" | "cutoff" | "fixture_only" | "evidence_index">): RosterBasis {
  return {
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    fixture_only: report.fixture_only,
    source_versions: (report.evidence_index?.source_versions ?? [])
      .map((source) => `${source.source_id}@${source.source_version}#${source.content_hash}`)
      .sort(),
  };
}

export const basisKey = (basis: RosterBasis) => JSON.stringify([basis.patch_id, basis.cutoff, basis.fixture_only, basis.source_versions]);
export const pairKey = (teamIds: readonly string[]) => JSON.stringify(teamIds.slice().sort());

export function buildRosterIndex(teams: readonly OpponentTeam[]): RosterIndex {
  const players = new Map<string, RosterPlayer>();
  const ambiguous = new Set<string>();
  const namesToIds = new Map<string, Set<string>>();
  for (const team of teams) {
    for (const profile of team.player_profiles ?? []) {
      if (!profile.player_id) continue;
      const key = playerKey(team.team_id, profile.player_id);
      if (players.has(key)) { ambiguous.add(key); continue; }
      players.set(key, {
        key,
        source_team_id: team.team_id,
        source_team_name: team.team_name,
        player_id: profile.player_id,
        player_name: profile.player_name,
        observed_role: profile.role,
        roster_status: profile.roster_status ?? null,
        game_count: profile.game_count,
      });
      const name = profile.player_name.toLocaleLowerCase("en-US");
      namesToIds.set(name, (namesToIds.get(name) ?? new Set()).add(profile.player_id));
    }
  }
  for (const key of ambiguous) players.delete(key);
  const collidingNames = new Set([...namesToIds].filter(([, ids]) => ids.size > 1).map(([name]) => name));
  return { players, ambiguous, collidingNames };
}

export const emptySlots = (): RosterSlots => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });

/**
 * Observed starting lineup per team: a role is filled only by a unique, unambiguous CURRENT
 * observation of that team. A player observed CURRENT in several roles, or placed by both teams
 * of the pair, is left out everywhere instead of being forced into one slot.
 */
export function observedRosters(teams: readonly OpponentTeam[], teamIds: readonly string[], index: RosterIndex): RosterState {
  const state: RosterState = {};
  for (const teamId of teamIds) {
    const slots = emptySlots();
    const team = teams.find((candidate) => candidate.team_id === teamId);
    const current = [...index.players.values()].filter((player) => player.source_team_id === teamId && player.roster_status === "CURRENT");
    const unsafe = new Set([...index.ambiguous].filter((key) => (JSON.parse(key) as string[])[0] === teamId).map((key) => (JSON.parse(key) as string[])[1]));
    for (const role of ROSTER_ROLES) {
      const candidates = current.filter((player) => player.observed_role === role);
      const ambiguousHere = (team?.player_profiles ?? []).some((profile) => profile.role === role && unsafe.has(profile.player_id));
      if (candidates.length === 1 && !ambiguousHere) slots[role] = { source_team_id: teamId, player_id: candidates[0].player_id };
    }
    state[teamId] = slots;
  }
  const counts = new Map<string, number>();
  for (const slots of Object.values(state)) for (const role of ROSTER_ROLES) {
    const assigned = slots[role];
    if (assigned) counts.set(assigned.player_id, (counts.get(assigned.player_id) ?? 0) + 1);
  }
  for (const slots of Object.values(state)) for (const role of ROSTER_ROLES) {
    const assigned = slots[role];
    if (assigned && (counts.get(assigned.player_id) ?? 0) > 1) slots[role] = null;
  }
  return state;
}

export const sameAssignment = (left: RosterAssignment | null, right: RosterAssignment | null) =>
  left === right || Boolean(left && right && left.source_team_id === right.source_team_id && left.player_id === right.player_id);

export type SlotStatus = {
  player: RosterPlayer | null;
  changed: boolean;
  /** Player observed for a different team in this snapshot. */
  otherTeam: boolean;
  /** Player observed in a different role. */
  roleMoved: boolean;
  /** Player's snapshot label is not CURRENT for the source team. */
  notCurrent: boolean;
  virtual: boolean;
};

export function slotStatus(teamId: string, role: RosterRole, assigned: RosterAssignment | null, observed: RosterAssignment | null, index: RosterIndex): SlotStatus {
  const player = assigned ? index.players.get(playerKey(assigned.source_team_id, assigned.player_id)) ?? null : null;
  const otherTeam = Boolean(player && player.source_team_id !== teamId);
  const roleMoved = Boolean(player && player.observed_role !== role);
  const notCurrent = Boolean(player && player.roster_status !== "CURRENT");
  return { player, changed: !sameAssignment(assigned, observed), otherTeam, roleMoved, notCurrent, virtual: otherTeam || roleMoved };
}

/**
 * Place a player (or clear with null). A player already placed elsewhere in the pair is moved:
 * the previous slot is emptied, so no player ever appears twice. Returns a new state.
 */
export function assignSlot(state: RosterState, teamId: string, role: RosterRole, assignment: RosterAssignment | null, index: RosterIndex): RosterResult<{ state: RosterState; movedFrom: { teamId: string; role: RosterRole } | null }> {
  if (!state[teamId] || !isRosterRole(role)) return fail("TEAM_MISMATCH", "현재 팀 쌍에 없는 슬롯입니다.");
  if (assignment) {
    const key = playerKey(assignment.source_team_id, assignment.player_id);
    if (index.ambiguous.has(key)) return fail("AMBIGUOUS_PLAYER", "같은 팀에 중복 관측된 선수 ID라 선택할 수 없습니다.");
    if (!index.players.has(key)) return fail("UNKNOWN_PLAYER", "현재 공개 스냅샷에서 관측되지 않은 선수입니다.");
  }
  const next: RosterState = Object.fromEntries(Object.entries(state).map(([id, slots]) => [id, { ...slots }]));
  let movedFrom: { teamId: string; role: RosterRole } | null = null;
  if (assignment) for (const [id, slots] of Object.entries(next)) for (const slotRole of ROSTER_ROLES) {
    if ((id !== teamId || slotRole !== role) && slots[slotRole]?.player_id === assignment.player_id) {
      slots[slotRole] = null;
      movedFrom = { teamId: id, role: slotRole };
    }
  }
  next[teamId][role] = assignment ? { source_team_id: assignment.source_team_id, player_id: assignment.player_id } : null;
  return { ok: true, value: { state: next, movedFrom } };
}

/** Validate shape, IDs and duplicates of rosters for exactly the given pair. */
export function validateRosters(value: unknown, teamIds: readonly string[], index: RosterIndex): RosterResult<RosterState> {
  if (!isRecord(value)) return fail("BAD_SHAPE", "로스터 형식이 올바르지 않습니다.");
  const keys = Object.keys(value).sort();
  if (pairKey(keys) !== pairKey(teamIds) || keys.length !== 2) return fail("TEAM_MISMATCH", "현재 팀 조합과 다른 로스터입니다.");
  const state: RosterState = {};
  const seen = new Set<string>();
  for (const teamId of keys) {
    const slots = value[teamId];
    if (!isRecord(slots) || Object.keys(slots).length !== ROSTER_ROLES.length || !ROSTER_ROLES.every((role) => role in slots)) {
      return fail("BAD_SHAPE", "포지션 슬롯 형식이 올바르지 않습니다.");
    }
    const parsed = emptySlots();
    for (const role of ROSTER_ROLES) {
      const slot = slots[role];
      if (slot === null) continue;
      if (!isRecord(slot) || typeof slot.source_team_id !== "string" || typeof slot.player_id !== "string" || !slot.source_team_id || !slot.player_id) {
        return fail("BAD_SHAPE", "선수 슬롯에 source team ID와 player ID가 필요합니다.");
      }
      const key = playerKey(slot.source_team_id, slot.player_id);
      if (index.ambiguous.has(key)) return fail("AMBIGUOUS_PLAYER", `중복 관측으로 확인할 수 없는 선수 ID입니다: ${slot.player_id}`);
      if (!index.players.has(key)) return fail("UNKNOWN_PLAYER", `현재 공개 스냅샷에서 확인할 수 없는 선수입니다: ${slot.player_id}`);
      if (seen.has(slot.player_id)) return fail("DUPLICATE_PLAYER", `같은 선수가 두 슬롯에 있습니다: ${slot.player_id}`);
      seen.add(slot.player_id);
      parsed[role] = { source_team_id: slot.source_team_id, player_id: slot.player_id };
    }
    state[teamId] = parsed;
  }
  return { ok: true, value: state };
}

export function serializeRosterScenario(scenario: RosterScenario, index: RosterIndex) {
  const rosters: Record<string, Record<RosterRole, (RosterAssignment & { player_name: string }) | null>> = {};
  for (const teamId of scenario.team_ids) {
    const slots = scenario.rosters[teamId] ?? emptySlots();
    rosters[teamId] = Object.fromEntries(ROSTER_ROLES.map((role) => {
      const assigned = slots[role];
      const player = assigned ? index.players.get(playerKey(assigned.source_team_id, assigned.player_id)) : undefined;
      return [role, assigned ? { ...assigned, player_name: player?.player_name ?? "" } : null];
    })) as Record<RosterRole, (RosterAssignment & { player_name: string }) | null>;
  }
  return JSON.stringify({
    artifact_type: ROSTER_SCENARIO_ARTIFACT,
    schema_version: ROSTER_SCENARIO_VERSION,
    basis: scenario.basis,
    team_ids: scenario.team_ids.slice().sort(),
    rosters,
    boundary: "공개 스냅샷 관측 기반 가상 로스터입니다. 공식 소속 확인이 아니며 분석·추천·시뮬레이션에 아직 반영되지 않습니다.",
  }, null, 2);
}

/**
 * Parse a roster-scenario v1 file for the current pair and snapshot. On any failure the caller
 * keeps its current roster. `player_name` is a display label only; IDs decide identity.
 */
export function parseRosterScenario(text: string, expected: { basis: RosterBasis; teamIds: readonly string[]; index: RosterIndex }): RosterResult<RosterScenario> {
  if (new TextEncoder().encode(text).byteLength > MAX_ROSTER_FILE_BYTES) return fail("TOO_LARGE", "로스터 파일이 64KB를 넘습니다.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("INVALID_JSON", "JSON을 읽을 수 없습니다."); }
  if (!isRecord(value) || value.artifact_type !== ROSTER_SCENARIO_ARTIFACT) return fail("WRONG_TYPE", "로스터 시나리오 파일이 아닙니다.");
  if (typeof value.schema_version !== "number" || !Number.isInteger(value.schema_version) || value.schema_version < 1) return fail("BAD_VERSION", "로스터 파일 버전이 올바르지 않습니다.");
  if (value.schema_version > ROSTER_SCENARIO_VERSION) return fail("FUTURE_VERSION", "이 앱보다 새 버전의 로스터 파일입니다.");
  const basis = value.basis;
  if (!isRecord(basis) || typeof basis.patch_id !== "string" || typeof basis.cutoff !== "string" || typeof basis.fixture_only !== "boolean" ||
    !Array.isArray(basis.source_versions) || !basis.source_versions.every((item) => typeof item === "string")) {
    return fail("BAD_SHAPE", "로스터 파일의 근거 정보 형식이 올바르지 않습니다.");
  }
  const parsedBasis: RosterBasis = { patch_id: basis.patch_id, cutoff: basis.cutoff, fixture_only: basis.fixture_only, source_versions: [...basis.source_versions as string[]] };
  if (basisKey(parsedBasis) !== basisKey(expected.basis)) return fail("BASIS_MISMATCH", "패치·cutoff·출처가 현재 자료와 다른 로스터 파일입니다.");
  if (!Array.isArray(value.team_ids) || value.team_ids.length !== 2 || !value.team_ids.every((id) => typeof id === "string")) {
    return fail("BAD_SHAPE", "팀 ID 형식이 올바르지 않습니다.");
  }
  if (pairKey(value.team_ids as string[]) !== pairKey(expected.teamIds)) return fail("TEAM_MISMATCH", "현재 팀 조합과 다른 로스터 파일입니다.");
  const rosters = validateRosters(value.rosters, expected.teamIds, expected.index);
  if (!rosters.ok) return rosters;
  const teamIds = expected.teamIds.slice().sort() as [string, string];
  return { ok: true, value: { basis: parsedBasis, team_ids: teamIds, rosters: rosters.value } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
