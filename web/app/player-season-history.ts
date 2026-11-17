import { championKey, poolChampionState, type PoolChampionState, type PoolSelection } from "./player-pool-evidence";
import { basisKey, isRosterRole, playerKey, type RosterBasis, type RosterRole } from "./roster-scenario";

/**
 * Season per-role player history (player-season-history v1), loaded on demand.
 *
 * A derived aggregate of one archived public CSV: per (source team ID, player ID) and per role
 * actually played, all season picks, the latest 20 games and games on the reference patch.
 * Identity is the exact ID pair; names never join records and another team's games are never
 * added. A champion missing here is "not observed in this scope", never "cannot play". The file
 * is accepted only when its roster basis, cutoff and season match the current snapshot and its
 * source was retrieved no later than the cutoff. It feeds this display only — no recommendation,
 * ranking, prediction or simulation reads it.
 */

export const PLAYER_SEASON_ARTIFACT = "player-season-history";
export const PLAYER_SEASON_VERSION = 1;
export const PLAYER_SEASON_YEAR = 2026;
export const PLAYER_SEASON_PATH = `history/player-season-${PLAYER_SEASON_YEAR}.json`;
export const MAX_PLAYER_SEASON_BYTES = 3 * 1024 * 1024;
export const SEASON_SCOPES = ["season", "recent", "patch"] as const;
export type SeasonScope = (typeof SEASON_SCOPES)[number];

export type SeasonChampion = { champion_id: string; games: number; example_event_ids?: string[] };
export type SeasonScopeStats = { games: number; first_observed_at: string | null; last_observed_at: string | null; champions: SeasonChampion[] };
export type SeasonBreakdown = { id: string; games: number; first_observed_at: string; last_observed_at: string };
export type SeasonRole = Record<SeasonScope, SeasonScopeStats> & { by_patch: SeasonBreakdown[]; by_league: SeasonBreakdown[] };
export type SeasonPlayerStatus = "FOUND" | "NOT_FOUND" | "UNSUPPORTED_ID";
export type SeasonPlayer = {
  team_id: string; team_name: string; player_id: string; player_name: string;
  status: SeasonPlayerStatus; games: number; roles: Partial<Record<RosterRole, SeasonRole>>;
};
export type SeasonImportSummary = {
  discovered_game_count: number | null;
  accepted_game_count: number | null;
  rejected_game_count: number | null;
  season_accepted_game_count: number;
  season_first_observed_at: string | null;
  season_last_observed_at: string | null;
};
export type SeasonHistory = {
  season: number;
  cutoff: string;
  reference_patch: string;
  recent_game_limit: number;
  source: { source_id: string; source_version: string; content_hash: string; retrieved_at: string };
  import_summary: SeasonImportSummary;
  /** Keyed by playerKey(team, player). */
  players: Map<string, SeasonPlayer>;
};

export type SeasonErrorCode =
  | "UNAVAILABLE" | "TOO_LARGE" | "INVALID_JSON" | "WRONG_TYPE" | "BAD_VERSION" | "FUTURE_VERSION" | "BAD_SHAPE"
  | "SEASON_MISMATCH" | "BASIS_MISMATCH" | "FUTURE_SOURCE";
export type SeasonResult<T> = { ok: true; value: T } | { ok: false; code: SeasonErrorCode; error: string };
const fail = (code: SeasonErrorCode, error: string) => ({ ok: false as const, code, error });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isTime = (value: unknown): value is string => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
const optCount = (value: unknown) => value === null || value === undefined ? null : isCount(value) ? value : NaN;

function period(first: unknown, last: unknown, games: number, upperMs: number, year: number): "BAD" | "FUTURE" | null {
  if (!games) return first === null && last === null ? null : "BAD";
  if (!isTime(first) || !isTime(last)) return "BAD";
  if (Date.parse(first) > upperMs || Date.parse(last) > upperMs) return "FUTURE";
  if (Date.parse(first) > Date.parse(last) || new Date(first).getUTCFullYear() !== year || new Date(last).getUTCFullYear() !== year) return "BAD";
  return null;
}

