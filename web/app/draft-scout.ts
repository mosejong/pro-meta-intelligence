import { isChampionLocked } from "./draft-agent";
import kcPack from "./scouting/t1-vs-kc.json";

// Reviewed season packs from `scout-opponent-draft`; regenerated per opponent, never edited by hand.
export type DraftScoutPack = typeof kcPack;
export const DRAFT_SCOUT_PACKS: Record<string, DraftScoutPack> = { KC: kcPack };

export function draftScoutFor(code: string | null | undefined) {
  return code ? DRAFT_SCOUT_PACKS[code] ?? null : null;
}

// Consecutive games in one league between the same teams read as one series.
export function headToHeadSeries(pack: DraftScoutPack) {
  const series: { league: string; date: string; own_wins: number; target_wins: number; games: DraftScoutPack["head_to_head"] }[] = [];
  for (const game of pack.head_to_head) {
    const last = series.at(-1);
    const current = last && last.league === game.league ? last : null;
    const entry = current ?? { league: game.league, date: game.observed_at.slice(0, 10), own_wins: 0, target_wins: 0, games: [] };
    if (!current) series.push(entry);
    entry.games.push(game);
    if (game.own_won) entry.own_wins += 1; else entry.target_wins += 1;
  }
  return series;
}

// Champions each team banned in every head-to-head game: the clearest read of what they fear.
export function headToHeadStaples(pack: DraftScoutPack, team: "own" | "target") {
  const counts = new Map<string, number>();
  for (const game of pack.head_to_head) for (const champion of game[team].bans) counts.set(champion, (counts.get(champion) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 2)
    .sort(([leftId, left], [rightId, right]) => right - left || (leftId < rightId ? -1 : 1))
    .map(([champion_id, count]) => ({ champion_id, count }));
}

export function buildDraftScoutBrief(pack: DraftScoutPack, previousPicks: string[] = []) {
  const locked = (championId: string) => isChampionLocked([], championId, previousPicks);
  const presence = (group: string) => pack.league_meta.find((item) => item.group === group)?.presence ?? [];
  const homeLeague = pack.target.home_league;
  const ownLeague = pack.own.home_league;
  const ownTop = new Set(presence(ownLeague ?? "").map((item) => item.champion_id));
  const targetTop = new Set(presence(homeLeague ?? "").map((item) => item.champion_id));
  return {
    deny: pack.levers.deny_comfort.map((item) => ({ ...item, locked: locked(item.champion_id) })),
    contested: pack.levers.contested_priority.map((item) => ({ ...item, locked: locked(item.champion_id) })),
    protect: pack.levers.protect_own.map((item) => ({ ...item, locked: locked(item.champion_id) })),
    pressure: pack.levers.fearless_pressure.map((pool) => {
      const champions = pack.target.player_pools.find((item) => item.role === pool.role)?.champions ?? [];
      return { ...pool, top_remaining: champions.filter((champion) => !locked(champion.champion_id)).length, top_total: champions.length };
    }),
    counterpick_role: pack.levers.counterpick_role,
    last_pick_games: pack.target.last_pick.game_count,
    // League contrast lists champions one home league prioritizes that the other does not.
    target_league_only: presence(homeLeague ?? "").filter((item) => !ownTop.has(item.champion_id)),
    own_league_only: presence(ownLeague ?? "").filter((item) => !targetTop.has(item.champion_id)),
  };
}

export function formatRate(rate: number | null | undefined) {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}
