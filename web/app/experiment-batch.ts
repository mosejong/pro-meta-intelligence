import { simulateManager, type ManagerInput, type ManagerResult } from "./simulation-core";
import { CORE_TEAM_IDS, replayFrame, sourceTeamOrder, type CoreTeamId, type ExperimentRun } from "./experiment-replay";
import { compareExperimentRuns, trustedRun, type AssumptionChange, type ChangeKind, type ComparisonRefusal } from "./experiment-comparison";
import { simulationInputKey } from "./simulation-scenario";

/**
 * Paired multi-seed batch of an already comparable A/B pair (pure, explicit only).
 *
 * Reuses the A/B comparison gate: A and B must be trusted, with the same ruleset, fixed input and
 * source team IDs, and B must have been watched to its end. Then A's and B's own assumptions are run
 * through the same model on the same predetermined seed list, so each pair differs only in the user's
 * assumptions. Output is model-internal win counts (with denominator) and min/median/max of B − A
 * differences. These seeds are a fixed model experiment, not a sample: no win rate, interval or
 * real-game prediction is produced. Players/champions/runes/items still have no modelled effect.
 */

export const BATCH_DEFAULT_PAIRS = 20;
export const BATCH_MAX_PAIRS = 30;
/** Predetermined, documented seed list; the first N are used for both A and B. */
export const BATCH_SEED_LIST_ID = "batch-seeds-1-30-v1";
export const BATCH_SEEDS: readonly number[] = Object.freeze(Array.from({ length: BATCH_MAX_PAIRS }, (_, i) => i + 1));

export type BatchTarget = { baselineRunId: number; candidateRunId: number; pairs: number };

type TeamEnd = { gold: number; kills: number };
type SideEnd = { winner: string; minute: number; reason: ManagerResult["reason"]; teams: Record<string, TeamEnd> };
export type BatchRow = {
  seed: number;
  a: SideEnd;
  b: SideEnd;
  /** B − A per source team ID. */
  delta: Record<string, TeamEnd>;
  minuteDelta: number;
};
export type Spread = { min: number; median: number; max: number };
export type BatchSummary = {
  denominator: number;
  /** Model-internal wins per source team ID under A and under B (out of `denominator`). */
  wins: Record<string, { a: number; b: number }>;
  gold: Record<string, Spread>;
  kills: Record<string, Spread>;
  minute: Spread;
  /** True when every pair difference is exactly zero (expected when A and B assumptions are equal). */
  allZero: boolean;
};
export type BatchResult = {
  ok: true;
  target: BatchTarget;
  ruleset: string;
  seedListId: string;
  seeds: number[];
  context: { inputKey: string; evidenceIdentity: string; teamOrder: [string, string]; names: Record<string, string> };
  changes: AssumptionChange[];
  changeKind: ChangeKind;
  rows: BatchRow[];
  summary: BatchSummary;
};
export type BatchOutcome = BatchResult | { ok: false; refusals: ComparisonRefusal[] };

export type PairsParse = { ok: true; value: number } | { ok: false; message: string };

/** Pair count: plain integer 1..30. */
export function parsePairCount(text: string): PairsParse {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!/^[1-9]\d{0,1}$/.test(raw) || Number(raw) > BATCH_MAX_PAIRS) return { ok: false, message: `쌍 수는 1 이상 ${BATCH_MAX_PAIRS} 이하의 정수여야 합니다.` };
  return { ok: true, value: Number(raw) };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function spreadOf(values: number[]): Spread {
  const sorted = [...values].sort((x, y) => x - y);
  const n = sorted.length, mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], median: median === 0 ? 0 : median, max: sorted[n - 1] };
}

const refuse = (code: ComparisonRefusal["code"], message: string): BatchOutcome => ({ ok: false, refusals: [{ code, message }] });

