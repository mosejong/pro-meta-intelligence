import { championKey } from "./player-pool-evidence";
import { SEASON_SCOPES, type SeasonHistory, type SeasonScope } from "./player-season-history";
import { basisKey, playerKey, ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import type { SimulationInputSnapshot } from "./simulation-scenario";

/**
 * Season evidence for the champion the user assigned to each role of a ready simulation input.
 *
 * Read-only display helper: for each (team ID, role) of the current snapshot, the exact assigned
 * (source team ID, player ID) is looked up in a validated player-season-history file, and the
 * assigned champion's picks are counted only inside that same role, per scope (season / latest
 * games / reference patch). Names, the virtual team, role order and other roles never join a
 * record. Counts are observations, never an effect, rating or win rate, and nothing here is added
 * to the snapshot, the manager-scenario file or any simulation.
 */

export type ScopeCount = {
  /** Games of this player in this role within the scope (denominator). */
  games: number;
  /** Games in which the assigned champion was played in this role within the scope. */
  picks: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
};

export type AssignedEvidenceStatus =
  /** No player in the slot (a ready input never has one; kept for safety). */
  | "EMPTY"
  /** Player absent from the file or not FOUND there: unknown, never shown as 0. */
  | "UNCONFIRMED"
  /** Player FOUND but with no game in this role in the file: role 0 games. */
  | "ZERO_IN_ROLE"
  | "OBSERVED";

export type AssignedEvidenceRow = {
  side: "BLUE" | "RED";
  team_id: string;
  role: RosterRole;
  champion_id: string;
  /** playerKey(source_team_id, player_id), "" for an empty slot. */
  player_key: string;
  player_name: string;
  source_team_id: string;
  source_team_name: string;
  /** The player's observed team differs from the team they are assigned to in this input. */
  virtual: boolean;
  status: AssignedEvidenceStatus;
  /** Only for ZERO_IN_ROLE / OBSERVED (a validated, complete role record). */
  scopes: Record<SeasonScope, ScopeCount> | null;
  /** Season games in other roles: context only, never added to this role. */
  other_roles: { role: RosterRole; games: number }[];
};

export type AssignedEvidence =
  | { ok: true; rows: AssignedEvidenceRow[] }
  | { ok: false; code: "BASIS_MISMATCH"; message: string };

/** A history file validated for one roster basis, as kept by the caller. */
export type LoadedSeasonHistory = { basisKey: string; history: SeasonHistory };

const zero = (): ScopeCount => ({ games: 0, picks: 0, first_observed_at: null, last_observed_at: null });

/** True when the loaded file was validated for exactly this snapshot's roster basis. */
export function historyFitsSnapshot(loaded: LoadedSeasonHistory, snapshot: SimulationInputSnapshot) {
  return loaded.basisKey === basisKey(snapshot.draft.roster.basis)
    && loaded.history.cutoff === snapshot.cutoff
    && loaded.history.reference_patch === snapshot.patch;
}

/** Rows for every (side, role) of the snapshot, in BLUE then RED, TOP→SUPPORT order. Pure. */
export function assignedChampionEvidence(snapshot: SimulationInputSnapshot, loaded: LoadedSeasonHistory): AssignedEvidence {
  if (!historyFitsSnapshot(loaded, snapshot)) {
    return { ok: false, code: "BASIS_MISMATCH", message: "연간 자료의 참조 로스터(패치·기준 시각·출처)가 현재 입력과 다릅니다." };
  }
  const { history } = loaded;
  const rows: AssignedEvidenceRow[] = [];
  for (const side of ["BLUE", "RED"] as const) {
    const teamId = snapshot.draft.teams[side].id;
    for (const role of ROSTER_ROLES) {
      const championId = snapshot.roles[teamId]?.[role] ?? "";
      const slot = snapshot.draft.roster.teams[teamId]?.[role] ?? null;
      const base: AssignedEvidenceRow = {
        side, team_id: teamId, role, champion_id: championId,
        player_key: "", player_name: "", source_team_id: "", source_team_name: "", virtual: false,
        status: "EMPTY", scopes: null, other_roles: [],
      };
      if (!slot) { rows.push(base); continue; }
      const key = playerKey(slot.source_team_id, slot.player_id);
      const identified = {
        ...base, player_key: key, player_name: slot.player_name, source_team_id: slot.source_team_id,
        source_team_name: slot.source_team_name, virtual: slot.source_team_id !== teamId,
      };
      const player = history.players.get(key);
      if (!player || player.status !== "FOUND") { rows.push({ ...identified, status: "UNCONFIRMED" }); continue; }
      const other_roles = ROSTER_ROLES.filter((other) => other !== role && player.roles[other])
        .map((other) => ({ role: other, games: player.roles[other]!.season.games }));
      const record = player.roles[role];
      if (!record) {
        rows.push({ ...identified, status: "ZERO_IN_ROLE", other_roles,
          scopes: { season: zero(), recent: zero(), patch: zero() } });
        continue;
      }
      const target = championKey(championId);
      const scopes = {} as Record<SeasonScope, ScopeCount>;
      for (const scope of SEASON_SCOPES) {
        const stats = record[scope];
        // The validated list sums to the role's games, so a champion absent from it is 0 here.
        const picks = stats.champions.find((champion) => championKey(champion.champion_id) === target)?.games ?? 0;
        scopes[scope] = { games: stats.games, picks, first_observed_at: stats.first_observed_at, last_observed_at: stats.last_observed_at };
      }
      rows.push({ ...identified, status: record.season.games > 0 ? "OBSERVED" : "ZERO_IN_ROLE", scopes, other_roles });
    }
  }
  return { ok: true, rows };
}
