import { SIMULATION_RULESET, type ManagerState } from "./simulation-core";
import { ASSUMPTION_FIELDS, CORE_TEAM_IDS, MAX_MINUTE, type AssumptionField, type ExperimentRun } from "./experiment-replay";
import { compareExperimentRuns, OUTCOME_STATS, trustedRun, type ComparisonRefusalCode, type EndOf, type OutcomeStat } from "./experiment-comparison";
import { cleanField } from "./experiment-result-text";

/**
 * Plain Korean text of one completed single-seed A/B assumption comparison (pure).
 *
 * Takes the kept baseline A and run B as `unknown`, accepts them only through `trustedRun`, and reads
 * the numbers only from the existing `compareExperimentRuns` result for B at its shown end. It never
 * runs the model, a batch or a new comparison rule. Teams are matched by source team ID; the text shows
 * display names only (same names become "팀1"/"팀2"), never team/player IDs, evidence keys or snapshots.
 * Any missing, malformed or inconsistent value refuses the whole text; nothing is replaced by 0.
 */

export type ComparisonTextRefusal = "UNTRUSTED" | "SAME_RUN" | "NOT_COMPLETE" | "NOT_COMPARABLE" | "INVALID_RESULT" | "INVALID_TEXT" | "TOO_LONG";
export type ComparisonTextOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: ComparisonTextRefusal; codes?: ComparisonRefusalCode[] };

export const COMPARISON_TEXT_BOUNDARY =
  "같은 고정 시드·규칙·패치·자료 기준 시점에서 사용자 가정만 바꾼 두 실행의 모델 내부 차이이며 실제 LoL 승패·승률 예측이 아닙니다. 실제 선수·챔피언·룬·아이템 효과는 반영하지 않았습니다.";
export const MAX_COMPARISON_TEXT_CHARS = 2400;

const fieldLabels: Record<AssumptionField, string> = { lane: "라인", tempo: "운영", teamfight: "한타" };
const statLabels: Record<OutcomeStat, string> = { gold: "모델 자원", kills: "모델 킬", objectives: "추상 오브젝트", base: "기지 내구도" };
const reasonLabels = { BASE_DESTROYED: "모델 기지 내구도 0", TIME_LIMIT: `${MAX_MINUTE}분 제한 도달` } as const;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

class Refuse extends Error {
  constructor(readonly reason: ComparisonTextRefusal, readonly codes?: ComparisonRefusalCode[]) { super(reason); }
}
const refuse = (reason: ComparisonTextRefusal, codes?: ComparisonRefusalCode[]): never => { throw new Refuse(reason, codes); };

/** Shared one-line sanitizer; any refusal of it refuses this text as INVALID_TEXT. */
function safeText(value: unknown): string {
  try { return cleanField(value); } catch { return refuse("INVALID_TEXT"); }
}

