/**
 * Experimental manager model. Coefficients below are authored rules, not fitted LoL effects.
 * Inputs are explicit user assumptions; champion/player names must never silently set them.
 * Gold is cumulative model resource, objectives abstract progress, not a patch-accurate replay.
 */
export const SIMULATION_RULESET = "assumption-manager-v1";
export const SIMULATION_MAX_MINUTES = 45;
export const MAX_SIMULATION_FILE_BYTES = 64 * 1024;
export type ManagerAssumptions = { lane: number; tempo: number; teamfight: number };
export type ManagerTeam = { id: string; assumptions: ManagerAssumptions };
export type ManagerInput = {
  ruleset: typeof SIMULATION_RULESET;
  seed: number;
  teams: [ManagerTeam, ManagerTeam];
};
export type ManagerState = { gold: number; kills: number; objectives: number; base: number };
export type ManagerEvent = {
  minute: number;
  kind: "GROWTH" | "SKIRMISH" | "OBJECTIVE" | "BASE" | "END";
  actor: string;
  /** Value added to the actor, except BASE which is damage applied to the opponent. */
  amount: number;
};
export type ManagerResult = {
  ruleset: typeof SIMULATION_RULESET;
  input: ManagerInput;
  winner: string;
  reason: "BASE_DESTROYED" | "TIME_LIMIT";
  minute: number;
  states: Record<string, ManagerState>;
  events: ManagerEvent[];
  boundary: string;
};

const fields = ["lane", "tempo", "teamfight"] as const;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** Reject mixed or unsupported semantics rather than accepting hidden champion-derived effects. */
export function isManagerInput(value: unknown): value is ManagerInput {
  if (!object(value) || !exact(value, ["ruleset", "seed", "teams"]) || value.ruleset !== SIMULATION_RULESET ||
    !Number.isSafeInteger(value.seed) || (value.seed as number) < 0 || (value.seed as number) > 0xffffffff ||
    !Array.isArray(value.teams) || value.teams.length !== 2) return false;
  const validTeam = (team: unknown) => {
    if (!object(team) || !exact(team, ["id", "assumptions"]) ||
      typeof team.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(team.id) || !object(team.assumptions)) return false;
    const assumptions = team.assumptions;
    return exact(assumptions, fields) && fields.every(field => typeof assumptions[field] === "number" &&
      Number.isFinite(assumptions[field]) && Math.abs(assumptions[field] as number) <= 1);
  };
  const valid = validTeam(value.teams[0]) && validTeam(value.teams[1]);
  return valid && value.teams[0].id !== value.teams[1].id;
}

/** A stable ID stream keeps results invariant to presentation-side exchange. */
function stream(seed: number, id: string) {
  let state = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) state = Math.imul(state ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateManager(input: ManagerInput): ManagerResult {
  if (!isManagerInput(input)) throw new Error("Unsupported manager input or assumption outside [-1, 1].");
  const detached: ManagerInput = { ruleset: SIMULATION_RULESET, seed: input.seed,
    teams: input.teams.map(t => ({ id: t.id, assumptions: { ...t.assumptions } })) as [ManagerTeam, ManagerTeam] };
  // Canonical order prevents object/array presentation order becoming a game advantage.
  const teams = [...detached.teams].sort((a, b) => a.id < b.id ? -1 : 1);
  const [a, b] = teams;
  const random = new Map(teams.map(t => [t.id, stream(input.seed, t.id)]));
  const states: Record<string, ManagerState> = Object.fromEntries(teams.map(t => [t.id, { gold: 2500, kills: 0, objectives: 0, base: 100 }]));
  const events: ManagerEvent[] = [];
  let winner = "";
  let minute = 0;
  let reason: ManagerResult["reason"] = "TIME_LIMIT";
  for (minute = 1; minute <= SIMULATION_MAX_MINUTES; minute++) {
    for (const team of teams) {
      const amount = Math.round(1500 + 180 * team.assumptions.lane + 90 * team.assumptions.tempo + random.get(team.id)!() * 180);
      states[team.id].gold += amount;
      events.push({ minute, kind: "GROWTH", actor: team.id, amount });
    }
    if (minute < 4 || minute % 3 !== 0) continue;
    const power = (team: ManagerTeam) => states[team.id].gold / 15000 +
      team.assumptions.teamfight * 0.7 + team.assumptions.tempo * 0.3 + random.get(team.id)!() * 1.4;
    const victor = power(a) >= power(b) ? a : b;
    const loser = victor === a ? b : a;
    const kills = 1 + Math.floor(random.get(victor.id)!() * 3);
    states[victor.id].kills += kills;
    states[victor.id].gold += kills * 300;
    events.push({ minute, kind: "SKIRMISH", actor: victor.id, amount: kills });
    states[victor.id].objectives += 1;
    states[victor.id].gold += 600;
    events.push({ minute, kind: "OBJECTIVE", actor: victor.id, amount: 1 });
    if (minute >= 18 && states[victor.id].objectives >= 3) {
      const damage = Math.min(states[loser.id].base, 12 + Math.floor(random.get(victor.id)!() * 12));
      states[loser.id].base -= damage;
      events.push({ minute, kind: "BASE", actor: victor.id, amount: damage });
      if (states[loser.id].base === 0) { winner = victor.id; reason = "BASE_DESTROYED"; break; }
    }
  }
  if (!winner) {
    minute = SIMULATION_MAX_MINUTES;
    const score = (team: ManagerTeam) => states[team.id].base * 1000 + states[team.id].gold;
    winner = score(a) >= score(b) ? a.id : b.id;
  }
  events.push({ minute, kind: "END", actor: winner, amount: 0 });
  return { ruleset: SIMULATION_RULESET, input: detached, winner, reason, minute, states, events,
    boundary: "Experimental results from explicit user assumptions and authored abstract rules. Not learned player/champion effects, a patch-accurate LoL replay, or real win probability." };
}

export type ManagerReplay = { ok: true; result: ManagerResult } | { ok: false; error: string };

/** Recompute rather than trusting a saved winner or event trace. This is integrity, not accuracy. */
export function replayManagerFile(text: string): ManagerReplay {
  if (new TextEncoder().encode(text).byteLength > MAX_SIMULATION_FILE_BYTES) return { ok: false, error: "시뮬레이션 파일은 64KB 이하여야 합니다." };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: "JSON 파일을 읽을 수 없습니다." }; }
  if (!object(value) || !exact(value, ["artifact_type", "schema_version", "result"]) ||
    value.artifact_type !== "assumption-manager-run" || value.schema_version !== 1 || !object(value.result) ||
    !isManagerInput(value.result.input)) return { ok: false, error: "지원하는 가정 기반 시뮬레이션 파일이 아닙니다." };
  const result = simulateManager(value.result.input);
  // Field order is not meaningful JSON semantics; every field and nested result must still match.
  const matches = (expected: unknown, actual: unknown): boolean => {
    if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length &&
      expected.every((item, index) => matches(item, actual[index]));
    if (object(expected)) return object(actual) && exact(actual, Object.keys(expected)) &&
      Object.keys(expected).every(key => matches(expected[key], actual[key]));
    return expected === actual;
  };
  if (!matches(result, value.result)) return { ok: false, error: "기록된 결과가 입력·시드·규칙으로 재계산한 결과와 다릅니다." };
  return { ok: true, result };
}

export function serializeManagerRun(input: ManagerInput): string {
  return JSON.stringify({ artifact_type: "assumption-manager-run", schema_version: 1, result: simulateManager(input) }, null, 2);
}