/** One model run of `run`'s own assumptions on `seed`, read back through the replay frame. */
function sideEnd(run: ExperimentRun, seed: number, coreOf: (id: string) => CoreTeamId, order: [string, string]): SideEnd | null {
  const input: ManagerInput = {
    ruleset: run.input.ruleset,
    seed,
    teams: run.input.teams.map((t) => ({ id: t.id, assumptions: { ...t.assumptions } })) as ManagerInput["teams"],
  };
  let result: ManagerResult;
  try { result = simulateManager(input); } catch { return null; }
  const final = replayFrame({ result, endMinute: result.minute }, result.minute);
  if (!final.complete || result.events.at(-1)?.kind !== "END") return null;
  const teams: Record<string, TeamEnd> = {};
  for (const id of order) {
    const core = coreOf(id), state = final.states[core], model = result.states[core];
    if (!model || state.gold !== model.gold || state.kills !== model.kills) return null;
    teams[id] = { gold: state.gold, kills: state.kills };
  }
  const winner = CORE_TEAM_IDS.includes(result.winner as CoreTeamId) ? run.teams[result.winner as CoreTeamId].sourceId : null;
  if (!winner) return null;
  return { winner, minute: result.minute, reason: result.reason, teams };
}

/**
 * Run the batch once. `shownMinute` is the on-screen minute of B; the batch is refused until B is
 * finished. Inputs are only read; the result is detached and deeply frozen.
 */
export function runExperimentBatch(baseline: unknown, candidate: unknown, shownMinute: number, pairs: number): BatchOutcome {
  if (!Number.isSafeInteger(pairs) || pairs < 1 || pairs > BATCH_MAX_PAIRS) return refuse("INPUT", `쌍 수는 1 이상 ${BATCH_MAX_PAIRS} 이하의 정수여야 합니다.`);
  const comparison = compareExperimentRuns(baseline, candidate, shownMinute);
  if (!comparison.ok) return comparison;
  if (!comparison.outcome) return refuse("INPUT", "실행 B 재생이 끝난 뒤에만 여러 재현 번호 비교를 실행할 수 있습니다.");
  const a = trustedRun(baseline)!, b = trustedRun(candidate)!;
  if (a.runId === b.runId) return refuse("INPUT", "기준 A와 실행 B가 같은 실행입니다.");
  const order = sourceTeamOrder(a.snapshot)!;
  const coreIn = (run: ExperimentRun) => (id: string) => CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === id)!;
  const seeds = BATCH_SEEDS.slice(0, pairs);

  const rows: BatchRow[] = [];
  for (const seed of seeds) {
    const ea = sideEnd(a, seed, coreIn(a), order), eb = sideEnd(b, seed, coreIn(b), order);
    if (!ea || !eb) return refuse("UNTRUSTED", `재현 번호 ${seed}에서 모델 결과를 검증하지 못해 전체 비교를 표시하지 않습니다.`);
    const delta = Object.fromEntries(order.map((id) => [id, { gold: eb.teams[id].gold - ea.teams[id].gold, kills: eb.teams[id].kills - ea.teams[id].kills }]));
    rows.push({ seed, a: ea, b: eb, delta, minuteDelta: eb.minute - ea.minute });
  }

  const wins = Object.fromEntries(order.map((id) => [id, {
    a: rows.filter((r) => r.a.winner === id).length,
    b: rows.filter((r) => r.b.winner === id).length,
  }]));
  const per = (stat: keyof TeamEnd) => Object.fromEntries(order.map((id) => [id, spreadOf(rows.map((r) => r.delta[id][stat]))]));
  const allZero = rows.every((r) => r.minuteDelta === 0 && r.a.winner === r.b.winner && order.every((id) => r.delta[id].gold === 0 && r.delta[id].kills === 0));

  const result: BatchResult = {
    ok: true,
    target: { baselineRunId: a.runId, candidateRunId: b.runId, pairs },
    ruleset: a.input.ruleset,
    seedListId: BATCH_SEED_LIST_ID,
    seeds,
    context: {
      inputKey: simulationInputKey(a.snapshot),
      evidenceIdentity: a.snapshot.evidenceIdentity,
      teamOrder: [order[0], order[1]],
      names: Object.fromEntries(order.map((id) => [id, b.teams[coreIn(b)(id)].name])),
    },
    changes: comparison.changes.map((c) => ({ ...c })),
    changeKind: comparison.changeKind,
    rows,
    summary: { denominator: rows.length, wins, gold: per("gold"), kills: per("kills"), minute: spreadOf(rows.map((r) => r.minuteDelta)), allZero },
  };
  return deepFreeze(result);
}

/** Whether a stored batch still belongs to the current A/B pair (no silent recompute). */
export function batchMatchesTarget(result: BatchResult | null, baselineRunId: number | null, candidateRunId: number): boolean {
  return !!result && result.target.baselineRunId === baselineRunId && result.target.candidateRunId === candidateRunId;
}
