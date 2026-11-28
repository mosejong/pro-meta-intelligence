import { evidenceIdentityOf } from "./draft-comparison";
import { isRadarReport, type RadarReport } from "./radar-types";
import { captureRoster } from "./roster-comparison";
import { ROSTER_ROLES, rosterBasis, type RosterRole, type RosterState } from "./roster-scenario";
import {
  emptySeasonSlots, isCardHash, parseSeasonCardCatalog, resolveSeasonRef, validateSeasonLineup, verifySeasonCardIntegrity,
  type SeasonCardCatalog, type TeamSeasonSlots,
} from "./season-player-cards";

/**
 * Roster observation context: a pure reference record that freezes which CURRENT report players
 * and which SEASON catalog cards fill each of the ten roles, plus both source clocks and digests.
 *
 * It holds no names, statistics, champions, abilities, effects or outcomes, and nothing in it is a
 * forecast, rating or win rate. It is never an assumption-experiment or simulation input (the A/B
 * codec, fixed baseline A and the experiment input are untouched). Its only storage is the optional
 * `observation` part of a practice bundle v3, which is structural on read and always re-verified
 * here against the saved report and the loaded catalog before it is used again.
 *
 * `analysis_as_of` is the explicit preparation instant captured by the caller at the click; both
 * original cutoffs must not be later than it (compared at nanosecond precision, not `Date.parse`).
 * The original cutoffs are kept verbatim and never restamped.
 */

export const OBSERVATION_CONTEXT_ARTIFACT = "roster-observation-context";
export const OBSERVATION_CONTEXT_SCHEMA = 1;
export const OBSERVATION_CONTEXT_PURPOSE = "OBSERVATION_CONTEXT_ONLY";
export const MAX_OBSERVATION_CONTEXT_BYTES = 16 * 1024;

export type ObservationSlot =
  | { kind: "CURRENT"; source_team_id: string; player_id: string }
  | { kind: "SEASON"; card_id: string; player_id: string };
export type ObservationTeamSlots = Record<RosterRole, ObservationSlot>;
export type RosterObservationContext = {
  artifact_type: typeof OBSERVATION_CONTEXT_ARTIFACT;
  schema_version: typeof OBSERVATION_CONTEXT_SCHEMA;
  purpose: typeof OBSERVATION_CONTEXT_PURPOSE;
  analysis_as_of: string;
  report_cutoff: string;
  /** SHA-256 of the existing A/B evidence identity of the report (`evidenceIdentityOf`); the identity itself is never stored. */
  report_evidence_digest: string;
  catalog_id: string;
  catalog_cutoff: string;
  /**
   * SHA-256 of the full parsed, integrity-verified catalog (sorted-key JSON): seasons and their
   * statuses, source receipts (`retrieved_at`, content hashes) and cards. `catalog_id` hashes the
   * cards only, so it cannot freeze availability metadata on its own. This is not a raw-file hash,
   * a signature or a source attestation.
   */
  catalog_provenance_digest: string;
  team_ids: [string, string];
  teams: Record<string, ObservationTeamSlots>;
  context_key: string;
};
export type ObservationContextReason =
  | "INPUT_INVALID" | "REPORT_INVALID" | "CATALOG_MISSING" | "CATALOG_INVALID" | "CATALOG_TAMPERED" | "CRYPTO_UNAVAILABLE"
  | "TIME_INVALID" | "CUTOFF_AFTER_AS_OF" | "TEAM_INVALID" | "SLOT_INVALID" | "CURRENT_INVALID" | "CARD_NOT_FOUND"
  | "SEASON_NOT_LOADED" | "DUPLICATE_PLAYER" | "NO_SEASON_SLOT" | "TOO_LARGE" | "FORMAT_INVALID"
  | "REPORT_CHANGED" | "CATALOG_CHANGED" | "CONTEXT_KEY_MISMATCH";
export type ObservationFailure = { ok: false; reason: ObservationContextReason; message: string };
export type ObservationContextResult = { ok: true; context: RosterObservationContext } | ObservationFailure;
export type ObservationContextInput = { report: unknown; catalog: unknown; analysis_as_of: unknown; teams: unknown };

