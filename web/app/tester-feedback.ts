/**
 * Tester feedback for the Korean preview round (docs/KOREAN_PREVIEW_TEST_PLAN.md "받을 피드백").
 *
 * Pure module: answer types, a strict local-draft codec and the plain Korean text a tester copies or
 * saves and sends to the person who asked them to test. Nothing here sends anything over the network;
 * no analytics, account, contact detail, player data or board contents are collected. The optional
 * context lines are coarse app state (step, mode, set count, patch/cutoff, width bucket) and are only
 * included when the tester leaves the checkbox on and can read them verbatim before sharing.
 */

export const TESTER_FEEDBACK_STORAGE_KEY = "pmi.testerFeedback.v1";
export const TESTER_FEEDBACK_TEXT_MAX = 500;
export const TESTER_FEEDBACK_MAX_LINES = 8;
export const TESTER_FEEDBACK_DRAFT_MAX_BYTES = 16 * 1024;

export const DEVICE_OPTIONS = [["PC", "PC"], ["PHONE", "휴대폰"], ["TABLET", "태블릿"]] as const;
export const BROWSER_OPTIONS = [
  ["CHROME", "Chrome"], ["SAFARI", "Safari"], ["SAMSUNG", "삼성 인터넷"], ["EDGE", "Edge"], ["FIREFOX", "Firefox"],
  ["IN_APP", "카카오톡·네이버 등 앱 안 브라우저"], ["OTHER", "기타"], ["UNKNOWN", "모름"],
] as const;
export const FIRST_MINUTE_OPTIONS = [["CLEAR", "바로 알았다"], ["SOMEWHAT", "조금 헤맸다"], ["LOST", "몰랐다"]] as const;
export const STUCK_OPTIONS = [
  ["TEAM_SETUP", "팀 고르기·시작"], ["DRAFT", "밴픽 진행(선택·확정·되돌리기)"], ["SOLO", "혼자 연습(자동 상대)"],
  ["FEARLESS", "피어리스 다음 세트"], ["POSITIONS", "포지션 배치"], ["SAVE", "저장·불러오기"], ["SHARE", "링크·이미지·글 공유"],
  ["PLAYERS", "선수·시즌 기록"], ["SIMULATION", "가정 시뮬레이션·A/B 비교"], ["NONE", "막힌 곳 없음"],
] as const;
export const SAVE_SHARE_OPTIONS = [["AS_EXPECTED", "예상대로였다"], ["DIFFERENT", "예상과 달랐다"], ["NOT_TRIED", "안 써봤다"]] as const;
export const MISREAD_OPTIONS = [["NO", "아니다"], ["A_LITTLE", "조금 그렇게 느꼈다"], ["YES", "그렇게 받아들였다"]] as const;
export const RETURN_OPTIONS = [["SURE", "또 써볼 것 같다"], ["MAYBE", "상황 따라"], ["UNLIKELY", "별로"]] as const;

type Code<T extends ReadonlyArray<readonly [string, string]>> = T[number][0];
export type DeviceCode = Code<typeof DEVICE_OPTIONS>;
export type BrowserCode = Code<typeof BROWSER_OPTIONS>;
export type FirstMinuteCode = Code<typeof FIRST_MINUTE_OPTIONS>;
export type StuckCode = Code<typeof STUCK_OPTIONS>;
export type SaveShareCode = Code<typeof SAVE_SHARE_OPTIONS>;
export type MisreadCode = Code<typeof MISREAD_OPTIONS>;
export type ReturnCode = Code<typeof RETURN_OPTIONS>;

export type TesterFeedbackAnswers = {
  device: DeviceCode | null;
  browser: BrowserCode | null;
  firstMinute: FirstMinuteCode | null;
  stuck: StuckCode[];
  expected: string;
  saveShare: SaveShareCode | null;
  misread: MisreadCode | null;
  reuse: string;
  improve: string;
  returnIntent: ReturnCode | null;
};

export const EMPTY_TESTER_FEEDBACK: Readonly<TesterFeedbackAnswers> = Object.freeze({
  device: null, browser: null, firstMinute: null, stuck: Object.freeze([]) as unknown as StuckCode[], expected: "",
  saveShare: null, misread: null, reuse: "", improve: "", returnIntent: null,
});

export type TesterFeedbackContext = {
  step: "SETUP" | "DRAFT";
  tab: "DRAFT" | "ROSTER" | "DETAILS" | "COMPARISON" | "SIMULATION";
  mode: "MANUAL" | "SOLO_BLUE" | "SOLO_RED" | "ROOM";
  completedSets: number;
  currentTurn: number;
  patchId: string;
  cutoff: string;
  /** CSS width in px; only a coarse bucket is ever written to the text. */
  viewportWidth: number | null;
};

