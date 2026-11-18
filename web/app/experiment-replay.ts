import {
  SIMULATION_MAX_MINUTES,
  SIMULATION_RULESET,
  simulateManager,
  type ManagerAssumptions,
  type ManagerEvent,
  type ManagerInput,
  type ManagerResult,
  type ManagerState,
} from "./simulation-core";
import type { SimulationInputSnapshot } from "./simulation-scenario";

/**
 * Fixed-draft assumption experiment and replay (pure adapter).
 *
 * Takes the parent's validated readiness snapshot plus explicit user assumptions (-1..1, default 0)
 * and seed, runs `simulateManager` once and freezes the run. Champions, players, names, seasons and
 * records never set an assumption: they are carried only as the fixed context of the run.
 * Replay frames are rebuilt from events visible up to a minute; the winner is exposed only at the end.
 * This is an abstract model of user assumptions, not real LoL win probability or a real-game replay.
 */

export const ASSUMPTION_FIELDS = ["lane", "tempo", "teamfight"] as const;
export type AssumptionField = (typeof ASSUMPTION_FIELDS)[number];
export const CORE_TEAM_IDS = ["team_a", "team_b"] as const;
export type CoreTeamId = (typeof CORE_TEAM_IDS)[number];
/** Raw text of the three assumption inputs of one team. */
export type AssumptionDraft = Record<AssumptionField, string>;
export const NEUTRAL_DRAFT: Readonly<AssumptionDraft> = Object.freeze({ lane: "0", tempo: "0", teamfight: "0" });
export const DEFAULT_SEED = "1";
export const INITIAL_STATE: Readonly<ManagerState> = Object.freeze({ gold: 2500, kills: 0, objectives: 0, base: 100 });
/** Mirrors the authored rule in simulation-core; the final frame is checked against the model total. */
const SKIRMISH_GOLD_PER_KILL = 300;
const OBJECTIVE_GOLD = 600;
export const MAX_MINUTE = SIMULATION_MAX_MINUTES;
export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Display interval of one model minute at 1x. Speed only divides this. */
export const BASE_MINUTE_MS = 700;

export type ParseResult = { ok: true; value: number } | { ok: false; message: string };

const SEED_PATTERN = /^(0|[1-9]\d{0,9})$/;
const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

/** Seed: plain decimal integer 0..4294967295. Blank, signs, exponents and fractions are rejected. */
export function parseSeed(text: string): ParseResult {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { ok: false, message: "시드를 입력하세요." };
  if (!SEED_PATTERN.test(raw)) return { ok: false, message: "시드는 0 이상 4294967295 이하의 정수여야 합니다." };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 0xffffffff) return { ok: false, message: "시드는 0 이상 4294967295 이하의 정수여야 합니다." };
  return { ok: true, value };
}

/** Assumption: finite plain decimal in [-1, 1]. No silent clamp or fallback to an earlier value. */
export function parseAssumption(text: string): ParseResult {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { ok: false, message: "값을 입력하세요." };
  if (!DECIMAL_PATTERN.test(raw)) return { ok: false, message: "숫자로 입력하세요." };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < -1 || value > 1) return { ok: false, message: "-1 이상 1 이하여야 합니다." };
  return { ok: true, value: value === 0 ? 0 : value };
}

/** Source team IDs of a snapshot, sorted by code unit: [team_a source, team_b source]. Side-independent. */
export function sourceTeamOrder(snapshot: SimulationInputSnapshot): [string, string] | null {
  const ids = [snapshot.draft.teams.BLUE.id, snapshot.draft.teams.RED.id];
  if (typeof ids[0] !== "string" || typeof ids[1] !== "string" || ids[0] === ids[1]) return null;
  const sorted = [...ids].sort((a, b) => a < b ? -1 : 1);
  return [sorted[0], sorted[1]];
}

export type RunIssue = { field: "seed" | "team" | AssumptionField; teamId?: string; message: string };

export type ExperimentTeam = { core: CoreTeamId; sourceId: string; name: string; sideAtRun: "BLUE" | "RED"; assumptions: ManagerAssumptions };
export type ExperimentRun = {
  runId: number;
  /** Detached copy of the readiness snapshot this run was made from. */
  snapshot: SimulationInputSnapshot;
  seed: number;
  teams: Record<CoreTeamId, ExperimentTeam>;
  input: ManagerInput;
  result: ManagerResult;
  endMinute: number;
};

