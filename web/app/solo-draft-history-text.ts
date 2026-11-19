import type { SoloDraftEvidence } from "./solo-draft";

/**
 * Plain Korean text of the current set's frozen auto-choice review, for an explicit user export only
 * (clipboard copy or a user-requested .txt download of exactly this text).
 * Reads the already-frozen records as they are: no re-suggest/explain/simulate, no model call, no app
 * storage/restore, link or room here (local note autosave lives in solo-review-autosave.ts and never
 * changes this text). Raw context/prefix/reason strings, player ids and JSON are never emitted.
 * Any inconsistency refuses the whole text instead of exporting a partial review.
 */
export type SoloHistoryTextRefusal =
  | "EMPTY" | "INVALID_BASIS" | "INVALID_HISTORY" | "MIXED_CONTEXT" | "INCONSISTENT_ORDER"
  | "EXPLANATION_MISMATCH" | "UNKNOWN_EVIDENCE" | "INVALID_NAME" | "TOO_LONG";
export type SoloHistoryTextResult = { ok: true; text: string } | { ok: false; reason: SoloHistoryTextRefusal };
export type SoloHistoryTextInput = {
  history: unknown;
  patchId: unknown;
  cutoff: unknown;
  nameOf: unknown;
};

export const SOLO_HISTORY_TEXT_MAX_TURNS = 20;
export const SOLO_HISTORY_TEXT_MAX_LENGTH = 8000;
const NAME_MAX = 40;
const TEAM_MAX = 40;
const BASIS_MAX = 64;
const ALTERNATIVES_SHOWN = 2;

class Refusal extends Error {
  constructor(readonly reason: SoloHistoryTextRefusal) { super(reason); }
}
const fail = (reason: SoloHistoryTextRefusal): never => { throw new Refusal(reason); };