function scopeStats(value: unknown, cutoffMs: number, year: number): SeasonScopeStats | "BAD" | "FUTURE" {
  if (!isRecord(value) || !isCount(value.games) || !Array.isArray(value.champions)) return "BAD";
  const champions: SeasonChampion[] = [];
  let sum = 0;
  const seen = new Set<string>();
  for (const item of value.champions) {
    if (!isRecord(item) || typeof item.champion_id !== "string" || !item.champion_id || !isCount(item.games) || item.games < 1) return "BAD";
    const examples = item.example_event_ids;
    const key = championKey(item.champion_id);
    if (!item.champion_id.trim() || seen.has(key)) return "BAD";
    seen.add(key);
    if (examples !== undefined && (!Array.isArray(examples) || examples.length > Math.min(3, item.games) || !examples.every((id) => typeof id === "string" && id.length > 0) || new Set(examples).size !== examples.length)) return "BAD";
    champions.push({ champion_id: item.champion_id, games: item.games, ...(examples ? { example_event_ids: [...examples as string[]] } : {}) });
    sum += item.games;
  }
  // Role denominator and champion counts must describe the same games.
  if (sum !== value.games) return "BAD";
  const first = value.first_observed_at ?? null, last = value.last_observed_at ?? null;
  const invalid = period(first, last, value.games, cutoffMs, year);
  if (invalid) return invalid;
  return { games: value.games, first_observed_at: first as string | null, last_observed_at: last as string | null, champions };
}

function breakdown(value: unknown, annual: SeasonScopeStats, upperMs: number, year: number): SeasonBreakdown[] | null {
  if (!Array.isArray(value)) return null;
  const rows: SeasonBreakdown[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id) || !isCount(row.games) || row.games < 1 || !isTime(row.first_observed_at) || !isTime(row.last_observed_at)) return null;
    if (period(row.first_observed_at, row.last_observed_at, row.games, upperMs, year) || Date.parse(row.first_observed_at) < Date.parse(annual.first_observed_at!) || Date.parse(row.last_observed_at) > Date.parse(annual.last_observed_at!)) return null;
    ids.add(row.id);
    rows.push({ id: row.id, games: row.games, first_observed_at: row.first_observed_at, last_observed_at: row.last_observed_at });
  }
  return rows.reduce((sum, row) => sum + row.games, 0) === annual.games ? rows : null;
}

/**
 * Validate a season history file for the current snapshot. Any failure leaves the caller's
 * draft, roster and snapshot evidence untouched; the caller only shows why history is missing.
 */