export type BuildRunResult = { ok: true; run: ExperimentRun } | { ok: false; issues: RunIssue[] };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Validate the raw inputs without running anything. Assumptions are keyed by source team ID only. */
export function validateRunInputs(snapshot: SimulationInputSnapshot | null, seedText: string, drafts: Record<string, AssumptionDraft | undefined>):
  { ok: true; seed: number; assumptions: Record<string, ManagerAssumptions> } | { ok: false; issues: RunIssue[] } {
  const issues: RunIssue[] = [];
  if (!snapshot) return { ok: false, issues: [{ field: "team", message: "준비된 시뮬레이션 입력이 없습니다." }] };
  const order = sourceTeamOrder(snapshot);
  if (!order) return { ok: false, issues: [{ field: "team", message: "두 팀 ID가 올바르지 않습니다." }] };
  const seed = parseSeed(seedText);
  if (!seed.ok) issues.push({ field: "seed", message: seed.message });
  const assumptions: Record<string, ManagerAssumptions> = {};
  for (const id of order) {
    // Only explicitly supplied (own) rows and fields count; inherited values are never assumptions.
    const draft = drafts !== null && typeof drafts === "object" && Object.hasOwn(drafts, id) ? drafts[id] : undefined;
    if (!draft || typeof draft !== "object") { issues.push({ field: "team", teamId: id, message: "팀 가정값이 없습니다." }); continue; }
    const values: Partial<ManagerAssumptions> = {};
    for (const field of ASSUMPTION_FIELDS) {
      const parsed = Object.hasOwn(draft, field) ? parseAssumption(draft[field]) : { ok: false as const, message: "값을 입력하세요." };
      if (parsed.ok) values[field] = parsed.value;
      else issues.push({ field, teamId: id, message: parsed.message });
    }
    assumptions[id] = values as ManagerAssumptions;
  }
  if (issues.length || !seed.ok) return { ok: false, issues };
  return { ok: true, seed: seed.value, assumptions };
}

/** Core input with safe IDs: sorted source IDs → team_a/team_b. No champion/player data enters. */
export function coreInputOf(snapshot: SimulationInputSnapshot, seed: number, assumptions: Record<string, ManagerAssumptions>): ManagerInput | null {
  const order = sourceTeamOrder(snapshot);
  if (!order || !assumptions[order[0]] || !assumptions[order[1]]) return null;
  return {
    ruleset: SIMULATION_RULESET,
    seed,
    teams: [
      { id: CORE_TEAM_IDS[0], assumptions: { lane: assumptions[order[0]].lane, tempo: assumptions[order[0]].tempo, teamfight: assumptions[order[0]].teamfight } },
      { id: CORE_TEAM_IDS[1], assumptions: { lane: assumptions[order[1]].lane, tempo: assumptions[order[1]].tempo, teamfight: assumptions[order[1]].teamfight } },
    ],
  };
}

/**
 * The only place that calls the model: one explicit run, frozen. The final replay frame must match
 * the model's own totals, otherwise the run is refused rather than shown with a drifting replay.
 */
export function buildExperimentRun(runId: number, snapshot: SimulationInputSnapshot | null, seedText: string, drafts: Record<string, AssumptionDraft | undefined>): BuildRunResult {
  const valid = validateRunInputs(snapshot, seedText, drafts);
  if (!valid.ok || !snapshot) return { ok: false, issues: valid.ok ? [] : valid.issues };
  const fixed = structuredClone(snapshot);
  const order = sourceTeamOrder(fixed)!;
  const input = coreInputOf(fixed, valid.seed, valid.assumptions)!;
  let result: ManagerResult;
  try { result = simulateManager(input); } catch { return { ok: false, issues: [{ field: "team", message: "모델이 이 입력을 받지 않았습니다." }] }; }
  const sideOf = (id: string) => fixed.draft.teams.BLUE.id === id ? "BLUE" as const : "RED" as const;
  const nameOf = (id: string) => sideOf(id) === "BLUE" ? fixed.draft.teams.BLUE.name : fixed.draft.teams.RED.name;
  const teams = Object.fromEntries(CORE_TEAM_IDS.map((core, i) => [core, {
    core, sourceId: order[i], name: nameOf(order[i]), sideAtRun: sideOf(order[i]), assumptions: { ...input.teams[i].assumptions },
  }])) as Record<CoreTeamId, ExperimentTeam>;
  const run: ExperimentRun = { runId, snapshot: fixed, seed: valid.seed, teams, input, result, endMinute: result.minute };
  const final = replayFrame(run, run.endMinute);
  const sameState = CORE_TEAM_IDS.every((id) => {
    const a = final.states[id], b = result.states[id];
    return b && a.gold === b.gold && a.kills === b.kills && a.objectives === b.objectives && a.base === b.base;
  });
  if (!sameState || !final.complete || result.events.at(-1)?.kind !== "END") {
    return { ok: false, issues: [{ field: "team", message: "재생 상태가 모델 최종 상태와 맞지 않아 실행 결과를 표시하지 않습니다." }] };
  }
  return { ok: true, run: deepFreeze(run) };
}

