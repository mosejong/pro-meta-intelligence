import { championAssetId } from "./champion-assets";
import type { OpponentPlayerProfile, OpponentTeam, RadarReport } from "./radar-types";
import { playerKey, ROSTER_ROLES, type RosterIndex, type RosterPlayer, type RosterRole, type RosterState } from "./roster-scenario";

/**
 * Player evidence for a virtual roster (player-pool-evidence v1).
 *
 * Each slot is resolved only by its (source team ID, player ID) assignment — never by name — to
 * that player's own profile in the same public snapshot. `profile.champions` is a limited summary
 * list (top N per player inside a capped per-team window): a champion missing from it is
 * "unconfirmed", never "0 games" or "cannot play". The list is split into currently available /
 * fearless-locked by an earlier game's pick (either team) / banned or picked in this game, by
 * normalized championAssetId. This feeds the evidence display only — no recommendation, ranking,
 * prediction or simulation reads it — and inputs are never mutated.
 */

export type PoolChampionState = "AVAILABLE" | "FEARLESS_LOCKED" | "BANNED_NOW" | "PICKED_NOW";

export type PoolChampion = {
  champion_id: string;
  game_count: number;
  evidence_event_ids: string[];
  state: PoolChampionState;
};

/** EMPTY: no champions listed (unconfirmed). LIMITED: list is cut or covers fewer games than the sample. */
export type PoolListState = "EMPTY" | "LIMITED" | "LISTED";

export type PoolFocus = {
  champion_id: string;
  /** LISTED: in this player's summary list. UNCONFIRMED: not in the list (not evidence of 0 games). */
  status: "LISTED" | "UNCONFIRMED";
  champion: PoolChampion | null;
};

export type SlotEvidence = {
  team_id: string;
  role: RosterRole;
  status: "EMPTY" | "UNRESOLVED" | "OBSERVED";
  player: RosterPlayer | null;
  /** Records are the source team's observations (may differ from the slot's team). */
  source_team_id: string | null;
  source_team_name: string | null;
  from_other_team: boolean;
  observed_role: string | null;
  /** False when the slot role differs: the record is NOT evidence for the assigned role. */
  role_matches: boolean;
  sample_games: number | null;
  evidence_match_ids: string[];
  window: { first_observed_at: string; last_observed_at: string; team_game_count: number } | null;
  list_state: PoolListState;
  champions: PoolChampion[];
  listed_count: number;
  available_count: number;
  focus: PoolFocus | null;
};

export type PoolBasis = {
  patch_id: string;
  cutoff: string;
  fixture_only: boolean;
  maximum_games_per_team: number | null;
};

export type PoolSelection = { kind: "BAN" | "PICK"; champion_id: string };

export const championKey = (championId: string) => championAssetId(championId).toLocaleLowerCase("en-US");

export function poolBasis(report: Pick<RadarReport, "patch_id" | "cutoff" | "fixture_only" | "opponent_prep">): PoolBasis {
  const config = report.opponent_prep?.config;
  return {
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    fixture_only: report.fixture_only,
    maximum_games_per_team: typeof config?.maximum_games_per_team === "number" ? config.maximum_games_per_team : null,
  };
}

/** Champion state: this game's pick/ban first, then any earlier game's pick (fearless). Earlier bans never lock. */
export function poolChampionState(championId: string, selections: readonly PoolSelection[], previousPicks: readonly string[]): PoolChampionState {
  const key = championKey(championId);
  const current = selections.find((selection) => championKey(selection.champion_id) === key);
  if (current) return current.kind === "PICK" ? "PICKED_NOW" : "BANNED_NOW";
  return previousPicks.some((id) => championKey(id) === key) ? "FEARLESS_LOCKED" : "AVAILABLE";
}

/** The unique profile for a non-ambiguous (team, player) key, or null. */
function findProfile(teams: readonly OpponentTeam[], sourceTeamId: string, playerId: string): { team: OpponentTeam; profile: OpponentPlayerProfile } | null {
  const team = teams.find((candidate) => candidate.team_id === sourceTeamId);
  const matches = (team?.player_profiles ?? []).filter((profile) => profile.player_id === playerId);
  return team && matches.length === 1 ? { team, profile: matches[0] } : null;
}

export function slotEvidence(input: {
  teamId: string;
  role: RosterRole;
  assigned: { source_team_id: string; player_id: string } | null;
  teams: readonly OpponentTeam[];
  index: RosterIndex;
  basis: PoolBasis;
  selections: readonly PoolSelection[];
  previousPicks: readonly string[];
  focusChampionId?: string | null;
}): SlotEvidence {
  const { teamId, role, assigned, teams, index, selections, previousPicks } = input;
  const empty: SlotEvidence = {
    team_id: teamId, role, status: "EMPTY", player: null, source_team_id: null, source_team_name: null, from_other_team: false,
    observed_role: null, role_matches: false, sample_games: null, evidence_match_ids: [], window: null,
    list_state: "EMPTY", champions: [], listed_count: 0, available_count: 0, focus: null,
  };
  if (!assigned) return empty;
  const key = playerKey(assigned.source_team_id, assigned.player_id);
  const player = index.ambiguous.has(key) ? null : index.players.get(key) ?? null;
  const found = player ? findProfile(teams, assigned.source_team_id, assigned.player_id) : null;
  if (!player || !found) return { ...empty, status: "UNRESOLVED" };
  const { team, profile } = found;
  const champions: PoolChampion[] = profile.champions.map((champion) => ({
    champion_id: champion.champion_id,
    game_count: champion.game_count,
    evidence_event_ids: [...champion.evidence_event_ids],
    state: poolChampionState(champion.champion_id, selections, previousPicks),
  }));
  const listedGames = champions.reduce((sum, champion) => sum + champion.game_count, 0);
  // config.top_champions caps team rankings, not player pools (the generator
  // currently caps those at four). Never infer a player cap from that setting.
  const list_state: PoolListState = !champions.length ? "EMPTY" : listedGames !== profile.game_count ? "LIMITED" : "LISTED";
  let focus: PoolFocus | null = null;
  if (input.focusChampionId) {
    const focusKey = championKey(input.focusChampionId);
    const champion = champions.find((item) => championKey(item.champion_id) === focusKey) ?? null;
    focus = { champion_id: input.focusChampionId, status: champion ? "LISTED" : "UNCONFIRMED", champion };
  }
  return {
    team_id: teamId,
    role,
    status: "OBSERVED",
    player,
    source_team_id: team.team_id,
    source_team_name: team.team_name,
    from_other_team: team.team_id !== teamId,
    observed_role: profile.role,
    role_matches: profile.role === role,
    sample_games: profile.game_count,
    evidence_match_ids: [...profile.evidence_match_ids],
    window: { first_observed_at: team.evidence.first_observed_at, last_observed_at: team.evidence.last_observed_at, team_game_count: team.game_count },
    list_state,
    champions,
    listed_count: champions.length,
    available_count: champions.filter((champion) => champion.state === "AVAILABLE").length,
    focus,
  };
}

/** Evidence for every role of one team's current virtual roster (follows edits, moves, swaps, restores). */
export function teamEvidence(input: Omit<Parameters<typeof slotEvidence>[0], "role" | "assigned"> & { rosters: RosterState }): SlotEvidence[] {
  const slots = input.rosters[input.teamId];
  return ROSTER_ROLES.map((role) => slotEvidence({ ...input, role, assigned: slots?.[role] ?? null }));
}
