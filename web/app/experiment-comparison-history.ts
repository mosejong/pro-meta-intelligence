import { compareExperimentRuns, trustedRun, type ChangeKind, type ComparisonRefusal } from "./experiment-comparison";
import { CORE_TEAM_IDS, sourceTeamOrder, type CoreTeamId, type ExperimentRun } from "./experiment-replay";
import { resourceHistory, type ResourceChartSeries } from "./experiment-resource-history";

/**
 * Same-team model-resource difference (B − A) of two finished A/B runs, minute by minute (pure, display only).
 *
 * Gate: the existing `compareExperimentRuns` decides everything (trust, ruleset, seed, evidence, teams,
 * draft, roster, roles, input) and whether B is at its end; nothing is relaxed or re-implemented here.
 * The same run as A and B is refused additionally. Until B is finished the result is PENDING with no
 * points, axis or end minute.
 *
 * Only the common span 0..min(A end, B end) is compared: the run that ended first is not held at its
 * final state, interpolated or extrapolated. Each run's raw model gold per minute comes from the
 * existing `resourceHistory` (= replayFrame), teams are paired by source team ID (never by side, colour
 * or display name), and the difference is B − A of the same team, not a gap between the two teams.
 * The frozen runs are only read; no model, build or batch run. The result is freshly allocated.
 */

export type ComparisonHistoryRefusalCode = ComparisonRefusal["code"] | "SAME_RUN" | "INVALID";
export type ComparisonHistoryRefusal = { code: ComparisonHistoryRefusalCode; message: string };

export type ComparisonHistoryTeam = { name: string; label: string };
export type ComparisonHistoryPoint = {
  minute: number;
  /** B − A per team, in source team order. */
  delta: [number, number];
  /** Raw model gold of A / B per team (source order), kept only so each point can be checked. */
  a: [number, number];
  b: [number, number];
};

export type ComparisonHistory =
  | { status: "REFUSED"; refusals: ComparisonHistoryRefusal[] }
  | { status: "PENDING" }
  | {
    status: "READY";
    changeKind: ChangeKind;
    /** Teams in source team order (labels only, no IDs). */
    teams: [ComparisonHistoryTeam, ComparisonHistoryTeam];
    /** min(A end, B end): last compared minute. */
    commonEndMinute: number;
    endMinutes: { a: number; b: number };
    /** Minutes 0..commonEndMinute, one point each. */
    points: ComparisonHistoryPoint[];
    minDelta: number;
    maxDelta: number;
  };

const SAME_RUN = "기준 A와 실행 B가 같은 실행이라 비교하지 않습니다.";
const INVALID = "실행 기록을 읽을 수 없어 같은 시각 차이를 표시하지 않습니다.";

export function experimentComparisonHistory(baseline: unknown, candidate: unknown, shownMinuteB: number): ComparisonHistory {
  const comparison = compareExperimentRuns(baseline, candidate, shownMinuteB);
  if (!comparison.ok) return { status: "REFUSED", refusals: comparison.refusals.map((r) => ({ ...r })) };
  const a = trustedRun(baseline)!, b = trustedRun(candidate)!;
  if (a === b || a.runId === b.runId) return { status: "REFUSED", refusals: [{ code: "SAME_RUN", message: SAME_RUN }] };
  if (!comparison.outcome) return { status: "PENDING" };

  const order = sourceTeamOrder(a.snapshot);
  const coreOf = (run: ExperimentRun, id: string) => CORE_TEAM_IDS.find((core) => run.teams[core].sourceId === id);
  const common = Math.min(a.endMinute, b.endMinute);
  const ha = resourceHistory(a, common), hb = resourceHistory(b, common);
  if (!order || !ha || !hb || ha.shownMinute !== common || hb.shownMinute !== common) return { status: "REFUSED", refusals: [{ code: "INVALID", message: INVALID }] };
  const cores = order.map((id) => [coreOf(a, id), coreOf(b, id)] as const);
  if (cores.some(([ca, cb]) => !ca || !cb)) return { status: "REFUSED", refusals: [{ code: "INVALID", message: INVALID }] };
  const pairs = cores as readonly (readonly [CoreTeamId, CoreTeamId])[];

  let minDelta = Infinity, maxDelta = -Infinity;
  const points: ComparisonHistoryPoint[] = [];
  for (let i = 0; i <= common; i++) {
    const pa = ha.points[i], pb = hb.points[i];
    if (!pa || !pb || pa.minute !== i || pb.minute !== i) return { status: "REFUSED", refusals: [{ code: "INVALID", message: INVALID }] };
    const av = pairs.map(([ca]) => pa.gold[ca]) as [number, number];
    const bv = pairs.map(([, cb]) => pb.gold[cb]) as [number, number];
    const delta = bv.map((v, k) => v - av[k] + 0) as [number, number]; // + 0 normalises -0
    for (const d of delta) {
      if (!Number.isFinite(d)) return { status: "REFUSED", refusals: [{ code: "INVALID", message: INVALID }] };
      minDelta = Math.min(minDelta, d); maxDelta = Math.max(maxDelta, d);
    }
    points.push({ minute: i, delta, a: av, b: bv });
  }
  // Labels from B's fixed teams; the existing same-name rule (side at run) keeps them apart without IDs.
  const teams = pairs.map(([, cb]) => ({ name: hb.teams[cb].name, label: hb.teams[cb].label })) as [ComparisonHistoryTeam, ComparisonHistoryTeam];
  return {
    status: "READY", changeKind: comparison.changeKind, teams, commonEndMinute: common,
    endMinutes: { a: a.endMinute, b: b.endMinute }, points, minDelta, maxDelta,
  };
}

/** The delta series in the chart-series shape; slot i is the i-th team in source order (line style only). */
export function comparisonDeltaSeries(history: Extract<ComparisonHistory, { status: "READY" }>): ResourceChartSeries {
  return {
    shownMinute: history.commonEndMinute,
    points: history.points.map((p) => ({ minute: p.minute, gold: { team_a: p.delta[0], team_b: p.delta[1] } })),
    minGold: history.minDelta,
    maxGold: history.maxDelta,
  };
}
