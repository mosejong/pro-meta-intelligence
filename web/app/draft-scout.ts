import { isChampionLocked, type DraftSelection } from "./draft-agent";
import blgPack from "./scouting/t1-vs-blg.json";
import dkPack from "./scouting/t1-vs-dk.json";
import genPack from "./scouting/t1-vs-gen.json";
import igPack from "./scouting/t1-vs-ig.json";
import kcPack from "./scouting/t1-vs-kc.json";
import lyonPack from "./scouting/t1-vs-lyon.json";
import tesPack from "./scouting/t1-vs-tes.json";
import validation from "./scouting/validation.json";

type Counted = { champion_id: string; game_count: number; rate: number | null };
type Record_ = { game_count: number; win_count: number; win_rate: number | null };
type ScoutDraft = { bans: string[]; picks: { sequence: number; champion_id: string; role: string; player_name: string | null }[] };
type ScoutTeam = {
  observed_pairs?: { left: { role: string; champion_id: string }; right: { role: string; champion_id: string };
    game_count: number; evidence_match_ids: string[] }[];
  import_coverage?: { observed_games: number; accepted_games: number; excluded_games: number;
    excluded_rate: number | null; exclusion_reasons: Record<string, number> };
  season_tendencies?: { role: string; player_id: string | null; player_name: string | null;
    year: number; season_games: number; recent_games: number; status: string;
    champions: { champion_id: string; season_games: number; recent_games: number;
      season_share: number | null; recent_share: number | null; evidence_ids: string[] }[] }[];
  team_name: string; team_ids: string[]; game_count: number; record: Record_; home_league: string | null;
  leagues: Record<string, number>; patches: string[]; window: { first_observed_at: string; last_observed_at: string };
  side_record: { BLUE: Record_; RED: Record_ }; first_selection: Record_ & { rate: number | null };
  phase_one_bans: Counted[]; phase_two_bans: Counted[]; received_phase_one_bans: Counted[]; received_phase_two_bans: Counted[];
  first_rotation_picks: Counted[]; top_picks: (Counted & { role: string; win_count: number })[]; pick_counts: Record<string, number>;
  last_pick: { game_count: number; roles: Counted[]; champions: Counted[] };
  player_pools: { role: string; player_name: string | null; game_count: number; unique_champions: number; comfort_champions: number;
    top_three_share: number | null; champions: { champion_id: string; game_count: number; win_count: number; share: number | null }[]; other_players: string[] }[];
};

// Mirrors `draft-scout-pack` schema 1 written by `scout-opponent-draft`.
export type DraftScoutPack = {
  matchup_bans?: { game_count: number; phase_one: Counted[]; boundary: string };
  schema_version: string; artifact_type: string; cutoff: string; boundary: string; quality_flags: string[];
  config: { maximum_games_per_team: number; meta_patches_per_region: number; minimum_comfort_games: number; top_champions: number };
  target: ScoutTeam; own: ScoutTeam;
  head_to_head: { match_id: string; observed_at: string; league: string; patch_id: string; own_side: string;
    own_first_selection: boolean; own_won: boolean; own: ScoutDraft; target: ScoutDraft }[];
  league_meta: { group: string; leagues: string[]; patches: string[]; game_count: number;
    presence: { champion_id: string; presence_rate: number | null; pick_count: number; ban_count: number }[];
    role_picks: Partial<Record<string, { champion_id: string; pick_share: number | null }[]>> }[];
  levers: {
    deny_comfort: { champion_id: string; role: string; player_name: string | null; game_count: number; win_count: number; share: number | null; also_own_priority: boolean }[];
    contested_priority: { champion_id: string; own_game_count: number; target_game_count: number }[];
    protect_own: { champion_id: string; own_game_count: number; received_phase_one_ban_count: number; banned_by_target_head_to_head: number }[];
    target_spends_phase_one_bans: Counted[];
    expected_phase_one_bans: { champion_id: string; presence_rate: number | null }[];
    expected_picks: { role: string; player_name: string | null;
      champions: { champion_id: string; score: number; player_game_count: number; meta_pick_share: number | null }[] }[];
    fearless_pressure: { role: string; player_name: string | null; unique_champions: number; comfort_champions: number; top_three_share: number | null }[];
    counterpick_role: Counted | null;
  };
};

// Reviewed season packs from `scout-opponent-draft`; regenerated per opponent, never edited by hand.
export const DRAFT_SCOUT_PACKS: Record<string, DraftScoutPack> = {
  KC: kcPack, TES: tesPack, IG: igPack, GEN: genPack, LYON: lyonPack, DK: dkPack, BLG: blgPack,
};

