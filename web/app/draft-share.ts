import { championAssetId } from "./champion-assets";
import { SHARE_CHAMPIONS } from "./share-champion-ids";
import { applyDraftSelection, completeFearlessGame, DRAFT_MODEL_VERSION, fearlessLocks, nextDraftTurn, serializeDraftScenario, type DraftSelection, type DraftGame, type DraftSide } from "./draft-agent";
import { parseDraftSession, type DraftSession } from "./draft-session";
import type { RadarReport } from "./radar-types";

export const SHARE_SCOPE = "팀·밴픽만 공유합니다. 선수 변경·역할 배정은 포함하지 않습니다. 분석은 받는 사람의 현재 자료를 사용합니다.";
export const MAX_SHARE_URL = 12_000;
export const MAX_SHARE_BYTES = 8_000;
const champions = new Map(SHARE_CHAMPIONS.flatMap(([name, id]) => [[championAssetId(name).toLowerCase(), id], [id.toLowerCase(), id]] as [string, string][]));
function champion(value: unknown): string {
  if (typeof value !== "string" || value.length > 80) throw new Error("챔피언 정보가 올바르지 않습니다.");
  const id = champions.get(championAssetId(value).toLowerCase());
  if (!id) throw new Error("알 수 없는 챔피언이 포함되어 있습니다.");
  return id;
}
function side(value: unknown): DraftSide {
  if (value !== "BLUE" && value !== "RED") throw new Error("선픽 진영이 올바르지 않습니다.");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("밴픽 링크가 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
const pack = (items: DraftSelection[]) => items.map(s => [s.turn, s.side, s.kind, s.slot, s.phase, champion(s.champion_id)]);
function replay(value: unknown, locks: string[], first: DraftSide): DraftSelection[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("밴픽 순서가 올바르지 않습니다.");
  let selections: DraftSelection[] = [];
  for (const item of value) {
    const turn = nextDraftTurn(selections, first);
    if (!Array.isArray(item) || item.length !== 6 || !turn || item[0] !== selections.length + 1 || item[1] !== turn.side || item[2] !== turn.kind || item[3] !== turn.slot || item[4] !== turn.phase) throw new Error("밴픽 순서가 올바르지 않습니다.");
    const next = applyDraftSelection(selections, champion(item[5]), locks, first);
    if (next === selections) throw new Error("중복되거나 잠긴 챔피언이 있습니다.");
    selections = next;
  }
  return selections;
}
function restore(value: unknown, report: RadarReport): DraftSession {
  const data = object(value);
  if (data.schema !== "draft-link" || data.version !== 1 || data.model !== DRAFT_MODEL_VERSION) throw new Error("지원하지 않는 밴픽 링크입니다.");
  if (data.patch !== report.patch_id) throw new Error("패치가 달라 불러올 수 없습니다.");
  const teams = report.opponent_prep?.teams ?? [];
  const blue = teams.find(t => t.team_id === data.blue), red = teams.find(t => t.team_id === data.red);
  if (!blue || !red || blue.team_id === red.team_id) throw new Error("현재 자료에 있는 서로 다른 두 팀이 필요합니다.");
  if (!Array.isArray(data.games) || data.games.length > 9) throw new Error("이전 세트는 9개까지 공유할 수 있습니다.");
  let games: DraftGame[] = [];
  for (const value of data.games) {
    const game = object(value);
    if (![blue.team_id, red.team_id].includes(game.blue as string) || ![blue.team_id, red.team_id].includes(game.red as string) || game.blue === game.red) throw new Error("이전 세트의 팀이 올바르지 않습니다.");
    const selections = replay(game.turns, fearlessLocks(games), side(game.first));
    const next = completeFearlessGame(games, { blue_team_id: game.blue as string, red_team_id: game.red as string, selections });
    if (next === games) throw new Error("완료되지 않은 이전 세트입니다.");
    games = next;
  }
  const first = side(data.first);
  const selections = replay(data.turns, fearlessLocks(games), first);
  const staged = data.stage === null ? null : champion(data.stage);
  const result = parseDraftSession(serializeDraftScenario(report, blue, red, selections, games, staged, first));
  if (!result.ok) throw new Error(result.error);
  return result.session;
}
export function createDraftShareUrl(href: string, session: DraftSession): string {
  const url = new URL(href);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("안전한 주소에서 링크를 만들어 주세요.");
  const data = { schema: "draft-link", version: 1, model: DRAFT_MODEL_VERSION, patch: session.report.patch_id,
    blue: session.blueTeamId, red: session.redTeamId, first: session.firstPickSide,
    games: session.games.map(g => ({ blue: g.blue_team_id, red: g.red_team_id, first: g.selections[0]?.side, turns: pack(g.selections) })),
    turns: pack(session.selections), stage: session.stagedChampion === null ? null : champion(session.stagedChampion) };
  restore(data, session.report);
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length > MAX_SHARE_BYTES) throw new Error("공유할 밴픽이 너무 큽니다.");
  url.search = "";
  url.hash = "draft=" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (url.href.length > MAX_SHARE_URL) throw new Error("공유 링크가 너무 깁니다.");
  return url.href;
}
export function parseDraftShareUrl(href: string, report: RadarReport): DraftSession {
  if (href.length > MAX_SHARE_URL) throw new Error("공유 링크가 너무 깁니다.");
  const hash = new URL(href).hash;
  const encoded = hash.slice(7);
  if (!hash.startsWith("#draft=") || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) throw new Error("밴픽 링크가 올바르지 않습니다.");
  let data: unknown;
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    if (binary.length > MAX_SHARE_BYTES || btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== encoded) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    data = JSON.parse(text);
  } catch { throw new Error("밴픽 링크가 손상되었거나 허용 크기를 넘었습니다."); }
  return restore(data, report);
}
