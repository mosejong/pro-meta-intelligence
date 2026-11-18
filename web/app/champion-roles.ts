import { championAssetId } from "./champion-assets";
import type { DraftSelection, DraftSide } from "./draft-agent";
import { pairKey, ROSTER_ROLES, type RosterRole } from "./roster-scenario";

/**
 * Explicit, user-assigned champion roles of one completed set (shared by the simulation input gate
 * and the A/B comparison). Roles are never inferred from pick order, champion names, the other
 * team's picks, bans or earlier games: every role needs exactly one of that team's own five picks.
 * Kept in its own module so the comparison and the scenario file can both validate roles without
 * importing each other.
 */

/** Champion (Data Dragon asset id) per role for one team; null = not assigned yet. */
export type ChampionRoles = Record<RosterRole, string | null>;
/** Keyed by team ID so a side swap never moves a role assignment to the other team. */
export type RoleAssignments = Record<string, ChampionRoles>;
/** Complete, validated role → champion assignment of each team, keyed by team ID. */
export type TeamRoles = Record<string, Record<RosterRole, string>>;

export type RoleIssueCode = "ROLE_SHAPE" | "ROLE_UNASSIGNED" | "ROLE_NOT_TEAM_PICK" | "ROLE_DUPLICATE";
export type RoleIssue = { code: RoleIssueCode; message: string; teamId?: string; role?: RosterRole };
export type RoleValidation = { ok: true; roles: TeamRoles } | { ok: false; issues: RoleIssue[] };

type RoleDraftShape = { teams: Record<DraftSide, { id: string; name: string }>; selections: readonly DraftSelection[] };

export const roleLabel: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
export const championKey = (id: string) => championAssetId(id).toLowerCase();

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const emptyChampionRoles = (): ChampionRoles => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });

/** The team's own picks in this game only (by the side it plays now). */
export function teamPicks(selections: readonly DraftSelection[], side: DraftSide) {
  return selections.filter((selection) => selection?.kind === "PICK" && selection.side === side)
    .sort((left, right) => left.slot - right.slot).map((selection) => championAssetId(selection.champion_id));
}

/**
 * Validate explicit role assignments against the draft's actual picks for each team ID.
 * Every role needs exactly one of that team's five picks; no champion twice, none missing.
 * The result is a fresh copy (asset ids), never a reference to the input.
 */
export function validateRoles(raw: unknown, draft: RoleDraftShape): RoleValidation {
  const ids = [draft.teams.BLUE.id, draft.teams.RED.id];
  if (!isObject(raw) || pairKey(Object.keys(raw)) !== pairKey(ids) || Object.keys(raw).length !== 2) {
    return { ok: false, issues: [{ code: "ROLE_SHAPE", message: "역할 배정이 현재 두 팀과 맞지 않습니다." }] };
  }
  const issues: RoleIssue[] = [];
  const roles: TeamRoles = {};
  for (const side of ["BLUE", "RED"] as const) {
    const team = draft.teams[side];
    const slots = raw[team.id];
    if (!isObject(slots) || !exactKeys(slots, ROSTER_ROLES)) {
      issues.push({ code: "ROLE_SHAPE", teamId: team.id, message: `${team.name}: 역할 배정 형식이 올바르지 않습니다.` });
      continue;
    }
    const picks = new Map(teamPicks(draft.selections, side).map((id) => [championKey(id), id]));
    const seen = new Set<string>();
    const parsed: Partial<Record<RosterRole, string>> = {};
    for (const role of ROSTER_ROLES) {
      const value = slots[role];
      if (value === null || value === "") {
        issues.push({ code: "ROLE_UNASSIGNED", teamId: team.id, role, message: `${team.name} ${roleLabel[role]}: 챔피언을 배정하세요.` });
        continue;
      }
      const pick = typeof value === "string" && value.length <= 80 ? picks.get(championKey(value)) : undefined;
      if (!pick) {
        issues.push({ code: "ROLE_NOT_TEAM_PICK", teamId: team.id, role, message: `${team.name} ${roleLabel[role]}: 이 팀이 이번 세트에 픽한 챔피언이 아닙니다.` });
        continue;
      }
      if (seen.has(championKey(pick))) {
        issues.push({ code: "ROLE_DUPLICATE", teamId: team.id, role, message: `${team.name} ${roleLabel[role]}: 같은 챔피언이 두 역할에 있습니다.` });
        continue;
      }
      seen.add(championKey(pick));
      parsed[role] = pick;
    }
    roles[team.id] = parsed as Record<RosterRole, string>;
  }
  return issues.length ? { ok: false, issues } : { ok: true, roles };
}