const TOP_KEYS = ["artifact_type", "schema_version", "purpose", "analysis_as_of", "report_cutoff", "report_evidence_digest",
  "catalog_id", "catalog_cutoff", "catalog_provenance_digest", "team_ids", "teams", "context_key"] as const;
const CURRENT_KEYS = ["kind", "source_team_id", "player_id"] as const;
const SEASON_KEYS = ["kind", "card_id", "player_id"] as const;

const refuse = (reason: ObservationContextReason, message: string): ObservationFailure => ({ ok: false, reason, message });
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const idText = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 256;
const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
/** Sorted-key JSON text (the same canonical form the season catalog integrity check uses). */
export const canonicalText = (x: unknown) => JSON.stringify(canonical(x));
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const define = <T>(target: Record<string, T>, key: string, value: T) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}

export async function sha256Hex(text: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("CRYPTO_UNAVAILABLE");
  return Array.from(new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
}

/** Digest of a report's existing evidence identity (same value stored as `report_evidence_digest`). */
export const reportEvidenceDigest = (report: RadarReport) => sha256Hex(evidenceIdentityOf(report));

/** Timezone-aware ISO instant with up to 9 fractional digits; compared at nanosecond precision. */
type Instant = { seconds: number; nanos: number };
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
function instant(value: unknown): Instant | null {
  if (typeof value !== "string") return null;
  const m = INSTANT.exec(value);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]), s = Number(m[6]);
  if (mo < 1 || mo > 12 || d < 1 || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  let offset = 0;
  if (m[8] !== "Z") {
    const oh = Number(m[10]), om = Number(m[11]);
    if (oh > 23 || om > 59) return null;
    offset = (m[9] === "-" ? -1 : 1) * (oh * 60 + om) * 60;
  }
  const seconds = Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - offset;
  return Number.isFinite(seconds) ? { seconds, nanos: Number((m[7] ?? "").padEnd(9, "0")) } : null;
}
const compare = (a: Instant, b: Instant) => a.seconds - b.seconds || a.nanos - b.nanos;
function normalizedUtc(t: Instant) {
  const base = new Date(t.seconds * 1000).toISOString().slice(0, 19);
  const fraction = t.nanos ? `.${String(t.nanos).padStart(9, "0").replace(/0+$/, "")}` : "";
  return `${base}${fraction}Z`;
}
/** Nanosecond-precision comparison of two ISO instants; null when either is not a valid zoned instant. */
export function compareInstants(a: unknown, b: unknown): number | null {
  const left = instant(a), right = instant(b);
  return left && right ? Math.sign(compare(left, right)) : null;
}

function parseSlot(raw: unknown): ObservationSlot | null {
  if (!object(raw)) return null;
  if (raw.kind === "CURRENT" && exact(raw, CURRENT_KEYS) && idText(raw.source_team_id) && idText(raw.player_id)) {
    return { kind: "CURRENT", source_team_id: raw.source_team_id, player_id: raw.player_id };
  }
  if (raw.kind === "SEASON" && exact(raw, SEASON_KEYS) && isCardHash(raw.card_id) && idText(raw.player_id)) {
    return { kind: "SEASON", card_id: raw.card_id, player_id: raw.player_id };
  }
  return null;
}

type Prepared = {
  report: RadarReport; catalog: SeasonCardCatalog; identity: string; asOf: string;
  teamIds: [string, string]; teams: Record<string, ObservationTeamSlots>;
};