type Hit = { hit: number; of: number; rate: number | null };
type HitRates = Record<"expected_phase_one_bans" | "season_ban_habit" | "expected_picks" | "player_pool_picks" | "role_meta_picks" | "international_meta_picks" | "deny_hits_real_pick", Hit>;

// Mirrors `draft-scout-backtest` schema 1 written by `backtest-draft-scout`.
export const DRAFT_SCOUT_VALIDATION: { league: string; game_count: number; publication_delay_hours: number; overall: HitRates; teams: Record<string, HitRates> } = validation;

export function draftScoutFor(code: string | null | undefined) {
  return code ? DRAFT_SCOUT_PACKS[code] ?? null : null;
}

const SERIES_GAP_MS = 12 * 60 * 60 * 1000;

// Games in one league within 12 hours of the previous game read as one series.
export function headToHeadSeries(pack: DraftScoutPack) {
  const series: { league: string; date: string; own_wins: number; target_wins: number; games: DraftScoutPack["head_to_head"] }[] = [];
  for (const game of pack.head_to_head) {
    const last = series.at(-1);
    const previous = last?.games.at(-1);
    const current = last && previous && last.league === game.league &&
      Date.parse(game.observed_at) - Date.parse(previous.observed_at) <= SERIES_GAP_MS ? last : null;
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

export function buildDraftScoutBrief(pack: DraftScoutPack, previousPicks: string[] = [], selections: DraftSelection[] = []) {
  const locked = (championId: string) => isChampionLocked(selections, championId, previousPicks);
  const presence = (group: string) => pack.league_meta.find((item) => item.group === group)?.presence ?? [];
  const homeLeague = pack.target.home_league;
  const ownLeague = pack.own.home_league;
  const ownTop = new Set(presence(ownLeague ?? "").map((item) => item.champion_id));
  const targetTop = new Set(presence(homeLeague ?? "").map((item) => item.champion_id));
  return {
    season: (pack.target.season_tendencies ?? []).map((player) => ({ ...player,
      champions: player.champions.map((champion) => ({ ...champion,
        locked: locked(champion.champion_id),
        change: champion.recent_share === null || champion.season_share === null ? null :
          champion.recent_share - champion.season_share,
      })),
    })),
    deny: pack.levers.deny_comfort.map((item) => ({ ...item, locked: locked(item.champion_id) })),
    contested: pack.levers.contested_priority.map((item) => ({ ...item, locked: locked(item.champion_id) })),
    protect: pack.levers.protect_own.map((item) => ({ ...item, locked: locked(item.champion_id) })),
    // Locked champions cannot be picked, so they leave the expected ban shortlist.
    expected_bans: pack.levers.expected_phase_one_bans.filter((item) => !locked(item.champion_id)).slice(0, pack.config.top_champions),
    // Each role keeps top_champions candidates: locked champions give way to the next in the list.
    expected_picks: pack.levers.expected_picks.map((group) => ({
      ...group, champions: group.champions.filter((item) => !locked(item.champion_id)).slice(0, pack.config.top_champions),
    })),
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

// Packs are only replaced by a successful refresh, so a failed refresh shows up here as an old cutoff.
export const SCOUT_STALE_AFTER_HOURS = 72;
export const SCOUT_FEED_LAG_TOLERANCE_HOURS = 6;

export type ScoutFreshness = {
  status: "CURRENT" | "BEHIND_FEED" | "AGED" | "UNKNOWN";
  pack_cutoff: string; feed_cutoff: string | null;
  age_hours: number | null; feed_lead_hours: number | null;
};

// Compares the pack with the published feed it should follow and with the viewer's clock.
// The clock is optional so server and first client render agree; age is filled in after mount.
export function scoutFreshness(packCutoff: string, feedCutoff: string | null | undefined, now?: number): ScoutFreshness {
  const hours = (from: string, to: number) => (to - Date.parse(from)) / 3_600_000;
  const pack = Date.parse(packCutoff);
  const feed = feedCutoff && Number.isFinite(Date.parse(feedCutoff)) ? feedCutoff : null;
  const feed_lead_hours = feed && Number.isFinite(pack) ? hours(packCutoff, Date.parse(feed)) : null;
  const age_hours = now !== undefined && Number.isFinite(pack) ? Math.max(0, hours(packCutoff, now)) : null;
  const status = !Number.isFinite(pack) ? "UNKNOWN"
    : feed_lead_hours !== null && feed_lead_hours > SCOUT_FEED_LAG_TOLERANCE_HOURS ? "BEHIND_FEED"
      : age_hours !== null && age_hours > SCOUT_STALE_AFTER_HOURS ? "AGED" : "CURRENT";
  return { status, pack_cutoff: packCutoff, feed_cutoff: feed, age_hours, feed_lead_hours };
}
