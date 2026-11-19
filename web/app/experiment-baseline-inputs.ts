import { trustedRun } from "./experiment-comparison";
import { plainDecimal } from "./experiment-input-link";
import { ASSUMPTION_FIELDS, CORE_TEAM_IDS, sourceTeamOrder, validateRunInputs, type AssumptionDraft } from "./experiment-replay";
import { sameSimulationInput, type SimulationInputSnapshot } from "./simulation-scenario";

/**
 * Plan for loading baseline A's seed and the two teams' three assumptions back into the input fields
 * (pure). Only numbers move: no draft, player, role, evidence or run is restored, and nothing is run.
 *
 * Allowed only for a trusted in-page run (`trustedRun`), when not blocked, when an input is ready and
 * when the current ready input is exactly A's fixed input (`sameSimulationInput`: evidence identity +
 * canonical key, so evidence/sides/first pick/games/picks/roster/roles must all match). This is stricter
 * than the assumption link's patch/pair gate on purpose: a different draft is never silently used as A.
 * The current seed/assumption fields are not read; a different current seed is simply replaced.
 *
 * Numbers are turned into text with the link's lossless `plainDecimal` (no rounding, clamp or exponent
 * text; -0 → "0") and must read back identically through the existing `validateRunInputs`.
 * The returned texts are fresh copies keyed by source team ID.
 */

export type BaselineInputsRefusal = "UNTRUSTED" | "BLOCKED" | "NO_READY_INPUT" | "CONTEXT_MISMATCH" | "BAD_VALUE";
export type BaselineInputsPlan =
  | { ok: true; seedText: string; drafts: Record<string, AssumptionDraft> }
  | { ok: false; reason: BaselineInputsRefusal; message: string };

const MESSAGES: Record<BaselineInputsRefusal, string> = {
  UNTRUSTED: "기준 A 기록을 확인할 수 없어 불러오지 않습니다.",
  BLOCKED: "방 연결·파일 복원·자료 로딩 중에는 불러올 수 없습니다.",
  NO_READY_INPUT: "시뮬레이션 입력 준비가 완료되어야 불러올 수 있습니다.",
  CONTEXT_MISMATCH: "현재 밴픽·로스터·역할·자료가 기준 A의 고정 입력과 달라 불러오지 않습니다.",
  BAD_VALUE: "기준 A의 값을 손실 없이 입력란에 옮길 수 없어 불러오지 않습니다.",
};
const refuse = (reason: BaselineInputsRefusal): BaselineInputsPlan => ({ ok: false, reason, message: MESSAGES[reason] });

export function planBaselineInputs(baseline: unknown, readyInput: SimulationInputSnapshot | null, blocked: boolean): BaselineInputsPlan {
  const a = trustedRun(baseline);
  if (!a) return refuse("UNTRUSTED");
  if (blocked !== false) return refuse("BLOCKED");
  if (!readyInput) return refuse("NO_READY_INPUT");
  let same = false;
  try { same = sameSimulationInput(a.snapshot, readyInput); } catch { same = false; }
  const order = same ? sourceTeamOrder(readyInput) : null;
  if (!same || !order || CORE_TEAM_IDS.some((core, i) => a.teams[core].sourceId !== order[i])) return refuse("CONTEXT_MISMATCH");

  const seedText = String(a.seed);
  const drafts: Record<string, AssumptionDraft> = {};
  for (const core of CORE_TEAM_IDS) {
    const team = a.teams[core];
    const draft = {} as AssumptionDraft;
    for (const field of ASSUMPTION_FIELDS) {
      const text = plainDecimal(team.assumptions[field]);
      if (text === null) return refuse("BAD_VALUE");
      draft[field] = text;
    }
    drafts[team.sourceId] = draft;
  }
  // Read back with the run's own validator: must give exactly A's seed and numbers.
  const check = validateRunInputs(readyInput, seedText, drafts);
  if (!check.ok || check.seed !== a.seed) return refuse("BAD_VALUE");
  for (const core of CORE_TEAM_IDS) {
    const team = a.teams[core];
    if (ASSUMPTION_FIELDS.some((field) => !Object.is(check.assumptions[team.sourceId]?.[field], team.assumptions[field] === 0 ? 0 : team.assumptions[field]))) return refuse("BAD_VALUE");
  }
  return { ok: true, seedText, drafts };
}