/** Synchronous part: detach every input before any await, then validate shape, clocks, teams and slots. */
function prepare(input: ObservationContextInput): Prepared | ObservationFailure {
  let report: unknown, rawCatalog: unknown, rawTeams: unknown;
  try { report = structuredClone(input.report); rawCatalog = structuredClone(input.catalog); rawTeams = structuredClone(input.teams); }
  catch { return refuse("INPUT_INVALID", "입력을 복사할 수 없습니다."); }
  if (!isRadarReport(report) || !report.opponent_prep || typeof report.cutoff !== "string") return refuse("REPORT_INVALID", "현재 분석 데이터가 없거나 손상되었습니다.");
  if (rawCatalog === null || rawCatalog === undefined) return refuse("CATALOG_MISSING", "시즌 선수 자료가 없습니다.");
  let catalog: SeasonCardCatalog;
  try { catalog = parseSeasonCardCatalog(rawCatalog); } catch { return refuse("CATALOG_INVALID", "시즌 선수 자료의 형식이나 출처를 확인하지 못했습니다."); }
  const asOf = instant(input.analysis_as_of), reportCutoff = instant(report.cutoff), catalogCutoff = instant(catalog.cutoff);
  if (!asOf || !reportCutoff || !catalogCutoff) return refuse("TIME_INVALID", "시각은 시간대가 있는 ISO 형식이어야 합니다.");
  if (compare(reportCutoff, asOf) > 0 || compare(catalogCutoff, asOf) > 0) return refuse("CUTOFF_AFTER_AS_OF", "준비 시각이 분석 데이터 또는 시즌 자료의 기준 시점보다 이릅니다.");

  if (!object(rawTeams)) return refuse("TEAM_INVALID", "두 팀의 슬롯이 필요합니다.");
  const teamIds = Object.keys(rawTeams).sort() as [string, string];
  const known = new Set(report.opponent_prep.teams.map(team => team.team_id));
  if (teamIds.length !== 2 || !teamIds.every(id => idText(id) && known.has(id))) return refuse("TEAM_INVALID", "현재 분석 데이터에 있는 서로 다른 두 팀이어야 합니다.");
  const teams: Record<string, ObservationTeamSlots> = {};
  for (const teamId of teamIds) {
    const slots = rawTeams[teamId];
    if (!object(slots) || !exact(slots, ROSTER_ROLES)) return refuse("SLOT_INVALID", "팀마다 다섯 역할이 모두 있어야 합니다.");
    const parsed = {} as ObservationTeamSlots;
    for (const role of ROSTER_ROLES) {
      const slot = parseSlot(slots[role]);
      if (!slot) return refuse("SLOT_INVALID", `${role}: 현재 선수 또는 시즌 카드 중 정확히 하나가 필요합니다.`);
      parsed[role] = slot;
    }
    define(teams, teamId, parsed);
  }
  // The existing evidence identity is computed on the detached clone and only its digest is stored.
  return { report, catalog, identity: evidenceIdentityOf(report), asOf: normalizedUtc(asOf), teamIds, teams };
}

/** Reference checks reuse the existing roster and season validators; nothing is substituted. */
function checkReferences(p: Prepared): ObservationFailure | null {
  const current: RosterState = {};
  const season: TeamSeasonSlots = {};
  let seasonCount = 0;
  for (const teamId of p.teamIds) {
    const slots = Object.fromEntries(ROSTER_ROLES.map(role => {
      const slot = p.teams[teamId][role];
      return [role, slot.kind === "CURRENT" ? { source_team_id: slot.source_team_id, player_id: slot.player_id } : null];
    })) as RosterState[string];
    const refs = emptySeasonSlots();
    for (const role of ROSTER_ROLES) {
      const slot = p.teams[teamId][role];
      if (slot.kind !== "SEASON") continue;
      refs[role] = { catalog_id: p.catalog.catalog_id, card_id: slot.card_id, player_id: slot.player_id };
      seasonCount++;
    }
    define(current, teamId, slots);
    define(season, teamId, refs);
  }
  if (!seasonCount) return refuse("NO_SEASON_SLOT", "시즌 선수가 한 명 이상 있는 현재·시즌 혼합 구성만 관측 문맥으로 준비합니다. 현재 선수만 있는 구성은 기존 연습 저장을 그대로 씁니다.");
  const captured = captureRoster(p.report, p.teamIds, rosterBasis(p.report), current);
  if (!captured.ok) return refuse(/같은 선수/.test(captured.message) ? "DUPLICATE_PLAYER" : "CURRENT_INVALID", captured.message);
  const loaded = new Set(p.catalog.seasons.filter(s => s.status === "LOADED").map(s => s.season));
  for (const teamId of p.teamIds) for (const role of ROSTER_ROLES) {
    const ref = season[teamId][role];
    if (!ref) continue;
    let year: number;
    try { year = resolveSeasonRef(ref, role, p.catalog).season; } catch { return refuse("CARD_NOT_FOUND", `${role}: 시즌 카드를 같은 자료·선수·역할로 확인하지 못했습니다.`); }
    if (!loaded.has(year)) return refuse("SEASON_NOT_LOADED", `${year} 시즌은 불러온 자료가 아닙니다.`);
  }
  try { for (const teamId of p.teamIds) validateSeasonLineup(season[teamId], current, teamId, p.catalog, season); }
  catch (error) { return refuse("DUPLICATE_PLAYER", error instanceof Error ? error.message : "같은 선수가 두 번 배정되었습니다."); }
  return null;
}

