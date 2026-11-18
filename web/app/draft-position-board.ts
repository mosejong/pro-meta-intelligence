import { championAssetId } from "./champion-assets";
import { championKey, emptyChampionRoles, teamPicks, type ChampionRoles } from "./champion-roles";
import type { DraftSelection, DraftSide } from "./draft-agent";
import type { OpponentTeam } from "./radar-types";
import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";

export type DraftPosition = {
  role: RosterRole;
  champion_id: string | null;
  selection: DraftSelection | null;
  source: "ASSIGNED" | "SUGGESTED" | "EMPTY";
  observed_roles: RosterRole[];
};

function ownPickMap(picks: readonly string[]) {
  const result = new Map<string, string>();
  for (const id of picks) {
    if (typeof id !== "string" || !id.trim()) continue;
    const key = championKey(id);
    if (!result.has(key)) result.set(key, championAssetId(id));
  }
  return result;
}

/** Keep only own picks, retaining the first explicit role in roster order for duplicates. */
export function reconcileChampionRoles(current: ChampionRoles, picks: string[]): ChampionRoles {
  const own = ownPickMap(picks);
  const result = emptyChampionRoles();
  const used = new Set<string>();
  for (const role of ROSTER_ROLES) {
    const value = current[role];
    if (typeof value !== "string") continue;
    const key = championKey(value);
    const id = own.get(key);
    if (id && !used.has(key)) {
      result[role] = id;
      used.add(key);
    }
  }
  return result;
}

/** Invalid champion/role requests return an unchanged copy. Valid requests also prune stale refs. */
export function moveChampionRole(current: ChampionRoles, championId: string, role: RosterRole | null, picks: string[]): ChampionRoles {
  const own = ownPickMap(picks);
  const id = typeof championId === "string" ? own.get(championKey(championId)) : undefined;
  if (!id || (role !== null && !ROSTER_ROLES.includes(role))) return { ...current };
  const result = reconcileChampionRoles(current, picks);
  const source = ROSTER_ROLES.find((position) => result[position] !== null && championKey(result[position]!) === championKey(id));
  if (source === role) return result;
  if (source) result[source] = role === null ? null : result[role];
  if (role !== null) result[role] = id;
  return result;
}

/** Suggestions are display-only; callers must explicitly persist/validate assignments. */
export function buildDraftPositionBoard({ team, side, selections, assignments, unassigned: clearedPicks = [] }: {
  team: OpponentTeam | null;
  side: DraftSide;
  selections: readonly DraftSelection[];
  assignments: ChampionRoles;
  /** Explicitly cleared picks must not be suggested again. */
  unassigned?: readonly string[];
}): { positions: DraftPosition[]; unassigned: Array<{ selection: DraftSelection; observed_roles: RosterRole[] }>; canConfirm: boolean } {
  const picks = teamPicks(selections, side);
  const own = ownPickMap(picks);
  const confirmed = new Map<string, DraftSelection>();
  for (const selection of [...selections].sort((a, b) => a.slot - b.slot || a.turn - b.turn)) {
    if (selection.kind !== "PICK" || selection.side !== side) continue;
    const key = championKey(selection.champion_id);
    if (own.has(key) && !confirmed.has(key)) confirmed.set(key, selection);
  }
  const suppressed = new Set(clearedPicks.map(championKey));
  const hints = new Map<string, Set<RosterRole>>();
  const add = (id: string, rawRole: string | undefined, count: number) => {
    const role = rawRole === "ADC" ? "BOTTOM" : rawRole;
    if (!Number.isFinite(count) || count <= 0 || !ROSTER_ROLES.includes(role as RosterRole)) return;
    const key = championKey(id);
    const roles = hints.get(key) ?? new Set<RosterRole>();
    roles.add(role as RosterRole);
    hints.set(key, roles);
  };
  for (const row of team?.priority_picks ?? []) add(row.champion_id, row.role, row.game_count);
  for (const player of team?.player_profiles ?? []) {
    for (const row of player.champions) add(row.champion_id, player.role, row.game_count);
  }
  const observed = (key: string) => ROSTER_ROLES.filter((role) => hints.get(key)?.has(role));
  const explicit = reconcileChampionRoles(assignments, picks);
  const used = new Set(Object.values(explicit).filter((id): id is string => id !== null).map(championKey));
  const pending = [...confirmed].filter(([key]) => !used.has(key));
  const positions: DraftPosition[] = ROSTER_ROLES.map((role) => {
    const id = explicit[role];
    if (id) return { role, champion_id: id, selection: confirmed.get(championKey(id))!, source: "ASSIGNED", observed_roles: observed(championKey(id)) };
    const contenders = pending.filter(([key]) => !suppressed.has(key) && hints.get(key)?.has(role));
    if (contenders.length === 1 && observed(contenders[0][0]).length === 1) {
      const [key, selection] = contenders[0];
      used.add(key);
      return { role, champion_id: own.get(key)!, selection, source: "SUGGESTED", observed_roles: observed(key) };
    }
    return { role, champion_id: null, selection: null, source: "EMPTY", observed_roles: [] };
  });
  const unassigned = [...confirmed].filter(([key]) => !used.has(key)).map(([key, selection]) => ({ selection, observed_roles: observed(key) }));
  return { positions, unassigned, canConfirm: confirmed.size === ROSTER_ROLES.length && unassigned.length === 0 && positions.every((position) => position.selection !== null) };
}
