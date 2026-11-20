import { championAssetId } from "./champion-assets";
import { fearlessLocks, type DraftGame, type DraftSelection, type DraftSide } from "./draft-agent";
import { buildDraftResultReport } from "./draft-result-report";
import type { RadarReport } from "./radar-types";

/**
 * Read-only recap of finished Fearless games. Every game is replayed in order through the existing
 * result builder with only earlier games' PICKS as locks. Teams are resolved by the IDs stored on each
 * game against the frozen report — never by name and never from the current board — so later team or
 * side changes cannot rewrite history. Nothing here predicts outcomes or describes why an automatic
 * opponent chose anything.
 */
export type SeriesRecapUnsupported = "INVALID_REPORT" | "INVALID_GAME" | "INCOMPLETE_GAME" | "UNKNOWN_TEAM" | "PAIR_MISMATCH" | "DEPENDS_ON_UNVERIFIED";
export type SeriesRecapSide = {
  side: DraftSide; team_id: string; team_name: string; game_count: number;
  picks: string[]; bans: string[];
  contested_claims: { champion_id: string; own_games: number; opponent_games: number }[];
  target_bans: { champion_id: string; opponent_games: number }[];
};
export type SeriesRecapGame = { game: number; current: boolean } & (
  | { status: "READY"; first_pick_side: DraftSide; locks_before: string[]; new_locks: string[]; sides: [SeriesRecapSide, SeriesRecapSide] }
  | { status: "UNSUPPORTED"; reason: SeriesRecapUnsupported });
export type SeriesRecap = { games: SeriesRecapGame[]; total_locks: string[] | null };
export type SeriesRecapInput = { report: RadarReport; games: DraftGame[]; current?: DraftGame | null };

const pairKey = (game: DraftGame) => [game.blue_team_id, game.red_team_id].sort().join("\n");
const isGameShape = (game: unknown): game is DraftGame => Boolean(game) && typeof game === "object" &&
  typeof (game as DraftGame).blue_team_id === "string" && typeof (game as DraftGame).red_team_id === "string" &&
  Array.isArray((game as DraftGame).selections) && (game as DraftGame).selections.every((s) => Boolean(s) && typeof s === "object");

export function buildSeriesRecap({ report, games, current }: SeriesRecapInput): SeriesRecap {
  const finished = Array.isArray(games) ? games : [];
  // An in-progress current game is never a finished set; a finished one is appended exactly once.
  const entries: { game: unknown; current: boolean }[] = finished.map((game) => ({ game, current: false }));
  if (current && Array.isArray(current.selections) && current.selections.length === 20) entries.push({ game: current, current: true });
  const teams = Array.isArray(report?.opponent_prep?.teams) ? report.opponent_prep.teams : [];
  // Any malformed team row (null, non-object, missing string ID) makes the whole report unsupported
  // before the result builder sees it; nothing is confirmed from a partially readable team list.
  const reportOk = teams.every((team) => Boolean(team) && typeof team === "object" && !Array.isArray(team) && typeof team.team_id === "string");
  const accepted: DraftGame[] = [];
  let pair: string | null = null;
  let broken = !Array.isArray(games);
  const out: SeriesRecapGame[] = entries.map(({ game, current: isCurrent }, index): SeriesRecapGame => {
    const base = { game: index + 1, current: isCurrent };
    if (broken) return { ...base, status: "UNSUPPORTED", reason: "DEPENDS_ON_UNVERIFIED" };
    const fail = (reason: SeriesRecapUnsupported): SeriesRecapGame => { broken = true; return { ...base, status: "UNSUPPORTED", reason }; };
    if (!reportOk) return fail("INVALID_REPORT");
    if (!isGameShape(game)) return fail("INVALID_GAME");
    if (game.selections.length !== 20) return fail("INCOMPLETE_GAME");
    const blue = teams.filter((team) => team?.team_id === game.blue_team_id);
    const red = teams.filter((team) => team?.team_id === game.red_team_id);
    if (!game.blue_team_id || !game.red_team_id || blue.length !== 1 || red.length !== 1) return fail("UNKNOWN_TEAM");
    if (pair !== null && pairKey(game) !== pair) return fail("PAIR_MISMATCH");
    const firstPickSide = game.selections[0].side;
    if (firstPickSide !== "BLUE" && firstPickSide !== "RED") return fail("INVALID_GAME");
    const locksBefore = fearlessLocks(accepted);
    const result = buildDraftResultReport({ report, blueTeam: blue[0], redTeam: red[0], selections: game.selections, previousPicks: locksBefore, firstPickSide });
    if (result.status !== "READY") return fail(result.status === "INCOMPLETE" ? "INCOMPLETE_GAME" : "INVALID_GAME");
    pair = pairKey(game);
    const snapshot: DraftGame = { blue_team_id: game.blue_team_id, red_team_id: game.red_team_id,
      selections: game.selections.map((s: DraftSelection) => ({ ...s })) };
    accepted.push(snapshot);
    const bansOf = (side: DraftSide) => snapshot.selections.filter((s) => s.side === side && s.kind === "BAN").map((s) => championAssetId(s.champion_id));
    const sides = result.sides.map((side): SeriesRecapSide => ({
      side: side.side, team_id: side.team_id, team_name: side.team_name, game_count: side.game_count,
      picks: side.picks.map((p) => p.champion_id), bans: bansOf(side.side),
      contested_claims: side.contested_claims.map(({ champion_id, own_games, opponent_games }) => ({ champion_id, own_games, opponent_games })),
      target_bans: side.target_bans.map(({ champion_id, opponent_games }) => ({ champion_id, opponent_games })),
    })) as [SeriesRecapSide, SeriesRecapSide];
    return { ...base, status: "READY", first_pick_side: firstPickSide, locks_before: locksBefore, new_locks: fearlessLocks([snapshot]), sides };
  });
  return { games: out, total_locks: broken ? null : fearlessLocks(accepted) };
}
