import { SIMULATION_RULESET } from "./simulation-core";
import type { SimulationInputSnapshot } from "./simulation-scenario";
import {
  ASSUMPTION_FIELDS,
  CORE_TEAM_IDS,
  isTrustedRun,
  parseAssumption,
  parseSeed,
  sourceTeamOrder,
  type AssumptionDraft,
  type AssumptionField,
} from "./experiment-replay";

/**
 * Assumption-only link (`#experiment=`), schema experiment-assumptions v1.
 *
 * Carries only ruleset, patch, the two sorted public source team IDs, the seed and each team's three
 * numeric assumptions of a completed in-page run. It never carries bans/picks, players, roster, roles,
 * evidence, observations, results, win rates or the run itself. There is no signature: the numbers are
 * user-editable, so a link does not prove integrity or origin. Malformed or tampered *structure* is
 * refused; a valid number edited by hand cannot be (and is not claimed to be) detected.
 * Applying a link only fills the two teams' assumption/seed inputs; the user runs the model again.
 */

export const EXPERIMENT_LINK_SCHEMA = "experiment-assumptions";
export const EXPERIMENT_LINK_VERSION = 1;
export const EXPERIMENT_LINK_PREFIX = "#experiment=";
export const MAX_EXPERIMENT_LINK_URL = 4_000;
export const MAX_EXPERIMENT_LINK_BYTES = 1_500;
export const MAX_EXPERIMENT_LINK_ID = 128;
export const MAX_EXPERIMENT_LINK_PATCH = 64;
export const EXPERIMENT_LINK_SCOPE = "밴픽·선수·역할·분석자료·실험원본은 포함하지 않습니다. 받은 쪽에서 입력 준비 후 가정값만 적용하고 직접 실행해야 합니다.";

const TOP_KEYS = ["schema", "version", "ruleset", "patch", "seed", "teams"] as const;
const TEAM_KEYS = ["id", ...ASSUMPTION_FIELDS] as const;

export type LinkTeam = { id: string } & Record<AssumptionField, number>;
export type ExperimentInputLink = {
  schema: typeof EXPERIMENT_LINK_SCHEMA;
  version: typeof EXPERIMENT_LINK_VERSION;
  ruleset: typeof SIMULATION_RULESET;
  patch: string;
  seed: number;
  /** Sorted by code unit, distinct: [team_a source, team_b source]. */
  teams: [LinkTeam, LinkTeam];
};

export type LinkRefusal =
  | "NOT_TRUSTED" | "NOT_COMPLETE" | "UNSAFE_ORIGIN" | "BAD_URL" | "NO_LINK" | "TOO_LONG" | "TOO_LARGE"
  | "BAD_ENCODING" | "BAD_SHAPE" | "BAD_VERSION" | "BAD_RULESET" | "BAD_TEAMS" | "BAD_VALUE" | "ROUNDTRIP";

export type CreateLinkResult = { ok: true; url: string; link: ExperimentInputLink } | { ok: false; reason: LinkRefusal };
export type ParseLinkResult = { ok: true; link: ExperimentInputLink; encoded: string } | { ok: false; reason: LinkRefusal };

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_EXPERIMENT_LINK_ID && value.trim() === value;
const validAssumption = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
const validSeed = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;