function labelOf<T extends ReadonlyArray<readonly [string, string]>>(options: T, code: string | null): string | null {
  if (code === null) return null;
  return options.find(([value]) => value === code)?.[1] ?? null;
}
function isCode<T extends ReadonlyArray<readonly [string, string]>>(options: T, value: unknown): value is Code<T> {
  return typeof value === "string" && options.some(([code]) => code === value);
}

/** Control/format chars (incl. bidi and zero-width) removed per line; spaces collapsed; line and length capped. */
const UNSAFE_INLINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export function cleanFeedbackText(value: unknown): string {
  if (typeof value !== "string") return "";
  const lines = value.replace(/\r\n?/g, "\n").split("\n")
    .map(line => line.replace(UNSAFE_INLINE, " ").replace(/\s+/g, " ").trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (!line && (!kept.length || !kept.at(-1))) continue; // no leading or repeated blank lines
    kept.push(line);
  }
  while (kept.length && !kept.at(-1)) kept.pop();
  const capped = kept.slice(0, TESTER_FEEDBACK_MAX_LINES).join("\n");
  const chars = Array.from(capped);
  return chars.length > TESTER_FEEDBACK_TEXT_MAX ? chars.slice(0, TESTER_FEEDBACK_TEXT_MAX).join("").trimEnd() : capped;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** Phone-like runs: 9+ digits allowing spaces, dots, dashes and a leading +, e.g. 010-1234-5678, +82 10 1234 5678. */
const PHONE = /\+?\d(?:[\s.-]?\d){8,}/g;
export const CONTACT_MASK = "[연락처 지움]";

/** Masks e-mail- and phone-like strings so a tester's contact details are not passed along by accident. */
export function maskContacts(value: string): { text: string; masked: number } {
  let masked = 0;
  const text = value.replace(EMAIL, () => { masked += 1; return CONTACT_MASK; })
    .replace(PHONE, () => { masked += 1; return CONTACT_MASK; });
  return { text, masked };
}

/** Normalises any input into valid answers: unknown codes become null, text is cleaned, stuck is ordered and de-duplicated. */
export function normalizeTesterFeedback(value: unknown): TesterFeedbackAnswers {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const stuckIn = Array.isArray(raw.stuck) ? raw.stuck : [];
  const stuck = STUCK_OPTIONS.map(([code]) => code).filter(code => stuckIn.includes(code));
  return {
    device: isCode(DEVICE_OPTIONS, raw.device) ? raw.device : null,
    browser: isCode(BROWSER_OPTIONS, raw.browser) ? raw.browser : null,
    firstMinute: isCode(FIRST_MINUTE_OPTIONS, raw.firstMinute) ? raw.firstMinute : null,
    // "막힌 곳 없음" cannot coexist with a real stuck point; the concrete points win.
    stuck: stuck.length > 1 ? stuck.filter(code => code !== "NONE") : stuck,
    expected: cleanFeedbackText(raw.expected),
    saveShare: isCode(SAVE_SHARE_OPTIONS, raw.saveShare) ? raw.saveShare : null,
    misread: isCode(MISREAD_OPTIONS, raw.misread) ? raw.misread : null,
    reuse: cleanFeedbackText(raw.reuse),
    improve: cleanFeedbackText(raw.improve),
    returnIntent: isCode(RETURN_OPTIONS, raw.returnIntent) ? raw.returnIntent : null,
  };
}

export function hasTesterFeedback(answers: TesterFeedbackAnswers): boolean {
  return Boolean(answers.device || answers.browser || answers.firstMinute || answers.stuck.length || answers.expected
    || answers.saveShare || answers.misread || answers.reuse || answers.improve || answers.returnIntent);
}

/** Local draft (answers only, never context) so a tester does not lose what they typed on reload. */
export function serializeTesterFeedbackDraft(answers: TesterFeedbackAnswers): string | null {
  const normalized = normalizeTesterFeedback(answers);
  if (!hasTesterFeedback(normalized)) return null;
  return JSON.stringify({ v: 1, answers: normalized });
}

/** Any malformed, oversized or foreign value is ignored (empty form) instead of partially trusted. */
export function parseTesterFeedbackDraft(stored: unknown): TesterFeedbackAnswers | null {
  if (typeof stored !== "string" || !stored || stored.length > TESTER_FEEDBACK_DRAFT_MAX_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || !record.answers || typeof record.answers !== "object" || Array.isArray(record.answers)) return null;
  const answers = normalizeTesterFeedback(record.answers);
  return hasTesterFeedback(answers) ? answers : null;
}

export function viewportBucket(width: number | null): string {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return "확인 안 됨";
  if (width >= 1100) return "넓은 화면(PC)";
  if (width >= 700) return "중간 화면(태블릿 폭)";
  return "좁은 화면(휴대폰 폭)";
}

const TAB_TEXT: Record<TesterFeedbackContext["tab"], string> = {
  DRAFT: "밴픽", ROSTER: "선수·로스터", DETAILS: "상세", COMPARISON: "A/B 비교", SIMULATION: "시뮬레이션",
};
const MODE_TEXT: Record<TesterFeedbackContext["mode"], string> = {
  MANUAL: "양쪽 직접 조작", SOLO_BLUE: "혼자 연습(블루)", SOLO_RED: "혼자 연습(레드)", ROOM: "친구 방",
};
const BASIS_MAX = 40;
const cleanBasis = (value: unknown) => typeof value === "string"
  ? Array.from(value.replace(UNSAFE_INLINE, "").trim()).slice(0, BASIS_MAX).join("") : "";
const count = (value: unknown, max: number) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : 0;

/** ISO timestamps are shortened to minute precision in UTC; anything else is shown cleaned as-is. */
export function cutoffText(value: unknown): string {
  if (typeof value !== "string") return "";
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim()) ? new Date(value.trim()) : null;
  if (iso && Number.isFinite(iso.getTime())) return `${iso.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return cleanBasis(value);
}

export function contextLines(context: TesterFeedbackContext): string[] {
  const patch = cleanBasis(context.patchId) || "확인 안 됨";
  const cutoff = cutoffText(context.cutoff) || "확인 안 됨";
  const tab = TAB_TEXT[context.tab] ?? "확인 안 됨";
  const mode = MODE_TEXT[context.mode] ?? "확인 안 됨";
  return [
    `화면: ${context.step === "SETUP" ? "팀 선택" : "밴픽 작업"} · 탭: ${tab} · 방식: ${mode}`,
    `진행: 완료한 세트 ${count(context.completedSets, 99)}개 · 현재 세트 ${count(context.currentTurn, 20)}/20 차례`,
    `자료: 패치 ${patch} · 기준 시각 ${cutoff}`,
    `화면 폭: ${viewportBucket(context.viewportWidth)}`,
  ];
}

export type TesterFeedbackTextResult = { ok: true; text: string; masked: number } | { ok: false; reason: "EMPTY" };

const dateText = (now: Date) => Number.isFinite(now.getTime())
  ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` : "확인 안 됨";
/** Multi-line answers are indented under their question so the text stays readable in a chat app. */
const block = (text: string) => text.includes("\n") ? `\n  ${text.split("\n").join("\n  ")}` : ` ${text}`;

/** Plain Korean text for an explicit copy/save by the tester. Unanswered questions are left out. */
export function buildTesterFeedbackText(input: { answers: unknown; context: TesterFeedbackContext | null; now: Date }): TesterFeedbackTextResult {
  const answers = normalizeTesterFeedback(input.answers);
  if (!hasTesterFeedback(answers)) return { ok: false, reason: "EMPTY" };
  let masked = 0;
  const free = (value: string) => { const result = maskContacts(value); masked += result.masked; return result.text; };
  const lines = ["[Pro Meta Intelligence 테스트 의견]", `작성일: ${dateText(input.now)}`];
  const push = (label: string, value: string | null) => { if (value) lines.push(`${label}:${block(value)}`); };
  push("기기", labelOf(DEVICE_OPTIONS, answers.device));
  push("브라우저", labelOf(BROWSER_OPTIONS, answers.browser));
  push("처음 1분 안에 할 일을 알았나", labelOf(FIRST_MINUTE_OPTIONS, answers.firstMinute));
  push("멈추거나 헷갈린 곳", answers.stuck.map(code => labelOf(STUCK_OPTIONS, code)).filter(Boolean).join(", ") || null);
  push("그때 기대한 것", answers.expected ? free(answers.expected) : null);
  push("저장·공유 범위", labelOf(SAVE_SHARE_OPTIONS, answers.saveShare));
  push("기록·가상 결과를 실제 승률·능력으로 받아들였나", labelOf(MISREAD_OPTIONS, answers.misread));
  push("다시 쓴다면 언제", answers.reuse ? free(answers.reuse) : null);
  push("하나만 고친다면", answers.improve ? free(answers.improve) : null);
  push("다시 써볼 의향", labelOf(RETURN_OPTIONS, answers.returnIntent));
  if (input.context) lines.push("", "[자동 첨부 · 개인 정보·밴픽 내용 없음]", ...contextLines(input.context));
  return { ok: true, text: lines.join("\n"), masked };
}
