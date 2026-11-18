import { championAssetId } from "./champion-assets";
import { applyDraftSelection, type DraftSelection, type DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import { SHARE_CHAMPIONS } from "./share-champion-ids";

export type DraftResultInput = {
  report: RadarReport;
  blueTeam?: OpponentTeam | null;
  redTeam?: OpponentTeam | null;
  selections: DraftSelection[];
  previousPicks?: string[];
  firstPickSide?: DraftSide;
};
type Evidence = { champion_id: string; evidence_ids: string[] };
export type DraftResultSide = {
  side: DraftSide; team_id: string; team_name: string; game_count: number;
  picks: (Evidence & { own_games: number | null; opponent_games: number | null; roles: string[] })[];
  target_bans: (Evidence & { opponent_games: number })[];
  contested_claims: (Evidence & { own_games: number; opponent_games: number })[];
  missed_priorities: (Evidence & { game_count: number; disposition: "OPEN" | "BANNED" | "OPPONENT_PICKED" })[];
};
export type DraftResultReport = { status: "READY" | "INCOMPLETE" | "INVALID"; sides: DraftResultSide[]; boundary: string };

const boundary = "Public evidence only, within the current report's bounded priority_picks summaries. Team game_count covers the team's full selected sample; champion counts are the maximum observed row count, not sums across roles or proven champion-wide totals. Evidence IDs support rows attaining that maximum. Missing summary entries mean unknown (null), not zero. Roles are observed own-team row strings, not assigned positions. No outcome prediction or draft intent is inferred.";
const catalog = new Map(SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
const canonical = (value: unknown): string | undefined => typeof value === "string"
  ? catalog.get(championAssetId(value).toLowerCase()) : undefined;
const unique = (values: string[]) => [...new Set(values)].sort();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Summary = { champion_id: string; count: number; roles: string[]; ids: string[] };

function summarize(team: OpponentTeam): Map<string, Summary> | null {
  if (!Number.isSafeInteger(team.game_count) || team.game_count < 0 || !Array.isArray(team.priority_picks)) return null;
  const result = new Map<string, Summary>();
  for (const row of team.priority_picks) {
    const id = canonical(row?.champion_id);
    if (!id || !Number.isSafeInteger(row.game_count) || row.game_count < 0 || row.game_count > team.game_count ||
      !Array.isArray(row.evidence_event_ids) || row.evidence_event_ids.some((v) => typeof v !== "string") ||
      (row.role !== undefined && typeof row.role !== "string")) return null;
    const prior = result.get(id);
    result.set(id, { champion_id: id, count: Math.max(prior?.count ?? 0, row.game_count),
      roles: unique([...(prior?.roles ?? []), ...(row.role ? [row.role] : [])]),
      ids: unique(!prior || row.game_count > prior.count ? row.evidence_event_ids :
        row.game_count === prior.count ? [...prior.ids, ...row.evidence_event_ids] : prior.ids) });
  }
  return result;
}

/** Pure, detached evidence report; every recorded turn is replayed before any claims escape. */
export function buildDraftResultReport(input: DraftResultInput): DraftResultReport {
  const empty = (status: DraftResultReport["status"]): DraftResultReport => ({ status, sides: [], boundary });
  const { report, blueTeam, redTeam, selections, previousPicks = [], firstPickSide = "BLUE" } = input;
  if (!blueTeam?.team_id || !redTeam?.team_id || blueTeam.team_id === redTeam.team_id ||
    !["BLUE", "RED"].includes(firstPickSide) || !Array.isArray(selections) || selections.length > 20 ||
    !Array.isArray(previousPicks) || previousPicks.some((id) => !canonical(id))) return empty("INVALID");
  const prep = report?.opponent_prep;
  if (!prep || prep.patch_id !== report.patch_id || !Array.isArray(prep.teams)) return empty("INVALID");
  const teams = [blueTeam, redTeam].map((selected) => prep.teams.filter((team) => team.team_id === selected.team_id));
  if (teams.some((matches) => matches.length !== 1)) return empty("INVALID");
  const [blue, red] = teams.map((matches) => matches[0]);
  const blueSummary = summarize(blue), redSummary = summarize(red);
  if (!blueSummary || !redSummary) return empty("INVALID");
  const locks = previousPicks.map((id) => canonical(id)!);
  let replay: DraftSelection[] = [];
  for (const selection of selections) {
    const id = canonical(selection?.champion_id);
    if (!id) return empty("INVALID");
    const next = applyDraftSelection(replay, id, locks, firstPickSide);
    const expected = next[replay.length];
    if (next === replay || !expected || (["turn", "side", "kind", "slot", "phase"] as const)
      .some((field) => selection[field] !== expected[field])) return empty("INVALID");
    replay = next;
  }
  if (replay.length !== 20) return empty("INCOMPLETE");
  const sides = (["BLUE", "RED"] as const).map((side): DraftResultSide => {
    const team = side === "BLUE" ? blue : red;
    const own = side === "BLUE" ? blueSummary : redSummary;
    const opponent = side === "BLUE" ? redSummary : blueSummary;
    const picks = replay.filter((s) => s.side === side && s.kind === "PICK").map(({ champion_id }) => {
      const a = own.get(champion_id), b = opponent.get(champion_id);
      return { champion_id, own_games: a?.count ?? null, opponent_games: b?.count ?? null,
        roles: [...(a?.roles ?? [])], evidence_ids: unique([...(a?.ids ?? []), ...(b?.ids ?? [])]) };
    });
    const picked = new Set(picks.map((p) => p.champion_id));
    return { side, team_id: team.team_id, team_name: team.team_name, game_count: team.game_count, picks,
      target_bans: replay.filter((s) => s.side === side && s.kind === "BAN" && (opponent.get(s.champion_id)?.count ?? 0) > 0)
        .map(({ champion_id }) => ({ champion_id, opponent_games: opponent.get(champion_id)!.count, evidence_ids: [...opponent.get(champion_id)!.ids] })),
      contested_claims: picks.filter((p) => (p.own_games ?? 0) > 0 && (p.opponent_games ?? 0) > 0)
        .map((p) => ({ champion_id: p.champion_id, own_games: p.own_games!, opponent_games: p.opponent_games!, evidence_ids: [...p.evidence_ids] })),
      missed_priorities: [...own.values()].filter((p) => p.count > 0 && !picked.has(p.champion_id) && !locks.includes(p.champion_id))
        .sort((a, b) => b.count - a.count || compare(a.champion_id, b.champion_id)).slice(0, 3)
        .map((p) => ({ champion_id: p.champion_id, game_count: p.count, evidence_ids: [...p.ids],
          disposition: replay.some((s) => s.champion_id === p.champion_id && s.kind === "BAN") ? "BANNED" :
            replay.some((s) => s.champion_id === p.champion_id && s.kind === "PICK") ? "OPPONENT_PICKED" : "OPEN" })),
    };
  });
  return { status: "READY", sides, boundary };
}
