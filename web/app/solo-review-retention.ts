import { fearlessLocks, type DraftSide } from "./draft-agent";
import type { DraftSession } from "./draft-session";
import { basisKey, rosterBasis, ROSTER_ROLES } from "./roster-scenario";
import { SHARE_CHAMPIONS } from "./share-champion-ids";
import type { SoloDraftEvidence, SoloDraftExplainedChoice, SoloDraftExplanation, SoloDraftSuggestion } from "./solo-draft";
import { soloAutoContext, soloAutoRecordMatches, type SoloAutoRecord } from "./solo-draft-explanation";
import { soloHistoryContext, type SoloAutoHistory } from "./solo-draft-history";

/**
 * Stage-1 strict, pure codec for the local solo auto-choice review sidecar
 * (docs/LOCAL_REVIEW_RETENTION_DESIGN_2026-11-20.md). No storage, hashing or UI here: the caller supplies
 * the board's SHA-256 (exactly 64 lowercase hex) and owns all reads/writes.
 *
 * Anything parsed here is the user's own saved local practice notes. Local storage cannot prove who
 * produced it, so a valid parse is never authentic AI output or observed evidence. The SHA only binds
 * board equality, not who acted on it. A failure only means "drop the review"; board parsing is untouched.
 */
export const SOLO_REVIEW_SCHEMA = "solo-review-retention";
export const SOLO_REVIEW_VERSION = 1;
/** Bounds on the UTF-8 bytes of the whole serialized sidecar. */
export const MAX_SOLO_REVIEW_BYTES = 64 * 1024;
/** Per the design bound. A real board holds at most 10 opponent (non-manual) turns. */
export const MAX_SOLO_REVIEW_RECORDS = 20;
export const MAX_SOLO_REVIEW_ALTERNATIVES = 2;

export type SoloReviewSerializeFailure = "EMPTY" | "BAD_SHA" | "BAD_SIDE" | "BAD_RECORDS" | "TOO_LARGE";
export type SoloReviewSerializeResult = { ok: true; text: string } | { ok: false; reason: SoloReviewSerializeFailure };
export type SoloReviewParseFailure =
  | "NOT_TEXT" | "TOO_LARGE" | "INVALID_JSON" | "BAD_FORMAT" | "BAD_SHA" | "SHA_MISMATCH" | "BAD_SESSION"
  | "BAD_RECORDS" | "CONTEXT_MISMATCH" | "BOARD_MISMATCH" | "EXPLANATION_MISMATCH";
export type SoloReviewParseResult =
  | { ok: true; manualSide: DraftSide; records: SoloAutoHistory }
  | { ok: false; reason: SoloReviewParseFailure };

const SHA = /^[0-9a-f]{64}$/;
// Generator output is always canonical (solo-draft.ts `canonical`), so exact membership is required.
const CHAMPIONS = new Set(SHARE_CHAMPIONS.map(([, id]) => id));
const SIDES: readonly string[] = ["BLUE", "RED"];
const SOURCES: readonly string[] = ["TEAM_RECORD", "PLAYER_SEASON", "RADAR", "FALLBACK"];
const ROLES: readonly string[] = ROSTER_ROLES;
/** True when any UTF-16 unit is C0 (U+0000–U+001F) or DEL (U+007F). */
function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const MAX_TURN = 20;
const MAX_ID = 80; // same limit as the session parser's champion check
const ENVELOPE_KEYS = ["schema", "version", "scenario_sha256", "manual_side", "records"] as const;
const RECORD_KEYS = ["turn", "champion_id", "reason", "prefix", "context", "explanation"] as const;
const EXPLANATION_KEYS = ["turn", "kind", "side", "record_team", "record_scope", "season_evidence", "selected", "alternatives"] as const;
const BAN_CHOICE_KEYS = ["champion_id", "reason", "source", "inferred_roles", "evidence"] as const;
const PICK_CHOICE_KEYS = ["champion_id", "role_supported", "reason", "source", "inferred_roles", "evidence"] as const;

class Invalid extends Error {}
const invalid = (): never => { throw new Invalid(); };

/** Exact own enumerable data properties only (no getters, symbols, extra or missing keys, plain prototype). */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  if (Reflect.ownKeys(value).length !== keys.length) return invalid();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return invalid();
    out[key] = descriptor.value;
  }
  return out;
}

/** Dense plain array with data elements only, length <= max. */
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length > max || Reflect.ownKeys(value).length !== length + 1) return invalid();
  const out: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return invalid();
    out.push(descriptor.value);
  }
  return out;
}

const text = (value: unknown): string => typeof value === "string" && value.length > 0 && !hasControl(value) ? value : invalid();
const champion = (value: unknown): string => typeof value === "string" && CHAMPIONS.has(value) ? value : invalid();
const bool = (value: unknown): boolean => typeof value === "boolean" ? value : invalid();
const oneOf = <T extends string>(value: unknown, allowed: readonly string[]): T => typeof value === "string" && allowed.includes(value) ? value as T : invalid();
const turnOf = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TURN ? value as number : invalid();