async function finish(p: Prepared): Promise<ObservationContextResult> {
  try {
    try { await verifySeasonCardIntegrity(p.catalog); }
    catch (error) {
      if (error instanceof Error && error.message === "CRYPTO_UNAVAILABLE") throw error;
      if (!globalThis.crypto?.subtle) throw new Error("CRYPTO_UNAVAILABLE");
      return refuse("CATALOG_TAMPERED", "시즌 선수 자료의 무결성을 확인하지 못했습니다.");
    }
    const failure = checkReferences(p);
    if (failure) return failure;
    const record = {
      artifact_type: OBSERVATION_CONTEXT_ARTIFACT, schema_version: OBSERVATION_CONTEXT_SCHEMA, purpose: OBSERVATION_CONTEXT_PURPOSE,
      analysis_as_of: p.asOf, report_cutoff: p.report.cutoff, report_evidence_digest: await sha256Hex(p.identity),
      catalog_id: p.catalog.catalog_id, catalog_cutoff: p.catalog.cutoff,
      catalog_provenance_digest: await sha256Hex(canonicalText(p.catalog)), team_ids: [p.teamIds[0], p.teamIds[1]] as [string, string], teams: p.teams,
    };
    const context = canonical({ ...record, context_key: await sha256Hex(canonicalText(record)) }) as RosterObservationContext;
    if (bytes(JSON.stringify(context)) > MAX_OBSERVATION_CONTEXT_BYTES) return refuse("TOO_LARGE", "관측 문맥이 16KiB를 넘습니다.");
    return { ok: true, context: deepFreeze(context) };
  } catch {
    return globalThis.crypto?.subtle
      ? refuse("INPUT_INVALID", "관측 문맥을 만들지 못했습니다.")
      : refuse("CRYPTO_UNAVAILABLE", "이 환경에서 로컬 SHA-256(WebCrypto)을 사용할 수 없습니다.");
  }
}

/** Build a context from a report, a loaded catalog, an explicit as-of and 10 slots. Never throws. */
export async function buildRosterObservationContext(input: ObservationContextInput): Promise<ObservationContextResult> {
  let prepared: Prepared | ObservationFailure;
  try { prepared = object(input) ? prepare(input) : refuse("INPUT_INVALID", "입력 형식이 올바르지 않습니다."); }
  catch { return refuse("INPUT_INVALID", "입력을 확인하지 못했습니다."); }
  if ("ok" in prepared) return prepared;
  return finish(prepared);
}

/**
 * Structural parse of an untrusted context value (exact keys, constants, normalized as-of, hashes,
 * sorted distinct team pair, ten slots). Returns a fresh object, or null. Digests are NOT verified here.
 */