const groupDigits = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const signed = (value: number) => value > 0 ? `+${groupDigits(value)}` : groupDigits(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isAssumption = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;

function checkState(value: unknown): ManagerState {
  if (value === null || typeof value !== "object") return refuse("INVALID_RESULT");
  const s = value as Record<string, unknown>;
  if (!OUTCOME_STATS.every((stat) => isCount(s[stat])) || (s.base as number) > 100) return refuse("INVALID_RESULT");
  return { gold: s.gold as number, kills: s.kills as number, objectives: s.objectives as number, base: s.base as number };
}

function checkEnd(value: EndOf | undefined): EndOf {
  if (!value || !Number.isSafeInteger(value.minute) || value.minute < 1 || value.minute > MAX_MINUTE) return refuse("INVALID_RESULT");
  if (value.reason !== "BASE_DESTROYED" && value.reason !== "TIME_LIMIT") return refuse("INVALID_RESULT");
  return value;
}

function build(baseline: unknown, candidate: unknown, shownMinute: unknown): string {
  const a = trustedRun(baseline), b = trustedRun(candidate);
  if (!a || !b) return refuse("UNTRUSTED");
  if (a === b || a.runId === b.runId) return refuse("SAME_RUN");
  // B's outcome is shown only at its end; before that nothing may be copied.
  if (typeof shownMinute !== "number" || !Number.isFinite(shownMinute) || shownMinute < b.endMinute) return refuse("NOT_COMPLETE");
  if (a.input.ruleset !== SIMULATION_RULESET || b.input.ruleset !== SIMULATION_RULESET) return refuse("NOT_COMPARABLE", ["RULESET"]);

  const comparison = compareExperimentRuns(a, b, shownMinute);
  if (!comparison.ok) return refuse("NOT_COMPARABLE", comparison.refusals.map((r) => r.code));
  const { outcome, teams, changes, changeKind, seed } = comparison;
  if (!outcome) return refuse("NOT_COMPLETE");
  if (seed !== a.seed || seed !== b.seed) return refuse("INVALID_RESULT");

  // Exactly the two source teams, in the same order in every part of the comparison.
  if (teams.length !== CORE_TEAM_IDS.length || outcome.teams.length !== teams.length) return refuse("INVALID_RESULT");
  if (teams.some((team, i) => outcome.teams[i].sourceId !== team.sourceId) || teams[0].sourceId === teams[1].sourceId) return refuse("INVALID_RESULT");
  const runTeam = (run: ExperimentRun, sourceId: string) => {
    const core = CORE_TEAM_IDS.find((id) => run.teams[id].sourceId === sourceId);
    return core ? run.teams[core] : refuse("INVALID_RESULT");
  };

  // Display labels: B's name (the comparison's), "팀1/팀2" when both share it; A's older name is noted.
  const named = teams.map((team, i) => {
    const bName = safeText(runTeam(b, team.sourceId).name);
    const aName = safeText(runTeam(a, team.sourceId).name);
    if (safeText(team.name) !== bName) return refuse("INVALID_RESULT");
    return { sourceId: team.sourceId, index: i + 1, bName, aName };
  });
  const sameName = named[0].bName === named[1].bName;
  const labelOf = new Map(named.map((team) => [team.sourceId, sameName ? `${team.bName} (팀${team.index})` : team.bName]));
  const label = (sourceId: string) => labelOf.get(sourceId) ?? refuse("INVALID_RESULT");

  // Assumption rows must agree with the change list and its kind.
  let changedCount = 0;
  const assumptionLines = teams.map((team) => `- ${label(team.sourceId)}: ${ASSUMPTION_FIELDS.map((field) => {
    const cell = team.fields[field];
    if (!cell || !isAssumption(cell.a) || !isAssumption(cell.b) || cell.changed !== (cell.a !== cell.b)) return refuse("INVALID_RESULT");
    if (cell.changed) {
      changedCount += 1;
      if (!changes.some((c) => c.sourceId === team.sourceId && c.field === field && c.a === cell.a && c.b === cell.b)) return refuse("INVALID_RESULT");
      return `${fieldLabels[field]} ${String(cell.a)} → ${String(cell.b)}`;
    }
    return `${fieldLabels[field]} ${String(cell.a)} (같음)`;
  }).join(" · ")}`);
  const expectedKind = changedCount === 0 ? "NONE" : changedCount === 1 ? "SINGLE" : "MULTIPLE";
  if (changes.length !== changedCount || changeKind !== expectedKind) return refuse("INVALID_RESULT");

  const endA = checkEnd(outcome.end.a), endB = checkEnd(outcome.end.b);
  if (endA.minute !== a.endMinute || endB.minute !== b.endMinute || outcome.end.minuteDelta !== endB.minute - endA.minute) return refuse("INVALID_RESULT");

  const outcomeLines = outcome.teams.map((team) => {
    const sa = checkState(team.a), sb = checkState(team.b);
    const parts = OUTCOME_STATS.map((stat) => {
      const delta = team.delta?.[stat];
      if (typeof delta !== "number" || !Number.isSafeInteger(delta) || delta !== sb[stat] - sa[stat]) return refuse("INVALID_RESULT");
      // Same assumptions and seed: the model is deterministic, so a non-zero difference is a contradiction.
      if (changeKind === "NONE" && delta !== 0) return refuse("INVALID_RESULT");
      const unit = stat === "base" ? "/100" : "";
      return `${statLabels[stat]} ${groupDigits(sa[stat])}${unit} → ${groupDigits(sb[stat])}${unit} (${signed(delta)})`;
    });
    return `- ${label(team.sourceId)}: ${parts.join(" · ")}`;
  });
  if (changeKind === "NONE" && outcome.end.minuteDelta !== 0) return refuse("INVALID_RESULT");

  const change = changes[0];
  const kindLine = changeKind === "NONE" ? "가정 변경 없음 · 같은 가정·고정 시드이므로 모델 결과 차이는 0입니다."
    : changeKind === "SINGLE" ? `가정 1개 변경 (${label(change.sourceId)} ${fieldLabels[change.field]} ${String(change.a)} → ${String(change.b)}) · 같은 고정 시드에서 이 가정만 바꾼 모델 내부 차이입니다.`
    : `가정 ${changes.length}개 변경 · 여러 가정을 함께 바꿨으므로 차이를 한 가정의 기여로 나눌 수 없습니다.`;

  const patch = safeText(a.snapshot.patch);
  const cutoffRaw = a.snapshot.cutoff;
  if (typeof cutoffRaw !== "string" || !ISO_WITH_ZONE.test(cutoffRaw) || !Number.isFinite(Date.parse(cutoffRaw))) return refuse("INVALID_TEXT");
  if (b.snapshot.patch !== a.snapshot.patch || b.snapshot.cutoff !== cutoffRaw) return refuse("INVALID_RESULT");
  const cutoff = safeText(cutoffRaw);
  if (!Number.isSafeInteger(seed)) return refuse("INVALID_RESULT");

  const renamed = named.filter((team) => team.aName !== team.bName)
    .map((team) => `- ${label(team.sourceId)}: 기준 A 실행 당시 이름 ${team.aName} (같은 팀으로 대응)`);

  const lines = [
    `[가정 A/B 비교 요약] 기준 A 실행 #${a.runId} ↔ 실행 B #${b.runId}`,
    "보관된 두 실행의 비교입니다. 실행 당시 고정 기록이며 현재 화면의 입력란과 다를 수 있습니다.",
    `패치 ${patch} · 자료 기준 시각 ${cutoff} · 고정 시드 ${seed} · 규칙 ${SIMULATION_RULESET} (A·B 동일)`,
    ...(renamed.length ? ["", "팀 이름 대응", ...renamed] : []),
    "",
    "팀 가정 A → B (-1~1, 0 중립)",
    ...assumptionLines,
    kindLine,
    "",
    `모델 종료: A ${endA.minute}분 · ${reasonLabels[endA.reason]} → B ${endB.minute}분 · ${reasonLabels[endB.reason]} (B − A ${signed(outcome.end.minuteDelta)}분)`,
    "팀별 모델 결과 A → B (B − A)",
    ...outcomeLines,
    "모델 자원은 실제 골드가 아닙니다.",
    "",
    COMPARISON_TEXT_BOUNDARY,
  ];
  const text = lines.join("\n");
  if (text.length > MAX_COMPARISON_TEXT_CHARS) return refuse("TOO_LONG");
  return text;
}

/** Text of kept A vs run B at B's shown minute. Refuses as a whole unless both are trusted, different, comparable and B is at its end. */
export function buildExperimentComparisonText(baseline: unknown, candidate: unknown, shownMinute: number): ComparisonTextOutcome {
  try {
    return { ok: true, text: build(baseline, candidate, shownMinute) };
  } catch (error) {
    if (error instanceof Refuse) return error.codes ? { ok: false, reason: error.reason, codes: error.codes } : { ok: false, reason: error.reason };
    return { ok: false, reason: "INVALID_RESULT" };
  }
}