/** Source/evidence pairs exactly as `evidenceOf` in solo-draft.ts can produce them. */
function evidenceFits(kind: "BAN" | "PICK", source: SoloDraftSuggestion["source"], evidence: SoloDraftEvidence): boolean {
  if (source === "FALLBACK") return evidence === "FALLBACK";
  if (source === "PLAYER_SEASON") return kind === "PICK" && evidence === "PLAYER_SEASON";
  if (source === "RADAR") return evidence === "RADAR_META" || evidence === "RADAR_FRAME";
  // BAN team-record candidates always come from the opposing team's priority ids.
  return kind === "BAN" ? evidence === "TEAM_PRIORITY" : evidence === "TEAM_PRIORITY" || evidence === "PLAYER_CURRENT";
}

function readChoice(value: unknown, kind: "BAN" | "PICK"): SoloDraftExplainedChoice {
  const o = exact(value, kind === "PICK" ? PICK_CHOICE_KEYS : BAN_CHOICE_KEYS);
  const champion_id = champion(o.champion_id);
  const reason = text(o.reason);
  const source = oneOf<SoloDraftSuggestion["source"]>(o.source, SOURCES);
  const evidence = oneOf<SoloDraftEvidence>(o.evidence, ["TEAM_PRIORITY", "PLAYER_CURRENT", "PLAYER_SEASON", "RADAR_META", "RADAR_FRAME", "FALLBACK"]);
  if (!evidenceFits(kind, source, evidence)) invalid();
  const roles = list(o.inferred_roles, ROLES.length).map(role => oneOf<string>(role, ROLES));
  if (new Set(roles).size !== roles.length || (kind === "BAN" && roles.length)) invalid();
  return kind === "PICK"
    ? { champion_id, role_supported: bool(o.role_supported), reason, source, inferred_roles: roles, evidence }
    : { champion_id, reason, source, inferred_roles: roles, evidence };
}

function readExplanation(value: unknown): SoloDraftExplanation {
  const o = exact(value, EXPLANATION_KEYS);
  const kind = oneOf<"BAN" | "PICK">(o.kind, ["BAN", "PICK"]);
  const record_scope = oneOf<SoloDraftExplanation["record_scope"]>(o.record_scope, ["OPPOSING_TEAM", "ACTING_TEAM"]);
  if (record_scope !== (kind === "BAN" ? "OPPOSING_TEAM" : "ACTING_TEAM")) invalid();
  const selected = readChoice(o.selected, kind);
  const alternatives = list(o.alternatives, MAX_SOLO_REVIEW_ALTERNATIVES).map(choice => readChoice(choice, kind));
  const all = [selected, ...alternatives];
  if (new Set(all.map(choice => choice.champion_id)).size !== all.length) invalid();
  const season_evidence = bool(o.season_evidence);
  if (!season_evidence && all.some(choice => choice.evidence === "PLAYER_SEASON")) invalid();
  return { turn: turnOf(o.turn), kind, side: oneOf<DraftSide>(o.side, SIDES), record_team: text(o.record_team), record_scope, season_evidence, selected, alternatives };
}

/** Structural record check (no board): exact shape, enums, internal consistency. Returns a fresh copy. */
function readRecord(value: unknown): SoloAutoRecord {
  const o = exact(value, RECORD_KEYS);
  const turn = turnOf(o.turn);
  const champion_id = champion(o.champion_id);
  const reason = text(o.reason);
  const prefix = list(o.prefix, MAX_TURN - 1).map(id => typeof id === "string" && id.length > 0 && id.length <= MAX_ID ? id : invalid());
  if (prefix.length !== turn - 1) invalid();
  // Nested serialized JSON whose length grows with Fearless locks/basis; no fixed cap here.
  // parse requires exact equality with the context derived from the session (bounded by the board itself).
  const context = typeof o.context === "string" && o.context.length > 0 ? o.context : invalid();
  const explanation = o.explanation === null ? null : readExplanation(o.explanation);
  // Draft-lab keeps an explanation only for the same turn and champion; its selected reason is the record reason.
  if (explanation && (explanation.turn !== turn || explanation.selected.champion_id !== champion_id || explanation.selected.reason !== reason)) invalid();
  return { turn, champion_id, reason, prefix, context, explanation };
}

