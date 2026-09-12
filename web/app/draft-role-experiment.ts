import { championAssetId } from "./champion-assets";
import { previewOpponentPick, STANDARD_DRAFT_SEQUENCE, type DraftSelection } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";

// Frozen before examining the expanded holdout. This is not the deployed model.
export const ROLE_EXPERIMENT_VERSION = "observed-role-feasibility-v1";
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"] as const;
const key = (id: string) => championAssetId(id).toLowerCase();

export function observedChampionRoles(report: RadarReport, team: OpponentTeam) {
  const roles = new Map<string, Set<string>>();
  const add = (champion: string, role: string | undefined) => {
    if (!ROLES.some((known) => known === role)) return;
    const id = key(champion);
    const values = roles.get(id) ?? new Set<string>();
    values.add(role!);
    roles.set(id, values);
  };
  // All observed roles are retained; a flex pick is never fixed to its most frequent role.
  for (const pick of team.priority_picks) add(pick.champion_id, pick.role);
  for (const game of team.recent_games ?? []) for (const pick of game.picks) add(pick.champion_id, pick.role);
  for (const entry of report.entries) if (entry.eligible_for_review) add(entry.champion_id, entry.role);
  return roles;
}

export function canAssignDistinctRoles(champions: string[], roles: Map<string, Set<string>>) {
  if (champions.length > ROLES.length) return false;
  const possibilities = champions.map((id) => [...(roles.get(key(id)) ?? ROLES)].sort())
    .sort((left, right) => left.length - right.length);
  const assign = (index: number, used: Set<string>): boolean => index === possibilities.length ||
    possibilities[index].some((role) => !used.has(role) && assign(index + 1, new Set([...used, role])));
  return assign(0, new Set());
}

export function previewRoleExperiment(report: RadarReport, blue: OpponentTeam, red: OpponentTeam, selections: DraftSelection[], stagedChampion: string, previousPicks: string[] = []) {
  const preview = previewOpponentPick(report, blue, red, selections, stagedChampion, previousPicks, 200);
  if (preview.status !== "READY") return preview;
  const targetSide = STANDARD_DRAFT_SEQUENCE[preview.target_turn! - 1].side;
  const targetTeam = targetSide === "BLUE" ? blue : red;
  const roles = observedChampionRoles(report, targetTeam);
  const ownPicks = selections.filter((item) => item.kind === "PICK" && item.side === targetSide).map((item) => item.champion_id);
  const candidates = preview.candidates.map((candidate, index) => ({ candidate, index,
    feasible: canAssignDistinctRoles([...ownPicks, candidate.champion_id], roles),
  })).sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.index - b.index)
    .slice(0, 3).map(({ candidate }) => candidate);
  return { ...preview, candidates };
}
