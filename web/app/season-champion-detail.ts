import { championKey, poolChampionState, type PoolChampionState, type PoolSelection } from "./player-pool-evidence";
import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import { resolveSeasonRef, type SeasonCard, type SeasonCardCatalog, type TeamSeasonSlots } from "./season-player-cards";

/**
 * Read-only champion detail opened from the season player comparison (season-champion-detail v1).
 *
 * A target remembers exactly which comparison it was opened from: catalog version, role and the two
 * season cards. It stays valid only while the same catalog is loaded and both sides still hold those
 * same cards in that role; otherwise the caller withdraws the detail instead of showing it for a
 * different comparison. Nothing here stages, confirms or recommends a champion.
 *
 * Per side, the champion's count on that season card (aliases collapse to the largest row, never
 * summed); a champion absent from a card is `null` = not observed, never 0.
 */
export type SeasonChampionTarget = {
  catalog_id: string;
  role: RosterRole;
  champion_id: string;
  blue: { team_id: string; card_id: string };
  red: { team_id: string; card_id: string };
};

export type SeasonChampionSide = {
  side: "BLUE" | "RED";
  card_id: string;
  player_name: string;
  season: number;
  role: RosterRole;
  team_names: string[];
  game_count: number;
  /** Games with this champion on this card, or null when the card has no observation of it. */
  games: number | null;
};

export type SeasonChampionDetail = {
  champion_id: string;
  role: RosterRole;
  /** Live draft state of the champion (this game's bans/picks, earlier games' picks). */
  state: PoolChampionState;
  sides: [SeasonChampionSide, SeasonChampionSide];
};

const resolve = (lineups: TeamSeasonSlots, teamId: string, role: RosterRole, catalog: SeasonCardCatalog): SeasonCard | null => {
  if (!Object.hasOwn(lineups, teamId)) return null;
  const ref = lineups[teamId]?.[role];
  if (!ref) return null;
  try { return resolveSeasonRef(ref, role, catalog); } catch { return null; }
};

/** True only while the same catalog and the same two season cards are still in that role. */
export function seasonChampionTargetValid(target: SeasonChampionTarget | null, catalog: SeasonCardCatalog | null, lineups: TeamSeasonSlots): boolean {
  if (!target || !catalog || catalog.catalog_id !== target.catalog_id || !ROSTER_ROLES.includes(target.role)) return false;
  const blue = resolve(lineups, target.blue.team_id, target.role, catalog);
  const red = resolve(lineups, target.red.team_id, target.role, catalog);
  return !!blue && !!red && blue.id === target.blue.card_id && red.id === target.red.card_id;
}

function gamesOn(card: SeasonCard, championId: string): number | null {
  const key = championKey(championId);
  let best: number | null = null;
  for (const champion of card.champions) if (championKey(champion.champion_id) === key && (best === null || champion.games > best)) best = champion.games;
  return best;
}

function side(label: "BLUE" | "RED", card: SeasonCard, championId: string): SeasonChampionSide {
  return { side: label, card_id: card.id, player_name: card.player_name, season: card.season, role: card.role, team_names: [...card.team_names], game_count: card.game_count, games: gamesOn(card, championId) };
}

/** Null when the target is no longer valid (the caller then withdraws the detail). */
export function seasonChampionDetail(target: SeasonChampionTarget | null, catalog: SeasonCardCatalog | null, lineups: TeamSeasonSlots,
  selections: readonly PoolSelection[], previousPicks: readonly string[]): SeasonChampionDetail | null {
  if (!target || !catalog || !seasonChampionTargetValid(target, catalog, lineups)) return null;
  const blue = resolve(lineups, target.blue.team_id, target.role, catalog)!;
  const red = resolve(lineups, target.red.team_id, target.role, catalog)!;
  return {
    champion_id: target.champion_id,
    role: target.role,
    state: poolChampionState(target.champion_id, selections, previousPicks),
    sides: [side("BLUE", blue, target.champion_id), side("RED", red, target.champion_id)],
  };
}