export function parseRosterObservationShape(value: unknown): RosterObservationContext | null {
  if (!object(value) || !exact(value, TOP_KEYS) || value.artifact_type !== OBSERVATION_CONTEXT_ARTIFACT ||
    value.schema_version !== OBSERVATION_CONTEXT_SCHEMA || value.purpose !== OBSERVATION_CONTEXT_PURPOSE) return null;
  const asOf = instant(value.analysis_as_of);
  if (!asOf || normalizedUtc(asOf) !== value.analysis_as_of || !instant(value.report_cutoff) || !instant(value.catalog_cutoff)) return null;
  if (!isCardHash(value.report_evidence_digest) || !isCardHash(value.catalog_id) || !isCardHash(value.catalog_provenance_digest) || !isCardHash(value.context_key)) return null;
  const ids = value.team_ids;
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(idText) || !(ids[0] < ids[1]) || !object(value.teams) || !exact(value.teams, ids)) return null;
  const teams: Record<string, ObservationTeamSlots> = {};
  for (const teamId of ids as string[]) {
    const slots = value.teams[teamId];
    if (!object(slots) || !exact(slots, ROSTER_ROLES)) return null;
    const parsed = {} as ObservationTeamSlots;
    for (const role of ROSTER_ROLES) { const slot = parseSlot(slots[role]); if (!slot) return null; parsed[role] = slot; }
    define(teams, teamId, parsed);
  }
  return {
    artifact_type: OBSERVATION_CONTEXT_ARTIFACT, schema_version: OBSERVATION_CONTEXT_SCHEMA, purpose: OBSERVATION_CONTEXT_PURPOSE,
    analysis_as_of: value.analysis_as_of as string, report_cutoff: value.report_cutoff as string, report_evidence_digest: value.report_evidence_digest as string,
    catalog_id: value.catalog_id as string, catalog_cutoff: value.catalog_cutoff as string,
    catalog_provenance_digest: value.catalog_provenance_digest as string, team_ids: [ids[0], ids[1]], teams, context_key: value.context_key as string,
  };
}

/** Canonical (sorted-key) text of a context; refuses anything outside the exact shape or over 16KiB. */
export function serializeRosterObservationContext(context: unknown): { ok: true; text: string } | ObservationFailure {
  const shape = parseRosterObservationShape(context);
  if (!shape) return refuse("FORMAT_INVALID", "검증된 관측 문맥 형식이 아닙니다.");
  const text = canonicalText(shape);
  return bytes(text) > MAX_OBSERVATION_CONTEXT_BYTES ? refuse("TOO_LARGE", "관측 문맥이 16KiB를 넘습니다.") : { ok: true, text };
}

/**
 * Verify a saved context against a report (the SAVED practice report on load) and the exact loaded
 * catalog: digests and context_key are recomputed from validated references, never trusted. Returns
 * the rebuilt canonical object, never the raw input. Never throws.
 */
export async function verifyRosterObservationContext(saved: unknown, current: { report: unknown; catalog: unknown }): Promise<ObservationContextResult> {
  const serialized = serializeRosterObservationContext(saved);
  if (!serialized.ok) return refuse("FORMAT_INVALID", "지원하지 않는 항목이 있거나 형식·목적이 다른 관측 문맥입니다.");
  const shape = parseRosterObservationShape(JSON.parse(serialized.text))!;
  if (!object(current)) return refuse("INPUT_INVALID", "현재 자료가 필요합니다.");
  const catalog = current.catalog;
  if (catalog === null || catalog === undefined) return refuse("CATALOG_MISSING", "저장 때와 같은 시즌 선수 자료를 먼저 불러와 주세요.");
  if (!object(catalog) || catalog.catalog_id !== shape.catalog_id || catalog.cutoff !== shape.catalog_cutoff) {
    return refuse("CATALOG_CHANGED", "저장 때와 시즌 선수 자료 버전이 다릅니다. 다른 자료로 바꾸지 않습니다.");
  }
  const rebuilt = await buildRosterObservationContext({ report: current.report, catalog, analysis_as_of: shape.analysis_as_of, teams: shape.teams });
  if (!rebuilt.ok) return rebuilt;
  const c = rebuilt.context;
  if (c.report_cutoff !== shape.report_cutoff || c.report_evidence_digest !== shape.report_evidence_digest) return refuse("REPORT_CHANGED", "분석 데이터가 저장 때와 다릅니다.");
  if (c.catalog_provenance_digest !== shape.catalog_provenance_digest) {
    return refuse("CATALOG_CHANGED", "시즌 선수 자료의 시즌 상태나 출처 수집 기록이 저장 때와 다릅니다. 다른 자료로 바꾸지 않습니다.");
  }
  if (canonicalText(c) !== serialized.text) return refuse("CONTEXT_KEY_MISMATCH", "관측 문맥 내용이 기록된 키와 일치하지 않습니다.");
  return rebuilt;
}
