import { isManagerInput, SIMULATION_RULESET, type ManagerAssumptions, type ManagerState } from "./simulation-core";
import { ASSUMPTION_FIELDS, CORE_TEAM_IDS, MAX_MINUTE, type CoreTeamId, type ExperimentRun } from "./experiment-replay";

/**
 * Plain Korean text of one completed, frozen assumption experiment (pure).
 *
 * Reads only what the run already computed: `run.result` winner/reason/minute/states plus
 * `run.teams`, `run.input` and `run.snapshot`. It never runs the model, rebuilds a replay frame or
 * builds a comparison. Champions, players and records are not part of this text. Any field that is
 * malformed or inconsistent refuses the whole text; there is no partial copy.
 */

export type ResultTextRefusal = "NOT_COMPLETE" | "INVALID_RUN" | "INVALID_RESULT" | "INVALID_TEXT" | "TOO_LONG";
export type ResultTextOutcome = { ok: true; text: string } | { ok: false; reason: ResultTextRefusal };

export const RESULT_TEXT_BOUNDARY =
  "사용자 가정과 작성 규칙에 따른 모델 내부 결과이며 실제 LoL 승패·승률 예측이 아닙니다. 실제 선수·챔피언·룬·아이템 효과는 반영하지 않았습니다.";
export const MAX_FIELD_CHARS = 40;
export const MAX_RESULT_TEXT_CHARS = 2000;

const fieldLabels: Record<(typeof ASSUMPTION_FIELDS)[number], string> = { lane: "라인", tempo: "운영", teamfight: "한타" };
const reasonLabels = { BASE_DESTROYED: "모델 기지 내구도 0", TIME_LIMIT: `${MAX_MINUTE}분 제한 도달 (기지·자원 점수)` } as const;
const sideLabels = { BLUE: "블루", RED: "레드" } as const;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
// C0/C1 controls (incl. newlines) and bidi embedding/override/isolate/mark characters.
const UNSAFE_CHARS = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;

class Refuse extends Error { constructor(readonly reason: ResultTextRefusal) { super(reason); } }
const refuse = (reason: ResultTextRefusal): never => { throw new Refuse(reason); };
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** One line of display text: unsafe characters removed, whitespace collapsed, capped. Empty → refuse. */
export function cleanField(value: unknown): string {
  if (typeof value !== "string") return refuse("INVALID_TEXT");
  const cleaned = value.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return refuse("INVALID_TEXT");
  const chars = Array.from(cleaned);
  return chars.length > MAX_FIELD_CHARS ? `${chars.slice(0, MAX_FIELD_CHARS - 1).join("")}…` : cleaned;
}

const groupDigits = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function checkState(value: unknown): ManagerState {
  if (!isObject(value)) return refuse("INVALID_RESULT");
  const { gold, kills, objectives, base } = value;
  if (!nonNegativeInteger(gold) || !nonNegativeInteger(kills) || !nonNegativeInteger(objectives) ||
    !nonNegativeInteger(base) || base > 100) return refuse("INVALID_RESULT");
  return { gold, kills, objectives, base };
}

const sameAssumptions = (a: unknown, b: ManagerAssumptions) =>
  isObject(a) && ASSUMPTION_FIELDS.every((field) => a[field] === b[field]);