/** Sorted unique increasing turns, one context, and each earlier entry sits on every later entry's prefix. */
function consistent(records: readonly SoloAutoRecord[]): boolean {
  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    if (records[index - 1].turn >= record.turn) return false;
    for (const entry of records.slice(0, index)) {
      if (entry.context !== record.context || record.prefix[entry.turn - 1] !== entry.champion_id ||
        !entry.prefix.every((id, at) => record.prefix[at] === id)) return false;
    }
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/**
 * Build the sidecar text for the current review. `{ok:false, reason:"EMPTY"}` means "no sidecar"
 * (the caller deletes it). Records are copied in canonical key order from validated values; the input
 * is never mutated or stringified directly. No board check is possible here; parse does it.
 */
export function serializeSoloReview(scenarioSha: unknown, manualSide: unknown, records: unknown): SoloReviewSerializeResult {
  try {
    if (typeof scenarioSha !== "string" || !SHA.test(scenarioSha)) return { ok: false, reason: "BAD_SHA" };
    if (manualSide !== "BLUE" && manualSide !== "RED") return { ok: false, reason: "BAD_SIDE" };
    let items: unknown[];
    try { items = list(records, MAX_SOLO_REVIEW_RECORDS); } catch { return { ok: false, reason: "BAD_RECORDS" }; }
    if (!items.length) return { ok: false, reason: "EMPTY" };
    const copies = items.map(readRecord);
    if (!consistent(copies)) return { ok: false, reason: "BAD_RECORDS" };
    const textOut = JSON.stringify({ schema: SOLO_REVIEW_SCHEMA, version: SOLO_REVIEW_VERSION, scenario_sha256: scenarioSha, manual_side: manualSide, records: copies });
    return utf8Bytes(textOut) > MAX_SOLO_REVIEW_BYTES ? { ok: false, reason: "TOO_LARGE" } : { ok: true, text: textOut };
  } catch {
    return { ok: false, reason: "BAD_RECORDS" };
  }
}

/**
 * Parse an untrusted sidecar against the already-parsed board session and the caller's SHA-256 of the
 * board text. Every entry must match the restored board (context from session teams/first pick/Fearless
 * locks + saved manual side + rosterBasis(session.report); prefix and chosen turn via soloAutoRecordMatches),
 * be an opponent (non-manual) turn, and an explanation must match that turn's kind/side/record team.
 * Returns fresh deep-frozen records. Never reruns suggest/explain.
 */
export function parseSoloReview(input: unknown, session: DraftSession, scenarioSha: unknown): SoloReviewParseResult {
  const fail = (reason: SoloReviewParseFailure): SoloReviewParseResult => ({ ok: false, reason });
  try {
    if (typeof scenarioSha !== "string" || !SHA.test(scenarioSha)) return fail("BAD_SHA");
    if (typeof input !== "string") return fail("NOT_TEXT");
    // Each UTF-16 unit is at least one UTF-8 byte, so this cheap check never rejects a valid size.
    if (input.length > MAX_SOLO_REVIEW_BYTES || utf8Bytes(input) > MAX_SOLO_REVIEW_BYTES) return fail("TOO_LARGE");
    let value: unknown;
    try { value = JSON.parse(input); } catch { return fail("INVALID_JSON"); }
    let envelope: Record<string, unknown>;
    try { envelope = exact(value, ENVELOPE_KEYS); } catch { return fail("BAD_FORMAT"); }
    if (envelope.schema !== SOLO_REVIEW_SCHEMA || envelope.version !== SOLO_REVIEW_VERSION ||
      typeof envelope.scenario_sha256 !== "string" || !SHA.test(envelope.scenario_sha256) ||
      (envelope.manual_side !== "BLUE" && envelope.manual_side !== "RED")) return fail("BAD_FORMAT");
    if (envelope.scenario_sha256 !== scenarioSha) return fail("SHA_MISMATCH");
    const manualSide = envelope.manual_side;

    let records: SoloAutoRecord[];
    try {
      const items = list(envelope.records, MAX_SOLO_REVIEW_RECORDS);
      if (!items.length) return fail("BAD_RECORDS"); // empty review is "no sidecar", never stored
      records = items.map(readRecord);
    } catch { return fail("BAD_RECORDS"); }
    if (!consistent(records)) return fail("BAD_RECORDS");

    const teams = session?.report?.opponent_prep?.teams;
    const blue = Array.isArray(teams) ? teams.find(team => team.team_id === session.blueTeamId) : undefined;
    const red = Array.isArray(teams) ? teams.find(team => team.team_id === session.redTeamId) : undefined;
    if (!blue || !red || blue === red || !Array.isArray(session.selections) || !Array.isArray(session.games) || !SIDES.includes(session.firstPickSide)) return fail("BAD_SESSION");
    // Same derivation draft-lab uses when it records an auto choice (previousPicks = fearlessLocks(games)).
    const context = soloHistoryContext(
      soloAutoContext(session.blueTeamId, session.redTeamId, session.firstPickSide, manualSide, fearlessLocks(session.games)),
      basisKey(rosterBasis(session.report)));

    for (const record of records) {
      if (record.context !== context) return fail("CONTEXT_MISMATCH");
      if (!soloAutoRecordMatches(record, session.selections, context)) return fail("BOARD_MISMATCH");
      const chosen = session.selections[record.turn - 1];
      if (chosen.side === manualSide) return fail("BOARD_MISMATCH");
      const e = record.explanation;
      if (!e) continue;
      const acting = chosen.side === "BLUE" ? blue : red, opposing = chosen.side === "BLUE" ? red : blue;
      const target = e.kind === "BAN" ? opposing : acting;
      if (e.kind !== chosen.kind || e.side !== chosen.side || e.record_team !== (target.team_name || target.team_id)) return fail("EXPLANATION_MISMATCH");
    }
    return { ok: true, manualSide, records: deepFreeze(records) };
  } catch {
    return fail("BAD_RECORDS");
  }
}
