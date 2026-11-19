import { isManagerInput, type ManagerState } from "./simulation-core";
import {
  ASSUMPTION_FIELDS,
  cloneTrustedRun,
  CORE_TEAM_IDS,
  isTrustedRun,
  replayFrame,
  sourceTeamOrder,
  type AssumptionField,
  type CoreTeamId,
  type ExperimentRun,
} from "./experiment-replay";
import { sameSimulationInput, simulationInputKey } from "./simulation-scenario";

/**
 * A/B comparison of two explicit assumption-experiment runs (pure).
 *
 * A is a detached, frozen copy of a run the user finished watching. B is another explicit run.
 * They are compared only when the fixed draft/roster/role/evidence input, the ruleset, the source
 * team ID pair and the seed are all the same; then the only remaining difference is the user's
 * assumptions, and the result is a model-internal difference under those assumptions. Nothing here
 * calls the simulation model (baseline copy, comparison and display read the frozen runs only), ranks
 * teams, estimates win rate, contribution or causal effect.
 */

export type ComparisonRefusalCode = "UNTRUSTED" | "RULESET" | "SEED" | "EVIDENCE" | "TEAMS" | "DRAFT" | "ROSTER" | "ROLES" | "INPUT";
export type ComparisonRefusal = { code: ComparisonRefusalCode; message: string };

export type AssumptionChange = { sourceId: string; field: AssumptionField; a: number; b: number };
export type TeamAssumptionDiff = {
  sourceId: string;
  name: string;
  fields: Record<AssumptionField, { a: number; b: number; changed: boolean }>;
};
export type ChangeKind = "NONE" | "SINGLE" | "MULTIPLE";

export type OutcomeStat = keyof ManagerState;
export const OUTCOME_STATS: readonly OutcomeStat[] = ["gold", "kills", "objectives", "base"];
export type TeamOutcomeDiff = { sourceId: string; name: string; a: ManagerState; b: ManagerState; delta: ManagerState };
export type EndOf = { minute: number; reason: "BASE_DESTROYED" | "TIME_LIMIT" };
export type OutcomeComparison = { teams: TeamOutcomeDiff[]; end: { a: EndOf; b: EndOf; minuteDelta: number } };

export type ExperimentComparison =
  | { ok: false; refusals: ComparisonRefusal[] }
  | {
    ok: true;
    seed: number;
    teams: TeamAssumptionDiff[];
    changes: AssumptionChange[];
    changeKind: ChangeKind;
    /** null until B has been played to its end: no final state, end minute or end kind before that. */
    outcome: OutcomeComparison | null;
  };

export type FreezeResult = { ok: true; baseline: ExperimentRun } | { ok: false; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function sameValue(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, i) => sameValue(item, actual[i]));
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    const keys = Object.keys(expected);
    return keys.length === Object.keys(actual).length && keys.every((key) => Object.hasOwn(actual, key) && sameValue(expected[key], actual[key]));
  }
  return Object.is(expected, actual) || (expected === 0 && actual === 0);
}

/**
 * Trust boundary: only runs made by `buildExperimentRun` in this page's memory (or their trusted
 * clones) are accepted. Membership is provenance, checked without calling the model; members are
 * deeply frozen, so they cannot have been edited. Any copy, JSON round trip, hand-built or inherited
 * object is refused explicitly, even with identical content. The shape checks below are a cheap
 * second guard; they never re-run the simulation.
 */
export function trustedRun(run: unknown): ExperimentRun | null {
  if (!isTrustedRun(run)) return null;
  try {
    if (!Number.isSafeInteger(run.runId) || !isObject(run.snapshot) || !isObject(run.teams) || !isObject(run.result)) return null;
    if (!isManagerInput(run.input) || run.input.seed !== run.seed || !sameValue(run.result.input, run.input)) return null;
    const order = sourceTeamOrder(run.snapshot);
    if (!order || typeof run.snapshot.evidenceIdentity !== "string") return null;
    simulationInputKey(run.snapshot); // malformed snapshots throw here and are refused
    if (run.endMinute !== run.result.minute) return null;
    for (const [i, core] of CORE_TEAM_IDS.entries()) {
      const team = run.teams[core];
      if (!isObject(team) || team.core !== core || team.sourceId !== order[i] || run.input.teams[i].id !== core) return null;
      if (!sameValue(run.input.teams[i].assumptions, team.assumptions)) return null;
      if (typeof team.name !== "string" || (team.sideAtRun !== "BLUE" && team.sideAtRun !== "RED")) return null;
      if (run.snapshot.draft.teams[team.sideAtRun].id !== team.sourceId) return null;
    }
  } catch { return null; }
  return run;
}

const UNTRUSTED = "이 화면에서 직접 실행한 기록만 사용할 수 있습니다 (복사·수정된 기록은 받지 않습니다).";

const finished = (run: ExperimentRun, shownMinute: number) =>
  Number.isFinite(shownMinute) && replayFrame(run, shownMinute).complete;

/** Keep a trusted run as baseline A (a detached frozen clone), only after it was watched to its end. */
export function freezeBaseline(run: unknown, shownMinute: number): FreezeResult {
  const trusted = trustedRun(run);
  if (!trusted) return { ok: false, message: UNTRUSTED };
  if (!finished(trusted, shownMinute)) return { ok: false, message: "재생을 끝까지 본 실행만 기준 A로 보관할 수 있습니다." };
  const baseline = cloneTrustedRun(trusted);
  return baseline ? { ok: true, baseline } : { ok: false, message: UNTRUSTED };
}