/** Validate a decoded JSON value: exact keys, types, ranges, two distinct sorted teams. */
export function validateLinkData(data: unknown): { ok: true; link: ExperimentInputLink } | { ok: false; reason: LinkRefusal } {
  if (!hasExactKeys(data, TOP_KEYS)) return { ok: false, reason: "BAD_SHAPE" };
  if (data.schema !== EXPERIMENT_LINK_SCHEMA || data.version !== EXPERIMENT_LINK_VERSION) return { ok: false, reason: "BAD_VERSION" };
  if (data.ruleset !== SIMULATION_RULESET) return { ok: false, reason: "BAD_RULESET" };
  if (typeof data.patch !== "string" || !data.patch || data.patch.length > MAX_EXPERIMENT_LINK_PATCH) return { ok: false, reason: "BAD_SHAPE" };
  if (!validSeed(data.seed)) return { ok: false, reason: "BAD_VALUE" };
  const teams = data.teams;
  if (!Array.isArray(teams) || teams.length !== 2 || Object.keys(teams).length !== 2) return { ok: false, reason: "BAD_TEAMS" };
  const out: LinkTeam[] = [];
  for (const team of teams) {
    if (!hasExactKeys(team, TEAM_KEYS) || !validId(team.id)) return { ok: false, reason: "BAD_TEAMS" };
    const values = {} as Record<AssumptionField, number>;
    for (const field of ASSUMPTION_FIELDS) {
      const value = team[field];
      if (!validAssumption(value)) return { ok: false, reason: "BAD_VALUE" };
      values[field] = value === 0 ? 0 : value; // -0 → 0: same number identity as parseAssumption
    }
    out.push({ id: team.id as string, ...values });
  }
  if (!(out[0].id < out[1].id)) return { ok: false, reason: "BAD_TEAMS" }; // distinct and sorted
  return { ok: true, link: { schema: EXPERIMENT_LINK_SCHEMA, version: EXPERIMENT_LINK_VERSION, ruleset: SIMULATION_RULESET, patch: data.patch as string, seed: data.seed as number, teams: [out[0], out[1]] } };
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

function safeOrigin(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}

/**
 * Link from a trusted, completed in-page run only (shown at its end). Values come from the run's frozen
 * input, never from the current input fields. The created URL is parsed back and must match the run.
 */
export function createExperimentInputLink(href: string, run: unknown, shownMinute: number): CreateLinkResult {
  if (!isTrustedRun(run)) return { ok: false, reason: "NOT_TRUSTED" };
  if (!Number.isFinite(shownMinute) || shownMinute < run.endMinute || run.result.events.at(-1)?.kind !== "END") return { ok: false, reason: "NOT_COMPLETE" };
  let url: URL;
  try { url = new URL(href); } catch { return { ok: false, reason: "BAD_URL" }; }
  if (!safeOrigin(url)) return { ok: false, reason: "UNSAFE_ORIGIN" };
  const teams = CORE_TEAM_IDS.map((core) => {
    const team = run.teams[core];
    return { id: team.sourceId, lane: team.assumptions.lane, tempo: team.assumptions.tempo, teamfight: team.assumptions.teamfight };
  });
  const data = { schema: EXPERIMENT_LINK_SCHEMA, version: EXPERIMENT_LINK_VERSION, ruleset: run.input.ruleset, patch: run.snapshot.patch, seed: run.seed, teams };
  const checked = validateLinkData(data);
  if (!checked.ok) return checked;
  const bytes = new TextEncoder().encode(JSON.stringify(checked.link));
  if (bytes.length > MAX_EXPERIMENT_LINK_BYTES) return { ok: false, reason: "TOO_LARGE" };
  url.search = "";
  url.hash = EXPERIMENT_LINK_PREFIX.slice(1) + toBase64Url(bytes);
  if (url.href.length > MAX_EXPERIMENT_LINK_URL) return { ok: false, reason: "TOO_LONG" };
  const back = parseExperimentInputLink(url.href);
  if (!back.ok || !sameLink(back.link, checked.link)) return { ok: false, reason: "ROUNDTRIP" };
  return { ok: true, url: url.href, link: checked.link };
}

export function sameLink(a: ExperimentInputLink, b: ExperimentInputLink): boolean {
  return a.schema === b.schema && a.version === b.version && a.ruleset === b.ruleset && a.patch === b.patch && a.seed === b.seed &&
    a.teams.every((team, i) => team.id === b.teams[i].id && ASSUMPTION_FIELDS.every((field) => team[field] === b.teams[i][field]));
}

/** Reads only this address's own `#experiment=` fragment. Any other hash (e.g. `#draft=`) → NO_LINK. */
export function parseExperimentInputLink(href: string): ParseLinkResult {
  if (typeof href !== "string") return { ok: false, reason: "BAD_URL" };
  if (href.length > MAX_EXPERIMENT_LINK_URL) return { ok: false, reason: "TOO_LONG" };
  let hash: string;
  try { hash = new URL(href).hash; } catch { return { ok: false, reason: "BAD_URL" }; }
  if (!hash.startsWith(EXPERIMENT_LINK_PREFIX)) return { ok: false, reason: "NO_LINK" };
  const encoded = hash.slice(EXPERIMENT_LINK_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return { ok: false, reason: "BAD_ENCODING" };
  if (Math.floor(encoded.length * 3 / 4) > MAX_EXPERIMENT_LINK_BYTES) return { ok: false, reason: "TOO_LARGE" };
  let data: unknown;
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    // Canonical unpadded base64url only: re-encoding must give the exact same text.
    if (btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== encoded) return { ok: false, reason: "BAD_ENCODING" };
    if (binary.length > MAX_EXPERIMENT_LINK_BYTES) return { ok: false, reason: "TOO_LARGE" };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    data = JSON.parse(text);
  } catch { return { ok: false, reason: "BAD_ENCODING" }; }
  const checked = validateLinkData(data);
  return checked.ok ? { ok: true, link: checked.link, encoded } : checked;
}

/**
 * Lossless plain decimal text of a finite number (no exponent), accepted by `parseAssumption`.
 * `String(x)` is the shortest round-trip form; its exponent form is expanded digit-for-digit, so the
 * decimal value is unchanged (no rounding, no clamp). -0 → "0".
 */
export function plainDecimal(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return "0";
  const text = String(value);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-])(\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, lead, rest = "", expSign, expDigits] = match;
  const digits = lead + rest;
  const exp = Number(expDigits);
  const plain = expSign === "-"
    ? `0.${"0".repeat(exp - 1)}${digits}`
    : digits.length - 1 <= exp ? digits + "0".repeat(exp - (digits.length - 1)) : `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  const out = sign + plain;
  return Number(out) === value ? out : null;
}

export type GateRefusal = "NO_READY_INPUT" | "BLOCKED" | "PATCH_MISMATCH" | "TEAM_MISMATCH" | "BAD_VALUE";
export type ApplyPlan = { ok: true; seedText: string; drafts: Record<string, AssumptionDraft>; teamIds: [string, string] } | { ok: false; reason: GateRefusal };

/**
 * Whether a parsed link may be applied to the current ready input. Teams are matched by source ID,
 * never by side, so a side swap maps correctly. Nothing is filled in when the input is not ready.
 * The resulting texts are checked with the existing strict parsers and must give the same numbers.
 */
export function planExperimentLinkApply(link: ExperimentInputLink, readyInput: SimulationInputSnapshot | null, blocked: boolean): ApplyPlan {
  if (blocked) return { ok: false, reason: "BLOCKED" };
  if (!readyInput) return { ok: false, reason: "NO_READY_INPUT" };
  if (readyInput.patch !== link.patch) return { ok: false, reason: "PATCH_MISMATCH" };
  const order = sourceTeamOrder(readyInput);
  if (!order || order[0] !== link.teams[0].id || order[1] !== link.teams[1].id) return { ok: false, reason: "TEAM_MISMATCH" };
  const seedText = String(link.seed);
  const seed = parseSeed(seedText);
  if (!seed.ok || seed.value !== link.seed) return { ok: false, reason: "BAD_VALUE" };
  const drafts: Record<string, AssumptionDraft> = {};
  for (const team of link.teams) {
    const draft = {} as AssumptionDraft;
    for (const field of ASSUMPTION_FIELDS) {
      const text = plainDecimal(team[field]);
      const parsed = text === null ? null : parseAssumption(text);
      if (text === null || !parsed || !parsed.ok || parsed.value !== team[field]) return { ok: false, reason: "BAD_VALUE" };
      draft[field] = text;
    }
    drafts[team.id] = draft;
  }
  return { ok: true, seedText, drafts, teamIds: [link.teams[0].id, link.teams[1].id] };
}
