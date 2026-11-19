import { CORE_TEAM_IDS, MAX_MINUTE, replayFrame, type CoreTeamId, type ExperimentRun } from "./experiment-replay";

/**
 * Past-only model-resource history of an already computed run (pure, display only).
 *
 * Every point is read from the existing `replayFrame` at that minute, so there is no second copy of the
 * resource rule and no model call (no simulateManager/buildExperimentRun/batch). Only minutes 0..shown
 * are returned (at most MAX_MINUTE + 1 frames). The output carries no winner, no completion flag, no
 * end minute and nothing after the shown minute. Team labels come from the run's fixed teams only,
 * never from the current team selection or input fields. The run is never mutated and the result is
 * freshly allocated, so changing it cannot touch the run.
 *
 * Shown-minute normalisation matches replayFrame (floor, clamp 0..endMinute, non-finite/non-number → 0).
 * An invalid run (endMinute not an integer in 0..MAX_MINUTE, missing events or teams, non-finite
 * resource values) is refused with null rather than drawn.
 */

export type ResourceHistoryTeam = { core: CoreTeamId; name: string; sideAtRun: "BLUE" | "RED"; label: string };
export type ResourceHistoryPoint = { minute: number; gold: Record<CoreTeamId, number> };
export type ResourceHistory = {
  /** Normalised shown minute: last point's minute. */
  shownMinute: number;
  teams: Record<CoreTeamId, ResourceHistoryTeam>;
  /** Minutes 0..shownMinute in order, one point each. */
  points: ResourceHistoryPoint[];
  /** Min / max over the shown points only. */
  minGold: number;
  maxGold: number;
};

type HistoryRun = Pick<ExperimentRun, "result" | "endMinute" | "teams">;

const sideText = (side: "BLUE" | "RED") => side === "BLUE" ? "블루" : "레드";

export function resourceHistory(run: HistoryRun, shownMinute: number): ResourceHistory | null {
  const end = run?.endMinute;
  if (typeof end !== "number" || !Number.isInteger(end) || end < 0 || end > MAX_MINUTE) return null;
  if (!Array.isArray(run.result?.events) || !run.teams || typeof run.teams !== "object") return null;
  const fixed: Partial<Record<CoreTeamId, { name: string; sideAtRun: "BLUE" | "RED" }>> = {};
  for (const core of CORE_TEAM_IDS) {
    const team = run.teams[core];
    if (!team || typeof team.name !== "string" || (team.sideAtRun !== "BLUE" && team.sideAtRun !== "RED")) return null;
    fixed[core] = { name: team.name, sideAtRun: team.sideAtRun };
  }
  const a = fixed.team_a!, b = fixed.team_b!;
  // Same display name: keep both readable by the side each team had in this run (not a raw ID).
  const sameName = a.name === b.name;
  const teams = Object.fromEntries(CORE_TEAM_IDS.map((core) => {
    const t = fixed[core]!;
    return [core, { core, name: t.name, sideAtRun: t.sideAtRun, label: sameName ? `${t.name} (실행 당시 ${sideText(t.sideAtRun)})` : t.name }];
  })) as Record<CoreTeamId, ResourceHistoryTeam>;

  const requested = typeof shownMinute === "number" ? shownMinute : 0;
  // replayFrame is the single authority for the normalised minute.
  const at = replayFrame({ result: run.result, endMinute: end }, requested).minute;
  const points: ResourceHistoryPoint[] = [];
  let minGold = Infinity, maxGold = -Infinity;
  for (let minute = 0; minute <= at; minute++) {
    const frame = replayFrame({ result: run.result, endMinute: end }, minute);
    const gold = { team_a: frame.states.team_a.gold, team_b: frame.states.team_b.gold };
    for (const core of CORE_TEAM_IDS) {
      if (!Number.isFinite(gold[core])) return null;
      minGold = Math.min(minGold, gold[core]);
      maxGold = Math.max(maxGold, gold[core]);
    }
    points.push({ minute, gold });
  }
  return { shownMinute: at, teams, points, minGold, maxGold };
}

export type ResourceChartGeometry = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** SVG polyline `points` attribute per team; a single point at minute 0. */
  lines: Record<CoreTeamId, string>;
  /** Last (current) point per team. */
  current: Record<CoreTeamId, { x: number; y: number }>;
  xTicks: { minute: number; x: number }[];
  yTicks: { value: number; y: number }[];
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Chart coordinates for a history. The x axis spans only 0..shownMinute (minute 0 → a single point at
 * the left edge) and the y axis only the shown values; equal values get a fixed band. All coordinates
 * are finite; no division by zero.
 */
export function resourceChartGeometry(history: ResourceHistory, width = 320, height = 160): ResourceChartGeometry {
  const plot = { left: 52, right: width - 12, top: 12, bottom: height - 24 };
  const span = history.shownMinute;
  const xOf = (minute: number) => round(span > 0 ? plot.left + (minute / span) * (plot.right - plot.left) : plot.left);
  const lo = history.minGold, hi = history.maxGold;
  const flat = !(hi > lo);
  const yOf = (value: number) => round(flat ? (plot.top + plot.bottom) / 2 : plot.bottom - ((value - lo) / (hi - lo)) * (plot.bottom - plot.top));
  const lines = {} as Record<CoreTeamId, string>;
  const current = {} as Record<CoreTeamId, { x: number; y: number }>;
  for (const core of CORE_TEAM_IDS) {
    lines[core] = history.points.map((p) => `${xOf(p.minute)},${yOf(p.gold[core])}`).join(" ");
    const last = history.points[history.points.length - 1];
    current[core] = { x: xOf(last.minute), y: yOf(last.gold[core]) };
  }
  const xTicks = span > 0 ? [{ minute: 0, x: xOf(0) }, { minute: span, x: xOf(span) }] : [{ minute: 0, x: xOf(0) }];
  const yTicks = flat ? [{ value: lo, y: yOf(lo) }] : [{ value: lo, y: yOf(lo) }, { value: hi, y: yOf(hi) }];
  return { width, height, plot, lines, current, xTicks, yTicks };
}