export function parsePlayerSeasonHistory(text: string, expected: { basis: RosterBasis; season?: number }): SeasonResult<SeasonHistory> {
  if (new TextEncoder().encode(text).byteLength > MAX_PLAYER_SEASON_BYTES) return fail("TOO_LARGE", "연간 자료 파일이 3MB를 넘습니다.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("INVALID_JSON", "연간 자료 JSON을 읽을 수 없습니다."); }
  if (!isRecord(value) || value.artifact_type !== PLAYER_SEASON_ARTIFACT) return fail("WRONG_TYPE", "연간 선수 기록 파일이 아닙니다.");
  if (typeof value.schema_version !== "number" || !Number.isInteger(value.schema_version) || value.schema_version < 1) return fail("BAD_VERSION", "연간 자료 버전이 올바르지 않습니다.");
  if (value.schema_version > PLAYER_SEASON_VERSION) return fail("FUTURE_VERSION", "이 앱보다 새 버전의 연간 자료입니다.");
  const season = expected.season ?? PLAYER_SEASON_YEAR;
  if (value.season !== season) return fail("SEASON_MISMATCH", `${season}년 시즌 자료가 아닙니다.`);
  const basis = value.roster_basis;
  if (!isRecord(basis) || typeof basis.patch_id !== "string" || typeof basis.cutoff !== "string" || typeof basis.fixture_only !== "boolean" ||
    !Array.isArray(basis.source_versions) || !basis.source_versions.every((item) => typeof item === "string")) {
    return fail("BAD_SHAPE", "연간 자료의 참조 로스터 근거 형식이 올바르지 않습니다.");
  }
  const parsedBasis: RosterBasis = { patch_id: basis.patch_id, cutoff: basis.cutoff, fixture_only: basis.fixture_only, source_versions: [...basis.source_versions as string[]] };
  if (basisKey(parsedBasis) !== basisKey(expected.basis) || value.cutoff !== expected.basis.cutoff || value.reference_patch !== expected.basis.patch_id) {
    return fail("BASIS_MISMATCH", "연간 자료의 참조 로스터(패치·기준 시각·출처)가 현재 스냅샷과 다릅니다.");
  }
  const cutoffMs = Date.parse(expected.basis.cutoff);
  const source = value.source;
  if (!isRecord(source) || typeof source.source_id !== "string" || typeof source.source_version !== "string" ||
    typeof source.content_hash !== "string" || !isTime(source.retrieved_at)) return fail("BAD_SHAPE", "연간 자료의 원본 정보 형식이 올바르지 않습니다.");
  if (Number.isNaN(cutoffMs) || Date.parse(source.retrieved_at) > cutoffMs) return fail("FUTURE_SOURCE", "기준 시각 이후에 취득한 원본으로 만든 연간 자료입니다.");
  const sourceToken = `${source.source_id}@${source.source_version}#${source.content_hash}`;
  if (!source.source_id || !source.source_version || !source.content_hash || !Array.isArray(value.source_versions) || value.source_versions.length !== 1 || value.source_versions[0] !== sourceToken) return fail("BAD_SHAPE", "연간 자료의 출처 정보가 서로 일치하지 않습니다.");
  const dataUpperMs = Math.min(cutoffMs, Date.parse(source.retrieved_at));
  const summary = value.import_summary;
  if (!isRecord(summary) || !isCount(summary.season_accepted_game_count)) return fail("BAD_SHAPE", "연간 자료의 집계 범위 형식이 올바르지 않습니다.");
  const counts = [summary.discovered_game_count, summary.accepted_game_count, summary.rejected_game_count].map(optCount);
  if (counts.some(Number.isNaN)) return fail("BAD_SHAPE", "연간 자료의 원본 경기 수 형식이 올바르지 않습니다.");
  if ((counts[0] !== null && counts[1] !== null && counts[2] !== null && counts[0] !== counts[1] + counts[2]) || (counts[1] !== null && summary.season_accepted_game_count > counts[1])) return fail("BAD_SHAPE", "원본 전체와 시즌 경기 수가 일치하지 않습니다.");
  const seasonFirst = summary.season_first_observed_at ?? null, seasonLast = summary.season_last_observed_at ?? null;
  const summaryPeriod = period(seasonFirst, seasonLast, summary.season_accepted_game_count, dataUpperMs, season);
  if (summaryPeriod) return fail(summaryPeriod === "FUTURE" ? "FUTURE_SOURCE" : "BAD_SHAPE", "연간 자료의 기간이 원본 취득 시각 또는 시즌과 맞지 않습니다.");
  if (value.recent_game_limit !== 20) return fail("BAD_SHAPE", "최근 경기 범위 형식이 올바르지 않습니다.");
  if (!Array.isArray(value.players) || !isCount(value.player_count) || value.player_count !== value.players.length) return fail("BAD_SHAPE", "선수 목록 형식이 올바르지 않습니다.");

  const players = new Map<string, SeasonPlayer>();
  for (const item of value.players) {
    if (!isRecord(item) || typeof item.team_id !== "string" || typeof item.player_id !== "string" || !item.team_id || !item.player_id ||
      typeof item.team_name !== "string" || typeof item.player_name !== "string" || !isCount(item.games) || !isRecord(item.roles) ||
      !["FOUND", "NOT_FOUND", "UNSUPPORTED_ID"].includes(item.status as string)) return fail("BAD_SHAPE", "선수 기록 형식이 올바르지 않습니다.");
    const key = playerKey(item.team_id, item.player_id);
    if (players.has(key)) return fail("BAD_SHAPE", `같은 선수 기록이 중복되었습니다: ${item.player_id}`);
    const roles: Partial<Record<RosterRole, SeasonRole>> = {};
    let total = 0;
    for (const [role, raw] of Object.entries(item.roles)) {
      if (!isRosterRole(role) || !isRecord(raw)) return fail("BAD_SHAPE", "역할 기록 형식이 올바르지 않습니다.");
      const scopes = {} as Record<SeasonScope, SeasonScopeStats>;
      for (const scope of SEASON_SCOPES) {
        const stats = scopeStats(raw[scope], dataUpperMs, season);
        if (stats === "FUTURE") return fail("FUTURE_SOURCE", "기준 시각 이후 경기가 들어 있는 연간 자료입니다.");
        if (stats === "BAD") return fail("BAD_SHAPE", `역할별 집계 형식이 올바르지 않습니다: ${item.player_id} ${role}`);
        scopes[scope] = stats;
      }
      const annual = scopes.season;
      if (scopes.recent.games !== Math.min(annual.games, value.recent_game_limit) || scopes.patch.games > annual.games || annual.games < 1) {
        return fail("BAD_SHAPE", `역할별 범위 표본 수가 맞지 않습니다: ${item.player_id} ${role}`);
      }
      for (const subset of [scopes.recent, scopes.patch]) {
        if (subset.games && (Date.parse(subset.first_observed_at!) < Date.parse(annual.first_observed_at!) || Date.parse(subset.last_observed_at!) > Date.parse(annual.last_observed_at!))) return fail("BAD_SHAPE", "최근·패치 기간이 연간 기간을 벗어납니다.");
        for (const champion of subset.champions) if (champion.games > (annual.champions.find(c => championKey(c.champion_id) === championKey(champion.champion_id))?.games ?? 0)) return fail("BAD_SHAPE", "최근·패치 챔프 횟수가 연간 관측과 맞지 않습니다.");
      }
      const byPatch = breakdown(raw.by_patch, annual, dataUpperMs, season), byLeague = breakdown(raw.by_league, annual, dataUpperMs, season);
      if (!byPatch || !byLeague) return fail("BAD_SHAPE", `패치·리그 분해가 연간 표본과 맞지 않습니다: ${item.player_id} ${role}`);
      if ((byPatch.find(row => row.id === value.reference_patch)?.games ?? 0) !== scopes.patch.games) return fail("BAD_SHAPE", "참조 패치 표본이 패치별 분해와 맞지 않습니다.");
      roles[role] = { ...scopes, by_patch: byPatch, by_league: byLeague };
      total += annual.games;
    }
    if (total !== item.games || total > summary.season_accepted_game_count || (item.status === "FOUND") !== total > 0) return fail("BAD_SHAPE", `선수 표본 수가 맞지 않습니다: ${item.player_id}`);
    players.set(key, {
      team_id: item.team_id, team_name: item.team_name, player_id: item.player_id, player_name: item.player_name,
      status: item.status as SeasonPlayerStatus, games: item.games, roles,
    });
  }
  return {
    ok: true,
    value: {
      season,
      cutoff: value.cutoff as string,
      reference_patch: value.reference_patch as string,
      recent_game_limit: value.recent_game_limit,
      source: { source_id: source.source_id, source_version: source.source_version, content_hash: source.content_hash, retrieved_at: source.retrieved_at },
      import_summary: {
        discovered_game_count: counts[0], accepted_game_count: counts[1], rejected_game_count: counts[2],
        season_accepted_game_count: summary.season_accepted_game_count,
        season_first_observed_at: seasonFirst as string | null, season_last_observed_at: seasonLast as string | null,
      },
      players,
    },
  };
}

/** True when the archived source predates the snapshot cutoff (later games are not included). */
export const sourceIsOlder = (history: Pick<SeasonHistory, "source" | "cutoff">) => Date.parse(history.source.retrieved_at) < Date.parse(history.cutoff);

export type SeasonChampionRow = SeasonChampion & { state: PoolChampionState };

export type SeasonSlot = {
  role: RosterRole;
  /**
   * EMPTY: no player in the slot. UNCONFIRMED: player not found in the season file (unknown, not 0).
   * ZERO_IN_ROLE: player found, but 0 games in the assigned role within this scope.
   */
  status: "EMPTY" | "UNCONFIRMED" | "ZERO_IN_ROLE" | "OBSERVED";
  player: SeasonPlayer | null;
  scope: SeasonScope;
  stats: SeasonScopeStats | null;
  champions: SeasonChampionRow[];
  available_count: number;
  /** Season games of this player in other roles (context only, never merged into this role). */
  other_roles: { role: RosterRole; games: number }[];
  by_patch: SeasonBreakdown[];
  by_league: SeasonBreakdown[];
};

/** Season record of the slot's assigned (team, player) in the slot's assigned role. */
export function seasonSlot(input: {
  history: SeasonHistory;
  role: RosterRole;
  assigned: { source_team_id: string; player_id: string } | null;
  scope: SeasonScope;
  selections: readonly PoolSelection[];
  previousPicks: readonly string[];
}): SeasonSlot {
  const { history, role, assigned, scope, selections, previousPicks } = input;
  const base: SeasonSlot = { role, status: "EMPTY", player: null, scope, stats: null, champions: [], available_count: 0, other_roles: [], by_patch: [], by_league: [] };
  if (!assigned) return base;
  const player = history.players.get(playerKey(assigned.source_team_id, assigned.player_id)) ?? null;
  if (!player || player.status !== "FOUND") return { ...base, status: "UNCONFIRMED", player };
  const other_roles = Object.entries(player.roles)
    .filter(([other]) => other !== role)
    .map(([other, record]) => ({ role: other as RosterRole, games: record!.season.games }));
  const record = player.roles[role];
  const stats = record?.[scope] ?? null;
  if (!record || !stats || stats.games === 0) {
    return { ...base, status: "ZERO_IN_ROLE", player, stats, other_roles, by_patch: record?.by_patch ?? [], by_league: record?.by_league ?? [] };
  }
  const champions = stats.champions.map((champion) => ({ ...champion, state: poolChampionState(champion.champion_id, selections, previousPicks) }));
  return {
    role, status: "OBSERVED", player, scope, stats, champions,
    available_count: champions.filter((champion) => champion.state === "AVAILABLE").length,
    other_roles, by_patch: record.by_patch, by_league: record.by_league,
  };
}

/**
 * Fetch and validate the season file. Rejects an oversized body before reading when the server
 * declares its length. Aborting (team/basis change, panel close) rejects with AbortError.
 */
export async function loadPlayerSeasonHistory(url: string | URL, expected: { basis: RosterBasis; season?: number }, signal?: AbortSignal): Promise<SeasonResult<SeasonHistory>> {
  let response: Response;
  try { response = await fetch(url, { signal }); }
  catch (error) { if (signal?.aborted) throw error; return fail("UNAVAILABLE", "연간 자료를 불러오지 못했습니다."); }
  if (!response.ok) return fail("UNAVAILABLE", `연간 자료가 아직 배포되지 않았습니다 (HTTP ${response.status}).`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PLAYER_SEASON_BYTES) return fail("TOO_LARGE", "연간 자료 파일이 3MB를 넘습니다.");
  let text: string;
  try { text = await response.text(); }
  catch (error) { if (signal?.aborted) throw error; return fail("UNAVAILABLE", "연간 자료를 읽지 못했습니다."); }
  return parsePlayerSeasonHistory(text, expected);
}
