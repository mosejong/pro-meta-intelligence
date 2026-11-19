import { championKey, poolChampionState, type PoolChampionState, type PoolSelection } from "./player-pool-evidence";
import type { RosterRole } from "./roster-scenario";
import type { SeasonCard } from "./season-player-cards";

/**
 * Side-by-side observed champion records for two past-season cards in the same role (season-player-comparison v1).
 *
 * Historical observation only: no win rate, rating, superiority, current-meta recommendation or era
 * adjustment, and nothing in simulation/recommendation reads it. Aliases that normalize to the same
 * champion key keep only the largest count per card (never summed). A champion absent from a card is
 * "not observed", never 0. Common champions are listed by ID, not ranked by combined counts.
 * Inputs are never mutated; every returned object is fresh.
 */

export type SeasonComparisonRow = { champion_id: string; games: number; state: PoolChampionState };
export type SeasonComparisonCommonRow = {
  /** Shared normalized key; display IDs are kept per side. */
  key: string; blue_champion_id: string; red_champion_id: string;
  blue_games: number; red_games: number; state: PoolChampionState;
};
export type SeasonComparisonSide = {
  card_id: string; source_id: string; source_hashes: string[]; player_id: string; player_name: string;
  season: number; team_names: string[]; role: RosterRole; game_count: number; patches: string[];
  /** Top observed (games desc, champion ID asc). */
  top: SeasonComparisonRow[];
  /** Champions observed only on this card (games desc, champion ID asc). The other card has no observation, not 0. */
  only: SeasonComparisonRow[];
  only_count: number;
};
export type SeasonComparisonReason = "ROLE_MISMATCH" | "SAME_PLAYER" | "INVALID_CARD";
export type SeasonComparison =
  | { ok: true; role: RosterRole; blue: SeasonComparisonSide; red: SeasonComparisonSide; common_count: number; common: SeasonComparisonCommonRow[] }
  | { ok: false; reason: SeasonComparisonReason };

export const SEASON_COMPARISON_TOP = 3;
export const SEASON_COMPARISON_COMMON = 5;
export const SEASON_COMPARISON_ONLY = 3;

const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: SeasonComparisonRow, b: SeasonComparisonRow) => b.games - a.games || compareId(a.champion_id, b.champion_id);
const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
const positive =(n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1;

function validCard(card: SeasonCard): boolean {
  if (!card || typeof card !== "object" || !positive(card.game_count) || !Array.isArray(card.champions)) return false;
  return card.champions.every(ch => !!ch && typeof ch.champion_id === "string" && ch.champion_id.length > 0 && positive(ch.games) && ch.games <= card.game_count);
}

function collapse(card: SeasonCard, selections: readonly PoolSelection[], previousPicks: readonly string[]) {
  const byKey = new Map<string, SeasonComparisonRow>();
  for (const ch of card.champions) {
    const key = championKey(ch.champion_id);
    const row: SeasonComparisonRow = { champion_id: ch.champion_id, games: ch.games, state: poolChampionState(ch.champion_id, selections, previousPicks) };
    const existing = byKey.get(key);
    if (!existing || order(row, existing) < 0) byKey.set(key, row);
  }
  return byKey;
}

export function compareSeasonCards(blue: SeasonCard, red: SeasonCard, selections: readonly PoolSelection[], previousPicks: readonly string[]): SeasonComparison {
  if (!validCard(blue) || !validCard(red)) return { ok: false, reason: "INVALID_CARD" };
  if (blue.role !== red.role) return { ok: false, reason: "ROLE_MISMATCH" };
  if (blue.player_id === red.player_id) return { ok: false, reason: "SAME_PLAYER" };
  const b = collapse(blue, selections, previousPicks), r = collapse(red, selections, previousPicks);
  const commonKeys = [...b.keys()].filter(k => r.has(k)).sort(compareId);
  const common = commonKeys.slice(0, SEASON_COMPARISON_COMMON).map(key => {
    const x = b.get(key)!, y = r.get(key)!;
    return { key, blue_champion_id: x.champion_id, red_champion_id: y.champion_id, blue_games: x.games, red_games: y.games, state: x.state };
  });
  const side = (card: SeasonCard, mine: Map<string, SeasonComparisonRow>, other: Map<string, SeasonComparisonRow>): SeasonComparisonSide => {
    const rows = [...mine.values()].sort(order);
    const only = [...mine.entries()].filter(([k]) => !other.has(k)).map(([, row]) => row).sort(order);
    return {
      card_id: card.id, source_id: card.source_id, source_hashes: list(card.source_hashes), player_id: card.player_id, player_name: card.player_name,
      season: card.season, team_names: list(card.team_names), role: card.role, game_count: card.game_count, patches: list(card.patches),
      top: rows.slice(0, SEASON_COMPARISON_TOP).map(row => ({ ...row })),
      only: only.slice(0, SEASON_COMPARISON_ONLY).map(row => ({ ...row })), only_count: only.length,
    };
  };
  return { ok: true, role: blue.role, blue: side(blue, b, r), red: side(red, r, b), common_count: commonKeys.length, common };
}

export const seasonComparisonReasonLabel: Record<SeasonComparisonReason, string> = {
  ROLE_MISMATCH: "두 시즌 선수의 역할이 달라 비교하지 않습니다.",
  SAME_PLAYER: "같은 선수의 다른 시즌은 함께 비교하지 않습니다.",
  INVALID_CARD: "시즌 선수 기록 형식을 확인하지 못해 비교하지 않습니다.",
};