type InputKey = { model: string; patch: string; cutoff: string; sources: string[]; blue: string; red: string; first: string; games: unknown; selections: unknown; roster: unknown; roles: unknown };

/** Why the two fixed inputs differ, by the parts of the shared canonical input key. */
function inputRefusals(a: ExperimentRun, b: ExperimentRun): ComparisonRefusal[] {
  const refusals: ComparisonRefusal[] = [];
  const ka = JSON.parse(simulationInputKey(a.snapshot)) as InputKey;
  const kb = JSON.parse(simulationInputKey(b.snapshot)) as InputKey;
  const orderA = sourceTeamOrder(a.snapshot)!, orderB = sourceTeamOrder(b.snapshot)!;
  if (a.snapshot.evidenceIdentity !== b.snapshot.evidenceIdentity || !sameValue([ka.model, ka.patch, ka.cutoff, ka.sources], [kb.model, kb.patch, kb.cutoff, kb.sources])) {
    refusals.push({ code: "EVIDENCE", message: "분석 자료(패치·기준 시점·출처 버전)가 다릅니다." });
  }
  if (orderA[0] !== orderB[0] || orderA[1] !== orderB[1]) {
    refusals.push({ code: "TEAMS", message: "두 실행의 팀(팀 ID)이 다릅니다." });
    return refusals; // roster/role rows are keyed by different teams; further parts are not comparable
  }
  if (!sameValue([ka.blue, ka.red, ka.first, ka.games, ka.selections], [kb.blue, kb.red, kb.first, kb.games, kb.selections])) {
    refusals.push({ code: "DRAFT", message: "밴픽(진영·선픽·이전 세트·선택 순서)이 다릅니다." });
  }
  if (!sameValue(ka.roster, kb.roster)) refusals.push({ code: "ROSTER", message: "가상 로스터 선수가 다릅니다." });
  if (!sameValue(ka.roles, kb.roles)) refusals.push({ code: "ROLES", message: "챔피언 역할 배정이 다릅니다." });
  return refusals;
}

/**
 * Compare B against A. `shownMinute` is the minute of B currently on screen: outcome numbers are
 * returned only when that is B's end. Returned objects never reference either run.
 */
export function compareExperimentRuns(baseline: unknown, candidate: unknown, shownMinute: number): ExperimentComparison {
  const a = trustedRun(baseline), b = trustedRun(candidate);
  if (!a || !b) return { ok: false, refusals: [{ code: "UNTRUSTED", message: UNTRUSTED }] };
  const refusals: ComparisonRefusal[] = [];
  if (a.input.ruleset !== b.input.ruleset) refusals.push({ code: "RULESET", message: "모델 규칙 버전이 다릅니다." });
  if (a.seed !== b.seed) refusals.push({ code: "SEED", message: `재현 번호가 다릅니다 (A ${a.seed} · B ${b.seed}). 같은 조건이 아니므로 비교하지 않습니다.` });
  refusals.push(...inputRefusals(a, b));
  if (!refusals.length && !sameSimulationInput(a.snapshot, b.snapshot)) refusals.push({ code: "INPUT", message: "고정 입력이 다릅니다." });
  if (refusals.length) return { ok: false, refusals };

  // Teams are matched by source team ID, never by side or display name.
  const order = sourceTeamOrder(a.snapshot)!;
  const coreOf = (run: ExperimentRun, id: string) => CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === id)!;
  const changes: AssumptionChange[] = [];
  const teams: TeamAssumptionDiff[] = order.map((id) => {
    const ta = a.teams[coreOf(a, id)], tb = b.teams[coreOf(b, id)];
    const fields = Object.fromEntries(ASSUMPTION_FIELDS.map((field) => {
      const va = ta.assumptions[field], vb = tb.assumptions[field];
      const changed = va !== vb;
      if (changed) changes.push({ sourceId: id, field, a: va, b: vb });
      return [field, { a: va, b: vb, changed }];
    })) as TeamAssumptionDiff["fields"];
    return { sourceId: id, name: tb.name, fields };
  });
  const changeKind: ChangeKind = changes.length === 0 ? "NONE" : changes.length === 1 ? "SINGLE" : "MULTIPLE";

  let outcome: OutcomeComparison | null = null;
  if (finished(b, shownMinute)) {
    const stateOf = (run: ExperimentRun, id: string): ManagerState => ({ ...replayFrame(run, run.endMinute).states[coreOf(run, id) as CoreTeamId] });
    outcome = {
      teams: order.map((id) => {
        const sa = stateOf(a, id), sb = stateOf(b, id);
        const delta = Object.fromEntries(OUTCOME_STATS.map((stat) => [stat, sb[stat] - sa[stat]])) as ManagerState;
        return { sourceId: id, name: b.teams[coreOf(b, id)].name, a: sa, b: sb, delta };
      }),
      end: {
        a: { minute: a.result.minute, reason: a.result.reason },
        b: { minute: b.result.minute, reason: b.result.reason },
        minuteDelta: b.result.minute - a.result.minute,
      },
    };
  }
  return { ok: true, seed: a.seed, teams, changes, changeKind, outcome };
}