/** Control, format (incl. bidi/zero-width) and line/paragraph separators are removed; whitespace collapsed. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export function cleanSoloHistoryName(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : flat;
}

const EVIDENCE: ReadonlySet<string> = new Set<SoloDraftEvidence>(["TEAM_PRIORITY", "PLAYER_CURRENT", "PLAYER_SEASON", "RADAR_META", "RADAR_FRAME", "FALLBACK"]);
const ROLE_TEXT: Readonly<Record<string, string>> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", ADC: "바텀", SUPPORT: "서포터" };

function evidenceText(evidence: SoloDraftEvidence, team: string): string {
  switch (evidence) {
    case "TEAM_PRIORITY": return `${team}의 공개 우선 픽 기록`;
    case "PLAYER_CURRENT": return `${team} 현재 관측 선수의 공개 기록`;
    case "PLAYER_SEASON": return "같은 팀 현재 관측 선수 시즌 기록(시즌 기록이며 현재 패치의 강함을 뜻하지 않음)";
    case "RADAR_META": return "현재 레이더 검토 가능 메타";
    case "RADAR_FRAME": return "공개 레이더 후보";
    case "FALLBACK": return "사용할 기록 없음 · 고정 규칙(챔피언 목록 순서)";
  }
}

type Choice = { champion_id: string; evidence: SoloDraftEvidence; roles: string[]; role_supported?: boolean };
type Explained = { kind: "BAN" | "PICK"; side: "BLUE" | "RED"; team: string; selected: Choice; alternatives: Choice[] };
type Entry = { turn: number; champion_id: string; prefix: string[]; context: string; explanation: Explained | null };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;

function readChoice(value: unknown): Choice {
  if (!isObject(value) || !isId(value.champion_id)) return fail("INVALID_HISTORY");
  const choice = value as Record<string, unknown>;
  if (typeof choice.evidence !== "string" || !EVIDENCE.has(choice.evidence)) return fail("UNKNOWN_EVIDENCE");
  if (!Array.isArray(choice.inferred_roles)) return fail("INVALID_HISTORY");
  const roles = (choice.inferred_roles as unknown[]).map(role => typeof role === "string" && Object.prototype.hasOwnProperty.call(ROLE_TEXT, role) ? ROLE_TEXT[role] : fail("UNKNOWN_EVIDENCE"));
  if (choice.role_supported !== undefined && typeof choice.role_supported !== "boolean") return fail("INVALID_HISTORY");
  return { champion_id: choice.champion_id as string, evidence: choice.evidence as SoloDraftEvidence, roles: [...new Set(roles)], role_supported: choice.role_supported as boolean | undefined };
}

function readExplanation(value: unknown, turn: number, championId: string): Explained | null {
  if (value === null) return null;
  if (!isObject(value)) return fail("INVALID_HISTORY");
  if (value.turn !== turn) return fail("EXPLANATION_MISMATCH");
  if (value.kind !== "BAN" && value.kind !== "PICK") return fail("UNKNOWN_EVIDENCE");
  if (value.side !== "BLUE" && value.side !== "RED") return fail("UNKNOWN_EVIDENCE");
  if (value.record_scope !== "OPPOSING_TEAM" && value.record_scope !== "ACTING_TEAM") return fail("UNKNOWN_EVIDENCE");
  if (typeof value.season_evidence !== "boolean" || !Array.isArray(value.alternatives)) return fail("INVALID_HISTORY");
  const teamName = cleanSoloHistoryName(value.record_team, TEAM_MAX);
  if (!teamName) return fail("INVALID_NAME");
  const selected = readChoice(value.selected);
  if (selected.champion_id !== championId) return fail("EXPLANATION_MISMATCH");
  const alternatives = (value.alternatives as unknown[]).map(readChoice);
  const team = `${value.record_scope === "OPPOSING_TEAM" ? "상대 팀" : "행동 팀"}(${teamName})`;
  return { kind: value.kind as Explained["kind"], side: value.side as Explained["side"], team, selected, alternatives };
}

function readHistory(history: unknown): Entry[] {
  if (!Array.isArray(history)) return fail("INVALID_HISTORY");
  if (history.length === 0) return fail("EMPTY");
  if (history.length > SOLO_HISTORY_TEXT_MAX_TURNS) return fail("INVALID_HISTORY");
  const entries = (history as unknown[]).map((value): Entry => {
    if (!isObject(value)) return fail("INVALID_HISTORY");
    const { turn, champion_id, prefix, context } = value;
    if (typeof turn !== "number" || !Number.isInteger(turn) || turn < 1 || turn > SOLO_HISTORY_TEXT_MAX_TURNS) return fail("INVALID_HISTORY");
    if (!isId(champion_id) || typeof context !== "string" || !context) return fail("INVALID_HISTORY");
    if (!Array.isArray(prefix) || prefix.length !== turn - 1 || !prefix.every(isId)) return fail("INVALID_HISTORY");
    return { turn, champion_id, prefix: [...prefix] as string[], context, explanation: readExplanation(value.explanation, turn, champion_id) };
  });
  if (new Set(entries.map(e => e.turn)).size !== entries.length) return fail("INVALID_HISTORY");
  if (entries.some(e => e.context !== entries[0].context)) return fail("MIXED_CONTEXT");
  const ordered = entries.sort((a, b) => a.turn - b.turn);
  // Every earlier entry must sit, with its own prefix, inside each later entry's pre-choice prefix.
  for (let later = 1; later < ordered.length; later++) for (let earlier = 0; earlier < later; earlier++) {
    const a = ordered[earlier], b = ordered[later];
    if (b.prefix[a.turn - 1] !== a.champion_id || !a.prefix.every((id, index) => b.prefix[index] === id)) return fail("INCONSISTENT_ORDER");
  }
  return ordered;
}

function readBasis(value: unknown): string {
  if (typeof value !== "string") return fail("INVALID_BASIS");
  const trimmed = value.trim();
  if (trimmed !== value || !trimmed || trimmed.length > BASIS_MAX || !/^[\x20-\x7E]+$/.test(trimmed)) return fail("INVALID_BASIS");
  return trimmed;
}

/** Pure; does not mutate its input. */
export function buildSoloHistoryText(input: SoloHistoryTextInput): SoloHistoryTextResult {
  try {
    if (!isObject(input)) return { ok: false, reason: "INVALID_HISTORY" };
    const entries = readHistory(input.history);
    const patch = readBasis(input.patchId);
    const cutoff = readBasis(input.cutoff);
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(patch)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(cutoff)
      || !Number.isFinite(Date.parse(cutoff))) return fail("INVALID_BASIS");
    const nameOf = input.nameOf;
    if (typeof nameOf !== "function") return { ok: false, reason: "INVALID_NAME" };
    const cache = new Map<string, string>();
    const name = (id: string): string => {
      const known = cache.get(id);
      if (known !== undefined) return known;
      let raw: unknown;
      try { raw = (nameOf as (id: string) => unknown)(id); } catch { return fail("INVALID_NAME"); }
      const clean = cleanSoloHistoryName(raw, NAME_MAX);
      if (!clean) return fail("INVALID_NAME");
      cache.set(id, clean);
      return clean;
    };

    const lines = [
      `자동 선택 복기 · 이번 세트 상대 자동 확정 ${entries.length}개`,
      `기준: 패치 ${patch} · 자료 기준 시각 ${cutoff}`,
      "일반 연습 도구의 규칙 복기이며 실제 팀의 선택이나 승률 예측이 아닙니다.",
    ];
    for (const entry of entries) {
      lines.push("");
      const e = entry.explanation;
      if (!e) {
        lines.push(`${entry.turn}번째 차례 · ${name(entry.champion_id)}`, "- 상세 설명 기록 없음");
        continue;
      }
      lines.push(`${entry.turn}번째 차례 · ${e.side === "BLUE" ? "블루" : "레드"} ${e.kind === "BAN" ? "밴" : "픽"} · ${name(entry.champion_id)}`);
      lines.push(`- 근거: ${evidenceText(e.selected.evidence, e.team)}`);
      if (e.kind === "PICK") {
        lines.push(e.selected.roles.length
          ? `- 포지션: 기록에서 추론한 후보 ${e.selected.roles.join("/")} (추론이며 사용자가 배정한 포지션 아님)`
          : "- 포지션: 추론 근거 없음");
        if (e.selected.role_supported === false) lines.push("- 포지션 근거 부족: 조합 구성을 보장하지 않음");
      }
      const shown = e.alternatives.slice(0, ALTERNATIVES_SHOWN);
      lines.push(shown.length
        ? `- 다른 후보: ${shown.map(c => `${name(c.champion_id)}(${evidenceText(c.evidence, e.team)})`).join(", ")}`
        : "- 다른 후보: 같은 규칙으로 고를 다른 합법 후보 없음");
    }
    const text = lines.join("\n");
    if (text.length > SOLO_HISTORY_TEXT_MAX_LENGTH) return { ok: false, reason: "TOO_LONG" };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, reason: error instanceof Refusal ? error.reason : "INVALID_HISTORY" };
  }
}
