import { championAssetId } from "./champion-assets";
import type { SeasonHistory } from "./player-season-history";
import type { OpponentTeam, RadarReport } from "./radar-types";
import { playerKey, ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import { SHARE_CHAMPIONS } from "./share-champion-ids";

export type SoloRoleCandidate = { champion_id: string; roles: RosterRole[]; score: number; season: boolean };

const known = new Map(SHARE_CHAMPIONS.flatMap(([name, id]) =>
  [[championAssetId(name).toLowerCase(), id], [id.toLowerCase(), id]] as [string, string][]));
const canonical = (id: string) => known.get(championAssetId(id).toLowerCase());
const positive = (n: number) => Number.isFinite(n) && n > 0;
const roleOf = (role: string | undefined): RosterRole | undefined => {
  const value = role === "ADC" ? "BOTTOM" : role;
  return ROSTER_ROLES.find(r => r === value);
};

/** Observed current and eligible season evidence, without assigning positions. */
export function soloRoleCandidates(team: OpponentTeam, report: RadarReport, history?: SeasonHistory | null): SoloRoleCandidate[] {
  const candidates = new Map<string, SoloRoleCandidate>();
  const add = (rawId: string, role: RosterRole | undefined, score: number, games: number, season: boolean) => {
    const id = canonical(rawId);
    if (!id || !positive(score) || !positive(games)) return;
    const candidate = candidates.get(id) ?? { champion_id: id, roles: [], score: 0, season: false };
    if (role && !candidate.roles.includes(role)) candidate.roles.push(role);
    candidate.score = Math.max(candidate.score, score);
    candidate.season ||= season;
    candidates.set(id, candidate);
  };
  for (const row of team.priority_picks) add(row.champion_id, roleOf(row.role), row.game_rate, row.game_count, false);
  const players = new Map<RosterRole, Set<string>>();
  for (const profile of team.player_profiles ?? []) {
    if (profile.roster_status !== "CURRENT") continue;
    const role = roleOf(profile.role);
    if (!role) continue;
    const keys = players.get(role) ?? new Set<string>();
    keys.add(playerKey(team.team_id, profile.player_id));
    players.set(role, keys);
    for (const row of profile.champions) add(row.champion_id, role, row.game_rate, row.game_count, false);
  }
  const cutoff = Date.parse(report.cutoff);
  if (history && Number.isFinite(cutoff) && history.cutoff === report.cutoff
      && history.reference_patch === report.patch_id
      && history.season === new Date(cutoff).getUTCFullYear()
      && Number.isFinite(Date.parse(history.source.retrieved_at))
      && Date.parse(history.source.retrieved_at) <= cutoff) {
    for (const [role, keys] of players) {
      if (keys.size !== 1) continue;
      const key = [...keys][0];
      const player = history.players.get(key);
      if (!player || player.status !== "FOUND" || playerKey(player.team_id, player.player_id) !== key) continue;
      const stats = player.roles[role]?.season;
      if (!stats || !positive(stats.games)) continue;
      for (const row of stats.champions) add(row.champion_id, role, row.games / stats.games, row.games, true);
    }
  }
  return [...candidates.values()].map(candidate => ({ ...candidate,
    roles: ROSTER_ROLES.filter(role => candidate.roles.includes(role)) }))
    .sort((a, b) => b.score - a.score || (a.champion_id < b.champion_id ? -1 : a.champion_id > b.champion_id ? 1 : 0));
}

/** Whether every supplied pick can occupy a different observed role. */
export function canCoverRoles(picks: string[], candidates: SoloRoleCandidate[], candidateId?: string): boolean {
  const ids = candidateId === undefined ? [...picks] : [...picks, candidateId];
  if (ids.length > ROSTER_ROLES.length) return false;
  const hints = new Map<string, Set<RosterRole>>();
  for (const candidate of candidates) {
    const id = canonical(candidate.champion_id);
    if (!id) continue;
    const roles = hints.get(id) ?? new Set<RosterRole>();
    for (const raw of candidate.roles) {
      const role = roleOf(raw);
      if (role) roles.add(role);
    }
    hints.set(id, roles);
  }
  const owners = new Map<RosterRole, number>();
  const observed = ids.map(id => hints.get(canonical(id) ?? ""));
  const match = (pick: number, seen: Set<RosterRole>): boolean => {
    for (const role of observed[pick] ?? []) {
      if (seen.has(role)) continue;
      seen.add(role);
      const owner = owners.get(role);
      if (owner === undefined || match(owner, seen)) {
        owners.set(role, pick);
        return true;
      }
    }
    return false;
  };
  return observed.every((roles, pick) => !!roles?.size && match(pick, new Set()));
}