export type ReplayFrame = {
  minute: number;
  complete: boolean;
  states: Record<CoreTeamId, ManagerState>;
  /** Visible non-growth events (skirmish/objective/base), oldest first. END is never included. */
  log: ManagerEvent[];
  /** Model-internal outcome, only on the final frame. */
  outcome: { winner: CoreTeamId; reason: ManagerResult["reason"]; minute: number } | null;
};

/** State at a minute from events up to that minute only. Future events and the winner stay hidden. */
export function replayFrame(run: Pick<ExperimentRun, "result" | "endMinute">, minute: number): ReplayFrame {
  const at = Number.isFinite(minute) ? Math.max(0, Math.min(run.endMinute, Math.floor(minute))) : 0;
  const complete = at >= run.endMinute;
  const states = Object.fromEntries(CORE_TEAM_IDS.map((id) => [id, { ...INITIAL_STATE }])) as Record<CoreTeamId, ManagerState>;
  const other = (id: CoreTeamId): CoreTeamId => id === "team_a" ? "team_b" : "team_a";
  const log: ManagerEvent[] = [];
  for (const event of run.result.events) {
    if (event.minute > at || event.kind === "END") continue;
    const actor = event.actor as CoreTeamId;
    if (!states[actor]) continue;
    if (event.kind === "GROWTH") states[actor].gold += event.amount;
    else if (event.kind === "SKIRMISH") { states[actor].kills += event.amount; states[actor].gold += event.amount * SKIRMISH_GOLD_PER_KILL; log.push({ ...event }); }
    else if (event.kind === "OBJECTIVE") { states[actor].objectives += event.amount; states[actor].gold += OBJECTIVE_GOLD; log.push({ ...event }); }
    else if (event.kind === "BASE") { states[other(actor)].base -= event.amount; log.push({ ...event }); }
  }
  return {
    minute: at, complete, states, log,
    outcome: complete ? { winner: run.result.winner as CoreTeamId, reason: run.result.reason, minute: run.result.minute } : null,
  };
}

/** Playback state: display only. No action here computes, draws random numbers or changes a result. */
export type PlaybackState = { runId: number | null; endMinute: number; cursor: number; playing: boolean; speed: Speed };
export type PlaybackAction =
  | { type: "LOAD"; runId: number; endMinute: number }
  | { type: "PLAY" } | { type: "PAUSE" } | { type: "RESET" } | { type: "STEP" }
  | { type: "SEEK"; minute: number }
  | { type: "SPEED"; speed: number }
  | { type: "TICK"; runId: number };

export const INITIAL_PLAYBACK: PlaybackState = { runId: null, endMinute: 0, cursor: 0, playing: false, speed: 1 };

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  const clamp = (value: number) => Math.max(0, Math.min(state.endMinute, Math.floor(value)));
  switch (action.type) {
    case "LOAD": return { runId: action.runId, endMinute: action.endMinute, cursor: 0, playing: false, speed: state.speed };
    case "PLAY":
      if (state.runId === null) return state;
      return { ...state, cursor: state.cursor >= state.endMinute ? 0 : state.cursor, playing: true };
    case "PAUSE": return state.playing ? { ...state, playing: false } : state;
    case "RESET": return state.runId === null ? state : { ...state, cursor: 0, playing: false };
    case "STEP": return state.runId === null ? state : { ...state, cursor: clamp(state.cursor + 1), playing: false };
    case "SEEK": {
      if (state.runId === null || !Number.isFinite(action.minute)) return state;
      const cursor = clamp(action.minute);
      return { ...state, cursor, playing: state.playing && cursor < state.endMinute };
    }
    case "SPEED": return (SPEEDS as readonly number[]).includes(action.speed) ? { ...state, speed: action.speed as Speed } : state;
    case "TICK": {
      // A tick scheduled for an earlier run, or after pause/reset, is dropped.
      if (action.runId !== state.runId || !state.playing) return state;
      const cursor = clamp(state.cursor + 1);
      return { ...state, cursor, playing: cursor < state.endMinute };
    }
    default: return state;
  }
}
