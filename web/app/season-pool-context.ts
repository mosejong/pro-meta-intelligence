import { championKey, poolChampionState, type PoolChampionState, type PoolSelection } from "./player-pool-evidence";
import type { SeasonCard } from "./season-player-cards";

/**
 * Read-only draft context for a selected past-season card (season-pool-context v1).
 *
 * Joins the card's observed champion counts (that player, that role, that season) with the live
 * draft's bans/picks and earlier games' picks, reusing player-pool-evidence's state rules. Display
 * only: no recommendation, score, win rate or AI choice reads it. Rows whose champion IDs normalize
 * to the same key are collapsed to the single largest row (never summed), so aliases cannot inflate
 * observations. A champion absent from the card is "not observed", never 0% or "cannot play".
 * Inputs are never mutated; every returned row is a fresh object.
 */

export type SeasonPoolRow = { champion_id: string; games: number; state: PoolChampionState };
export type SeasonPoolFocus = { champion_id: string; status: "OBSERVED" | "NOT_OBSERVED"; row: SeasonPoolRow | null };
export type SeasonPoolContext = {
  /** Top 5 observed (games desc, champion ID asc). */
  top: SeasonPoolRow[];
  /** Up to 3 observed champions unused in this draft (AVAILABLE), from the whole card in the same order. */
  remaining: SeasonPoolRow[];
  /** Null when no focus champion is set. */
  focus: SeasonPoolFocus | null;
};

export const SEASON_POOL_TOP = 5;
export const SEASON_POOL_REMAINING = 3;

const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: SeasonPoolRow, b: SeasonPoolRow) => b.games - a.games || compareId(a.champion_id, b.champion_id);

export function seasonPoolContext(
  card: Pick<SeasonCard, "champions">,
  selections: readonly PoolSelection[],
  previousPicks: readonly string[],
  focusChampionId?: string | null,
): SeasonPoolContext {
  const byKey = new Map<string, SeasonPoolRow>();
  for (const champion of card.champions) {
    const key = championKey(champion.champion_id);
    const row: SeasonPoolRow = { champion_id: champion.champion_id, games: champion.games, state: poolChampionState(champion.champion_id, selections, previousPicks) };
    const existing = byKey.get(key);
    if (!existing || order(row, existing) < 0) byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort(order);
  const top = rows.slice(0, SEASON_POOL_TOP).map((row) => ({ ...row }));
  const remaining = rows.filter((row) => row.state === "AVAILABLE").slice(0, SEASON_POOL_REMAINING).map((row) => ({ ...row }));
  let focus: SeasonPoolFocus | null = null;
  if (focusChampionId) {
    const row = byKey.get(championKey(focusChampionId));
    focus = { champion_id: focusChampionId, status: row ? "OBSERVED" : "NOT_OBSERVED", row: row ? { ...row } : null };
  }
  return { top, remaining, focus };
}

export const seasonPoolStateLabel: Record<PoolChampionState, string> = {
  BANNED_NOW: "이번 판 밴",
  PICKED_NOW: "이번 판 픽",
  FEARLESS_LOCKED: "이전 세트 잠금",
  AVAILABLE: "이번 밴픽 미사용",
};
