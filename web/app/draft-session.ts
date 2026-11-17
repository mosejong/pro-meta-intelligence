import { championAssetId } from "./champion-assets";
import { applyDraftSelection, completeFearlessGame, DRAFT_MODEL_VERSION, fearlessLocks, isChampionLocked, nextDraftTurn, type DraftGame, type DraftSelection, type DraftSide } from "./draft-agent";
import { isRadarReport, type RadarReport } from "./radar-types";

export const MAX_DRAFT_FILE_BYTES = 16 * 1024 * 1024;
export type DraftSession = {
  report: RadarReport;
  blueTeamId: string;
  redTeamId: string;
  games: DraftGame[];
  selections: DraftSelection[];
  stagedChampion: string | null;
  firstPickSide: DraftSide;
};
/**
 * Stable parse-failure codes. `error` keeps the existing Korean text for current callers;
 * UIs translate by `code`. Korean text must match `session.error.<CODE>` in locale-messages.ts.
 */
export const DRAFT_SESSION_ERROR_TEXT = {
  SIZE_LIMIT: "시나리오 파일은 16MB 이하여야 합니다.",
  INVALID_JSON: "JSON 파일을 읽을 수 없습니다. 저장한 시나리오 파일을 선택하세요.",
  UNSUPPORTED_FORMAT: "지원하는 피어리스 시나리오 파일이 아닙니다.",
  INVALID_FIRST_PICK_SIDE: "선픽 진영이 올바르지 않습니다.",
  MODEL_VERSION_MISMATCH: "분석 버전이 다릅니다. 같은 결과를 보장할 수 없어 불러오지 않았습니다.",
  MISSING_ANALYSIS: "분석 데이터가 없거나 손상되었습니다.",
  SNAPSHOT_MISMATCH: "패치 또는 기준 시점이 분석 데이터와 일치하지 않습니다.",
  INVALID_SAMPLE: "분석 표본이나 순위 값이 올바르지 않습니다.",
  MISSING_TEAMS: "두 팀 정보가 필요합니다.",
  INVALID_TEAMS: "분석 데이터에 있는 서로 다른 두 팀을 선택해야 합니다.",
  INVALID_PREVIOUS_GAMES: "이전 세트 기록이 올바르지 않습니다.",
  PREVIOUS_MATCHUP_MISMATCH: "이전 세트의 대진이 현재 대진과 다릅니다.",
  PREVIOUS_FIRST_PICK_SIDE: "이전 세트의 선픽 진영이 올바르지 않습니다.",
  PREVIOUS_SELECTIONS: "이전 세트에 중복 선택 또는 잘못된 밴픽 순서가 있습니다.",
  PREVIOUS_GAME_INCOMPLETE: "완료되지 않았거나 피어리스 규칙에 어긋난 이전 세트입니다.",
  CURRENT_GAME: "현재 세트 기록 또는 세트 번호가 올바르지 않습니다.",
  STAGED_CHAMPION: "올려놓은 챔피언이 이미 잠겼거나 선택할 수 없습니다.",
} as const;
export type DraftSessionErrorCode = keyof typeof DRAFT_SESSION_ERROR_TEXT;
export const DRAFT_SESSION_ERROR_CODES = Object.keys(DRAFT_SESSION_ERROR_TEXT) as DraftSessionErrorCode[];
export function isDraftSessionErrorCode(value: unknown): value is DraftSessionErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DRAFT_SESSION_ERROR_TEXT, value);
}
export type DraftSessionResult = { ok: true; session: DraftSession } | { ok: false; error: string; code: DraftSessionErrorCode };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validChampion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && /^[A-Za-z][A-Za-z0-9]*$/.test(championAssetId(value));
}

function replaySelections(value: unknown, locks: string[], firstPickSide: DraftSide = "BLUE"): DraftSelection[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  let selections: DraftSelection[] = [];
  for (const item of value) {
    const expected = nextDraftTurn(selections, firstPickSide);
    if (!record(item) || !expected || !validChampion(item.champion_id) || item.turn !== selections.length + 1 ||
      item.side !== expected.side || item.kind !== expected.kind || item.slot !== expected.slot || item.phase !== expected.phase) return null;
    const next = applyDraftSelection(selections, item.champion_id, locks, firstPickSide);
    if (next === selections) return null;
    selections = next;
  }
  return selections;
}

