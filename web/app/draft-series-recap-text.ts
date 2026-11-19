import type { SeriesRecap, SeriesRecapSide } from "./draft-series-recap";

/**
 * Plain Korean text for an already computed Fearless series recap. Pure: it never re-runs the recap or
 * the result builder, never adds a game the recap does not contain, and never exports raw rows or JSON.
 * Any unconfirmed game or an unconfirmed total lock list refuses the whole share instead of a partial one.
 */
export type SeriesRecapTextRefusal = "NO_FINISHED_GAME" | "UNSUPPORTED_GAME" | "UNVERIFIED_TOTAL" | "INVALID_RECAP";
export type SeriesRecapTextResult =
  | { ok: true; text: string; game_count: number }
  | { ok: false; reason: SeriesRecapTextRefusal };
export type SeriesRecapTextInput = { recap: SeriesRecap; patchId: string; cutoff: string; nameOf: (id: string) => string };

export const SERIES_TEXT_NAME_MAX = 40;
const META_MAX = 40;

/** Removes control, format (incl. bidi/zero-width) and line/paragraph separators, collapses spaces, caps length. */
export function cleanShareName(value: unknown, max = SERIES_TEXT_NAME_MAX): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/gu, " ").trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : flat;
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");
const isSide = (value: unknown, side: "BLUE" | "RED"): value is SeriesRecapSide => {
  const s = value as SeriesRecapSide;
  return Boolean(s) && typeof s === "object" && s.side === side && typeof s.team_name === "string" &&
    isStrings(s.picks) && s.picks.length === 5 && isStrings(s.bans) && s.bans.length === 5;
};

export function buildSeriesRecapText({ recap, patchId, cutoff, nameOf }: SeriesRecapTextInput): SeriesRecapTextResult {
  const games = recap && Array.isArray(recap.games) ? recap.games : null;
  if (!games) return { ok: false, reason: "INVALID_RECAP" };
  if (!games.length) return { ok: false, reason: "NO_FINISHED_GAME" };
  if (games.some((g) => !g || typeof g !== "object" || g.status !== "READY")) return { ok: false, reason: "UNSUPPORTED_GAME" };
  if (!isStrings(recap.total_locks)) return { ok: false, reason: "UNVERIFIED_TOTAL" };
  for (const [index, g] of games.entries()) {
    if (g.status !== "READY" || g.game !== index + 1 || (g.first_pick_side !== "BLUE" && g.first_pick_side !== "RED") ||
      !isStrings(g.locks_before) || !isStrings(g.new_locks) || !Array.isArray(g.sides) || g.sides.length !== 2 ||
      !isSide(g.sides[0], "BLUE") || !isSide(g.sides[1], "RED")) return { ok: false, reason: "INVALID_RECAP" };
  }

  const champ = (id: string) => {
    let name: unknown;
    try { name = nameOf(id); } catch { name = undefined; }
    return cleanShareName(name) || cleanShareName(id) || "(이름 미확인)";
  };
  const list = (ids: string[]) => ids.length ? ids.map(champ).join(", ") : "없음";
  const team = (side: SeriesRecapSide) => `${side.side === "BLUE" ? "블루" : "레드"} ${cleanShareName(side.team_name) || "(팀 이름 미확인)"}`;
  const patch = cleanShareName(patchId, META_MAX) || "미확인";
  const day = cleanShareName(cutoff, META_MAX) || "미확인";

  const lines = [`피어리스 여러 세트 밴픽 기록 · 완료 ${games.length}세트`, `자료 기준: 패치 ${patch} · 기준일 ${day}`];
  for (const g of games) {
    if (g.status !== "READY") continue; // narrowed above; kept for the type checker
    const [blue, red] = g.sides;
    lines.push("", `[${g.game}세트${g.current ? " · 방금 완료" : ""}] ${team(blue)} vs ${team(red)} · 선픽 ${g.first_pick_side === "BLUE" ? "블루" : "레드"}`);
    for (const side of [blue, red]) {
      lines.push(`- ${team(side)} 픽 5: ${list(side.picks)}`, `- ${team(side)} 밴 5: ${list(side.bans)}`);
    }
    lines.push(`- 이 세트 전 잠금 ${g.locks_before.length}개 · 다음 세트부터 잠기는 픽 ${g.new_locks.length}개: ${list(g.new_locks)}`);
  }
  lines.push("", `지금까지 잠긴 챔피언 ${recap.total_locks.length}개: ${list(recap.total_locks)}`, "",
    "안내: 완료한 세트의 밴픽 기록만 정리했어요. 선수 구성과 명시 포지션은 이 요약 범위가 아니에요. 경기 승패·승률 계산이나 예측이 아니에요.");
  return { ok: true, text: lines.join("\n"), game_count: games.length };
}
