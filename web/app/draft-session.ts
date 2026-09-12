import { championAssetId } from "./champion-assets";
import { applyDraftSelection, completeFearlessGame, DRAFT_MODEL_VERSION, fearlessLocks, isChampionLocked, nextDraftTurn, type DraftGame, type DraftSelection } from "./draft-agent";
import { isRadarReport, type RadarReport } from "./radar-types";

export const MAX_DRAFT_FILE_BYTES = 16 * 1024 * 1024;
export type DraftSession = {
  report: RadarReport;
  blueTeamId: string;
  redTeamId: string;
  games: DraftGame[];
  selections: DraftSelection[];
  stagedChampion: string | null;
};
export type DraftSessionResult = { ok: true; session: DraftSession } | { ok: false; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validChampion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && /^[A-Za-z][A-Za-z0-9]*$/.test(championAssetId(value));
}

function replaySelections(value: unknown, locks: string[]): DraftSelection[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  let selections: DraftSelection[] = [];
  for (const item of value) {
    const expected = nextDraftTurn(selections);
    if (!record(item) || !expected || !validChampion(item.champion_id) || item.turn !== selections.length + 1 ||
      item.side !== expected.side || item.kind !== expected.kind || item.slot !== expected.slot || item.phase !== expected.phase) return null;
    const next = applyDraftSelection(selections, item.champion_id, locks);
    if (next === selections) return null;
    selections = next;
  }
  return selections;
}

/** Read local/exported data as untrusted input; never trust serialized lock lists. */
export function parseDraftSession(text: string): DraftSessionResult {
  const fail = (error: string): DraftSessionResult => ({ ok: false, error });
  if (new TextEncoder().encode(text).byteLength > MAX_DRAFT_FILE_BYTES) return fail("시나리오 파일은 16MB 이하여야 합니다.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("JSON 파일을 읽을 수 없습니다. 저장한 시나리오 파일을 선택하세요."); }
  if (!record(value) || value.artifact_type !== "public-draft-scenario" || value.schema_version !== "2" || value.format !== "HARD_FEARLESS_5_BAN_5_PICK") return fail("지원하는 피어리스 시나리오 파일이 아닙니다.");
  if (value.model_version !== DRAFT_MODEL_VERSION) return fail("분석 버전이 다릅니다. 같은 결과를 보장할 수 없어 불러오지 않았습니다.");
  if (!isRadarReport(value.analysis_snapshot) || !value.analysis_snapshot.opponent_prep) return fail("분석 데이터가 없거나 손상되었습니다.");
  const report = value.analysis_snapshot;
  if (value.patch_id !== report.patch_id || value.cutoff !== report.cutoff || report.opponent_prep?.patch_id !== report.patch_id) return fail("패치 또는 기준 시점이 분석 데이터와 일치하지 않습니다.");
  const teams = report.opponent_prep!.teams;
  if (new Set(teams.map((team) => team.team_id)).size !== teams.length || teams.some((team) =>
    !Number.isSafeInteger(team.game_count) || team.game_count < 0 ||
    [...team.priority_picks, ...team.frequent_bans, ...team.received_bans].some((pick) => !validChampion(pick.champion_id) || !Number.isFinite(pick.game_rate) || pick.game_rate < 0 || pick.game_rate > 1 ||
      ![pick.game_count, pick.phase_1_count, pick.phase_2_count].every((count) => Number.isSafeInteger(count) && count >= 0))) ||
    report.entries.some((entry) => !validChampion(entry.champion_id) || !Number.isSafeInteger(entry.rank) || entry.rank < 1)) return fail("분석 표본이나 순위 값이 올바르지 않습니다.");
  if (!record(value.blue_team) || !record(value.red_team)) return fail("두 팀 정보가 필요합니다.");
  const blue = teams.find((team) => team.team_id === (value.blue_team as Record<string, unknown>).team_id);
  const red = teams.find((team) => team.team_id === (value.red_team as Record<string, unknown>).team_id);
  if (!blue || !red || blue.team_id === red.team_id) return fail("분석 데이터에 있는 서로 다른 두 팀을 선택해야 합니다.");
  if (!Array.isArray(value.previous_games) || value.previous_games.length > 99) return fail("이전 세트 기록이 올바르지 않습니다.");
  let games: DraftGame[] = [];
  for (const game of value.previous_games) {
    if (!record(game) || ![blue.team_id, red.team_id].includes(String(game.blue_team_id)) ||
      ![blue.team_id, red.team_id].includes(String(game.red_team_id))) return fail("이전 세트의 대진이 현재 대진과 다릅니다.");
    const selections = replaySelections(game.selections, fearlessLocks(games));
    if (!selections) return fail("이전 세트에 중복 선택 또는 잘못된 밴픽 순서가 있습니다.");
    const next = completeFearlessGame(games, { blue_team_id: String(game.blue_team_id), red_team_id: String(game.red_team_id), selections });
    if (next === games) return fail("완료되지 않았거나 피어리스 규칙에 어긋난 이전 세트입니다.");
    games = next;
  }
  const locks = fearlessLocks(games);
  const selections = replaySelections(value.selections, locks);
  if (!selections || value.game_number !== games.length + 1 || value.complete !== (selections.length === 20)) return fail("현재 세트 기록 또는 세트 번호가 올바르지 않습니다.");
  const stagedChampion = value.staged_champion ?? null;
  if (stagedChampion !== null && (!validChampion(stagedChampion) || !nextDraftTurn(selections) || isChampionLocked(selections, stagedChampion, locks))) return fail("올려놓은 챔피언이 이미 잠겼거나 선택할 수 없습니다.");
  return { ok: true, session: { report, blueTeamId: blue.team_id, redTeamId: red.team_id, games, selections, stagedChampion } };
}

// IndexedDB accommodates the complete public snapshot without localStorage's small quota.
function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pro-meta-draft", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readLocalDraft(): Promise<string | null> {
  const database = await openDraftDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("sessions", "readonly").objectStore("sessions").get("current");
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function persistLocalDraft(text: string): Promise<void> {
  const database = await openDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put(text, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

let pendingWrite: Promise<void> = Promise.resolve();
export function writeLocalDraft(text: string): Promise<void> {
  pendingWrite = pendingWrite.catch(() => undefined).then(() => persistLocalDraft(text));
  return pendingWrite;
}