/** Read local/exported data as untrusted input; never trust serialized lock lists. */
export function parseDraftSession(text: string): DraftSessionResult {
  const fail = (code: DraftSessionErrorCode): DraftSessionResult => ({ ok: false, error: DRAFT_SESSION_ERROR_TEXT[code], code });
  if (new TextEncoder().encode(text).byteLength > MAX_DRAFT_FILE_BYTES) return fail("SIZE_LIMIT");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("INVALID_JSON"); }
  if (!record(value) || value.artifact_type !== "public-draft-scenario" || (value.schema_version !== "2" && value.schema_version !== "3") || value.format !== "HARD_FEARLESS_5_BAN_5_PICK") return fail("UNSUPPORTED_FORMAT");
  const firstPickSide = value.schema_version === "2" ? "BLUE" : value.first_pick_side;
  if (firstPickSide !== "BLUE" && firstPickSide !== "RED") return fail("INVALID_FIRST_PICK_SIDE");
  if (value.model_version !== DRAFT_MODEL_VERSION) return fail("MODEL_VERSION_MISMATCH");
  if (!isRadarReport(value.analysis_snapshot) || !value.analysis_snapshot.opponent_prep) return fail("MISSING_ANALYSIS");
  const report = value.analysis_snapshot;
  if (value.patch_id !== report.patch_id || value.cutoff !== report.cutoff || report.opponent_prep?.patch_id !== report.patch_id) return fail("SNAPSHOT_MISMATCH");
  const teams = report.opponent_prep!.teams;
  if (new Set(teams.map((team) => team.team_id)).size !== teams.length || teams.some((team) =>
    !Number.isSafeInteger(team.game_count) || team.game_count < 0 ||
    [...team.priority_picks, ...team.frequent_bans, ...team.received_bans].some((pick) => !validChampion(pick.champion_id) || !Number.isFinite(pick.game_rate) || pick.game_rate < 0 || pick.game_rate > 1 ||
      ![pick.game_count, pick.phase_1_count, pick.phase_2_count].every((count) => Number.isSafeInteger(count) && count >= 0))) ||
    report.entries.some((entry) => !validChampion(entry.champion_id) || !Number.isSafeInteger(entry.rank) || entry.rank < 1)) return fail("INVALID_SAMPLE");
  if (!record(value.blue_team) || !record(value.red_team)) return fail("MISSING_TEAMS");
  const blue = teams.find((team) => team.team_id === (value.blue_team as Record<string, unknown>).team_id);
  const red = teams.find((team) => team.team_id === (value.red_team as Record<string, unknown>).team_id);
  if (!blue || !red || blue.team_id === red.team_id) return fail("INVALID_TEAMS");
  if (!Array.isArray(value.previous_games) || value.previous_games.length > 99) return fail("INVALID_PREVIOUS_GAMES");
  let games: DraftGame[] = [];
  for (const game of value.previous_games) {
    if (!record(game) || ![blue.team_id, red.team_id].includes(String(game.blue_team_id)) ||
      ![blue.team_id, red.team_id].includes(String(game.red_team_id))) return fail("PREVIOUS_MATCHUP_MISMATCH");
    const gameFirstSide = value.schema_version === "3" && Array.isArray(game.selections) && record(game.selections[0]) ? game.selections[0].side : "BLUE";
    if (gameFirstSide !== "BLUE" && gameFirstSide !== "RED") return fail("PREVIOUS_FIRST_PICK_SIDE");
    const selections = replaySelections(game.selections, fearlessLocks(games), gameFirstSide);
    if (!selections) return fail("PREVIOUS_SELECTIONS");
    const next = completeFearlessGame(games, { blue_team_id: String(game.blue_team_id), red_team_id: String(game.red_team_id), selections });
    if (next === games) return fail("PREVIOUS_GAME_INCOMPLETE");
    games = next;
  }
  const locks = fearlessLocks(games);
  const selections = replaySelections(value.selections, locks, firstPickSide);
  if (!selections || value.game_number !== games.length + 1 || value.complete !== (selections.length === 20)) return fail("CURRENT_GAME");
  const stagedChampion = value.staged_champion ?? null;
  if (stagedChampion !== null && (!validChampion(stagedChampion) || !nextDraftTurn(selections) || isChampionLocked(selections, stagedChampion, locks))) return fail("STAGED_CHAMPION");
  return { ok: true, session: { report, blueTeamId: blue.team_id, redTeamId: red.team_id, games, selections, stagedChampion, firstPickSide } };
}

// IndexedDB accommodates the complete public snapshot without localStorage's small quota.
export const DRAFT_STORAGE_TIMEOUT_MS = 10_000;

function openDraftDatabase(timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
    const timer = setTimeout(() => fail(new Error("Draft storage open timed out")), timeoutMs);
    try {
      const request = indexedDB.open("pro-meta-draft", 1);
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return; }
        request.result.createObjectStore("sessions");
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true; clearTimeout(timer); resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Draft storage is blocked by another connection"));
    } catch (error) { fail(error); }
  });
}

export async function readLocalDraft(timeoutMs = DRAFT_STORAGE_TIMEOUT_MS): Promise<string | null> {
  const database = await openDraftDatabase(timeoutMs);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("sessions", "readonly");
      const timer = setTimeout(() => { reject(new Error("Draft storage read timed out")); transaction.abort(); }, timeoutMs);
      let request: IDBRequest;
      try { request = transaction.objectStore("sessions").get("current"); }
      catch (error) { clearTimeout(timer); reject(error); transaction.abort(); return; }
      request.onsuccess = () => { clearTimeout(timer); resolve(typeof request.result === "string" ? request.result : null); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      transaction.onabort = () => { clearTimeout(timer); reject(transaction.error ?? new Error("Draft storage read aborted")); };
    });
  } finally { database.close(); }
}

async function persistLocalDraft(text: string, timeoutMs: number): Promise<void> {
  const database = await openDraftDatabase(timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sessions", "readwrite");
      const timer = setTimeout(() => { reject(new Error("Draft storage write timed out")); transaction.abort(); }, timeoutMs);
      try { transaction.objectStore("sessions").put(text, "current"); }
      catch (error) { clearTimeout(timer); reject(error); transaction.abort(); return; }
      transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
      transaction.onerror = () => { clearTimeout(timer); reject(transaction.error); };
      transaction.onabort = () => { clearTimeout(timer); reject(transaction.error); };
    });
  } finally { database.close(); }
}

let pendingWrite: Promise<void> = Promise.resolve();
export function writeLocalDraft(text: string, timeoutMs = DRAFT_STORAGE_TIMEOUT_MS): Promise<void> {
  pendingWrite = pendingWrite.catch(() => undefined).then(() => persistLocalDraft(text, timeoutMs));
  return pendingWrite;
}
