import { championKey, emptyChampionRoles, teamPicks, type ChampionRoles } from "./champion-roles";
import type { DraftSelection, DraftSide } from "./draft-agent";
import { ROSTER_ROLES } from "./roster-scenario";

/**
 * Explicit position work of the current game only, keyed by team ID.
 * `roles` holds only user-made assignments (never display-only suggestions);
 * `unassigned` holds picks the user explicitly cleared so they are not suggested again.
 */
export type DraftTeamPositions = { roles: ChampionRoles; unassigned: string[] };
export type DraftPositionRecord = Record<string, DraftTeamPositions>;

type Matchup = { blueTeamId: string; redTeamId: string; selections: readonly DraftSelection[] };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
/** Own-property read only: inherited (prototype) values never count as assignments. */
const ownValue = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
/** Own enumerable data property even for keys like "__proto__" (plain assignment would hit the setter). */
const putOwn = <T>(target: Record<string, T>, key: string, value: T) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
const sides = (m: Matchup) => [["BLUE", m.blueTeamId], ["RED", m.redTeamId]] as const satisfies ReadonlyArray<readonly [DraftSide, string]>;

/** Normalize one team's work against its own current picks (asset IDs); stale/foreign IDs are dropped. */
function normalizeTeam(rawRoles: unknown, rawUnassigned: unknown, picks: string[]): DraftTeamPositions | null {
  const own = new Map(picks.map((id) => [championKey(id), id]));
  const roles = emptyChampionRoles();
  const used = new Set<string>();
  for (const role of ROSTER_ROLES) {
    const value = ownValue(rawRoles, role);
    const id = typeof value === "string" ? own.get(championKey(value)) : undefined;
    if (id && !used.has(championKey(id))) { roles[role] = id; used.add(championKey(id)); }
  }
  const unassigned: string[] = [];
  for (const value of Array.isArray(rawUnassigned) ? rawUnassigned : []) {
    const id = typeof value === "string" ? own.get(championKey(value)) : undefined;
    if (id && !used.has(championKey(id))) { unassigned.push(id); used.add(championKey(id)); }
  }
  return used.size ? { roles, unassigned } : null;
}

/**
 * Canonical record of the current matchup's explicit position work, or null when there is none.
 * Only the two current team IDs and their own current-game picks are kept.
 */
export function normalizeDraftPositions(
  roles: Record<string, ChampionRoles | undefined>,
  unassigned: Record<string, readonly string[] | undefined>,
  matchup: Matchup,
): DraftPositionRecord | null {
  const result: DraftPositionRecord = {};
  for (const [side, teamId] of sides(matchup)) {
    const team = normalizeTeam(ownValue(roles, teamId), ownValue(unassigned, teamId), teamPicks(matchup.selections, side));
    if (team) putOwn(result, teamId, team);
  }
  return Object.keys(result).length ? result : null;
}

/**
 * Strictly validate an untrusted serialized record. Any problem (other team, unknown role,
 * champion that is not the team's own current pick, duplicate, bad list) rejects the whole record.
 */
export function parseDraftPositions(raw: unknown, matchup: Matchup): DraftPositionRecord | null {
  if (!record(raw) || matchup.blueTeamId === matchup.redTeamId) return null;
  const allowed = new Map(sides(matchup).map(([side, id]) => [id, side]));
  if (Object.keys(raw).some((id) => !allowed.has(id))) return null;
  const result: DraftPositionRecord = {};
  for (const [teamId, side] of allowed) {
    if (!Object.hasOwn(raw, teamId)) continue;
    // Every read below is an own property (exactKeys/ownValue): prototypes never supply data.
    const team = ownValue(raw, teamId);
    if (!record(team) || !exactKeys(team, ["roles", "unassigned"])) return null;
    const teamRoles = ownValue(team, "roles");
    const teamUnassigned = ownValue(team, "unassigned");
    if (!record(teamRoles) || !exactKeys(teamRoles, ROSTER_ROLES) ||
      !Array.isArray(teamUnassigned) || teamUnassigned.length > ROSTER_ROLES.length) return null;
    const own = new Map(teamPicks(matchup.selections, side).map((id) => [championKey(id), id]));
    const seen = new Set<string>();
    const take = (value: unknown) => {
      if (typeof value !== "string" || value.length > 80) return null;
      const id = own.get(championKey(value));
      if (!id || seen.has(championKey(id))) return null;
      seen.add(championKey(id));
      return id;
    };
    const roles = emptyChampionRoles();
    for (const role of ROSTER_ROLES) {
      const value = ownValue(teamRoles, role);
      if (value === null) continue;
      const id = take(value);
      if (!id) return null;
      roles[role] = id;
    }
    const unassigned: string[] = [];
    for (const value of teamUnassigned) {
      const id = take(value);
      if (!id) return null;
      unassigned.push(id);
    }
    if (seen.size) putOwn(result, teamId, { roles, unassigned });
  }
  return result;
}