function build(run: ExperimentRun, shownMinute: number): string {
  if (!isObject(run)) return refuse("INVALID_RUN");
  const { runId, seed, endMinute, input, result, teams, snapshot } = run as unknown as Record<string, unknown>;
  if (typeof runId !== "number" || !Number.isSafeInteger(runId) || runId < 1) return refuse("INVALID_RUN");
  if (typeof endMinute !== "number" || !Number.isSafeInteger(endMinute) || endMinute < 1 || endMinute > MAX_MINUTE) return refuse("INVALID_RUN");
  // Only the end of the run may be copied: before it the outcome is still hidden on screen.
  if (typeof shownMinute !== "number" || !Number.isFinite(shownMinute) || shownMinute < endMinute) return refuse("NOT_COMPLETE");

  if (!isManagerInput(input) || input.seed !== seed) return refuse("INVALID_RUN");
  if (!CORE_TEAM_IDS.every((core, i) => input.teams[i].id === core)) return refuse("INVALID_RUN");
  if (!isObject(snapshot) || !isObject(snapshot.draft) || !isObject(snapshot.draft.teams) || !isObject(teams)) return refuse("INVALID_RUN");
  const draftTeams = snapshot.draft.teams;

  const fixed = CORE_TEAM_IDS.map((core, i) => {
    const team = teams[core];
    if (!isObject(team) || team.core !== core || typeof team.sourceId !== "string" || !team.sourceId) return refuse("INVALID_RUN");
    const side: "BLUE" | "RED" = team.sideAtRun === "BLUE" ? "BLUE" : team.sideAtRun === "RED" ? "RED" : refuse("INVALID_RUN");
    const sideTeam = draftTeams[side];
    if (!isObject(sideTeam) || sideTeam.id !== team.sourceId || sideTeam.name !== team.name) return refuse("INVALID_RUN");
    // The assumptions printed must be exactly the ones the model was given.
    if (!sameAssumptions(team.assumptions, input.teams[i].assumptions)) return refuse("INVALID_RUN");
    return { core, side, sourceId: team.sourceId, name: cleanField(team.name), assumptions: input.teams[i].assumptions };
  });
  if (fixed[0].sourceId >= fixed[1].sourceId || fixed[0].side === fixed[1].side) return refuse("INVALID_RUN");

  if (!isObject(result) || result.ruleset !== SIMULATION_RULESET || input.ruleset !== SIMULATION_RULESET) return refuse("INVALID_RESULT");
  // The result's own recorded input is required and must match the run input exactly.
  const resultInput = result.input;
  if (!isManagerInput(resultInput) || resultInput.ruleset !== input.ruleset || resultInput.seed !== input.seed ||
    !CORE_TEAM_IDS.every((core, i) => resultInput.teams[i].id === core && sameAssumptions(resultInput.teams[i].assumptions, input.teams[i].assumptions))) return refuse("INVALID_RESULT");
  if (result.minute !== endMinute) return refuse("INVALID_RESULT");
  const winner = result.winner;
  if (winner !== "team_a" && winner !== "team_b") return refuse("INVALID_RESULT");
  const reason = result.reason;
  if (reason !== "BASE_DESTROYED" && reason !== "TIME_LIMIT") return refuse("INVALID_RESULT");
  if (!isObject(result.states)) return refuse("INVALID_RESULT");
  const resultStates = result.states;
  const states = Object.fromEntries(CORE_TEAM_IDS.map((core) => [core, checkState(resultStates[core])])) as Record<CoreTeamId, ManagerState>;
  const loser: CoreTeamId = winner === "team_a" ? "team_b" : "team_a";
  // Outcome must agree with the authored end rule; a contradiction refuses the whole text.
  if (reason === "BASE_DESTROYED" && (states[loser].base !== 0 || states[winner].base === 0)) return refuse("INVALID_RESULT");
  if (reason === "TIME_LIMIT") {
    // Authored time-limit rule: base × 1000 + model resource, tie to team_a.
    const score = (core: CoreTeamId) => states[core].base * 1000 + states[core].gold;
    const expected: CoreTeamId = score("team_a") >= score("team_b") ? "team_a" : "team_b";
    if (endMinute !== MAX_MINUTE || states.team_a.base === 0 || states.team_b.base === 0 || winner !== expected) return refuse("INVALID_RESULT");
  }

  const patch = cleanField(snapshot.patch);
  const cutoffRaw = snapshot.cutoff;
  if (typeof cutoffRaw !== "string" || !ISO_WITH_ZONE.test(cutoffRaw) || !Number.isFinite(Date.parse(cutoffRaw))) return refuse("INVALID_TEXT");
  const cutoff = cleanField(cutoffRaw);
  const nameOfCore = (core: CoreTeamId) => fixed[CORE_TEAM_IDS.indexOf(core)].name;

  const lines = [
    `[가정 실험 요약] 실행 #${runId}`,
    "실행 당시 고정 기록입니다. 현재 화면의 입력란과 다를 수 있습니다.",
    `패치 ${patch} · 자료 기준 시각 ${cutoff} · 고정 시드 ${seed} · 규칙 ${SIMULATION_RULESET}`,
    "",
    "팀 가정 (-1~1, 0 중립)",
    ...fixed.map((team) => `- ${team.name} (실행 당시 ${sideLabels[team.side]}): ${ASSUMPTION_FIELDS.map((field) => `${fieldLabels[field]} ${String(team.assumptions[field])}`).join(" · ")}`),
    "",
    `모델 종료: ${endMinute}분 · ${reasonLabels[reason]}`,
    `모델 내부 승자: ${nameOfCore(winner)}`,
    ...CORE_TEAM_IDS.map((core) => {
      const s = states[core];
      return `- ${nameOfCore(core)}: 모델 자원 ${groupDigits(s.gold)} · 모델 킬 ${s.kills} · 추상 오브젝트 ${s.objectives} · 기지 내구도 ${s.base}/100`;
    }),
    "",
    RESULT_TEXT_BOUNDARY,
  ];
  const text = lines.join("\n");
  if (text.length > MAX_RESULT_TEXT_CHARS) return refuse("TOO_LONG");
  return text;
}

/** Text for a frozen run at the shown minute. Before the run's end, or for any malformed run, refuses. */
export function buildExperimentResultText(run: ExperimentRun, shownMinute: number): ResultTextOutcome {
  try {
    return { ok: true, text: build(run, shownMinute) };
  } catch (error) {
    return { ok: false, reason: error instanceof Refuse ? error.reason : "INVALID_RUN" };
  }
}
