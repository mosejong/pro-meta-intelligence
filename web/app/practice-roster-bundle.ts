import { MAX_DRAFT_FILE_BYTES, parseDraftSession, type DraftSession, type DraftSessionErrorCode } from "./draft-session";
import { buildRosterIndex, MAX_ROSTER_FILE_BYTES, parseRosterScenario, ROSTER_ROLES, rosterBasis, type RosterErrorCode, type RosterScenario } from "./roster-scenario";
import { emptySeasonSlots, isCardHash, validateSeasonLineup, type SeasonCardCatalog, type SeasonSlots, type TeamSeasonSlots } from "./season-player-cards";

/**
 * Optional "current players" bundle for the practice library. The stored value is either the
 * legacy plain draft scenario string (unchanged draft-session v2/v3/v4) or a small versioned
 * envelope holding that same draft string plus an unchanged roster-scenario v1 string. The roster
 * is always validated against the draft's own frozen report (basis), team pair and player index;
 * an invalid roster rejects the whole item instead of being dropped. Inputs are never mutated.
 */
export const PRACTICE_BUNDLE_ARTIFACT = "practice-bundle";
export const PRACTICE_BUNDLE_VERSION = 1;
/** v2 = v1 + season-player references (catalog identity + per-team SeasonCardRef slots). */
export const PRACTICE_BUNDLE_VERSION_SEASON = 2;
export const MAX_SEASON_PART_BYTES = 8 * 1024;
export const MAX_PRACTICE_CONTENT_BYTES = MAX_DRAFT_FILE_BYTES + MAX_ROSTER_FILE_BYTES + MAX_SEASON_PART_BYTES + 1024;

/**
 * Season part of a v2 bundle: only references into a published season-player-cards catalog
 * (identified by catalog_id + cutoff). No names, stats or card bodies are stored; nothing here is
 * a win rate or player rating. Structural checks run on read; catalog checks need the live catalog.
 */
export type SeasonPracticePart = { catalog_id: string; cutoff: string; lineups: TeamSeasonSlots };
export type PracticeContent = { session: DraftSession; roster: RosterScenario | null; season: SeasonPracticePart | null };
export type PracticeContentError =
  | { code: "TOO_LARGE" }
  | { code: "INVALID_SCENARIO"; sessionCode?: DraftSessionErrorCode }
  | { code: "INVALID_ROSTER"; rosterCode: RosterErrorCode }
  | { code: "INVALID_SEASON" }
  | { code: "CORRUPT" };
export type PracticeContentResult = ({ ok: true } & PracticeContent & { text: string }) | ({ ok: false } & PracticeContentError);

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The roster context a draft session implies: its frozen snapshot basis, sorted pair and player index. */
export function sessionRosterContext(session: DraftSession) {
  return {
    basis: rosterBasis(session.report),
    teamIds: [session.blueTeamId, session.redTeamId].sort() as [string, string],
    index: buildRosterIndex(session.report.opponent_prep?.teams ?? []),
  };
}

function parseDraft(text: string): PracticeContentResult {
  if (bytes(text) > MAX_DRAFT_FILE_BYTES) return { ok: false, code: "TOO_LARGE" };
  const parsed = parseDraftSession(text);
  return parsed.ok ? { ok: true, session: parsed.session, roster: null, season: null, text } : { ok: false, code: "INVALID_SCENARIO", sessionCode: parsed.code };
}

function parseRosterFor(session: DraftSession, rosterText: unknown): { ok: true; roster: RosterScenario } | { ok: false; error: PracticeContentError } {
  if (typeof rosterText !== "string") return { ok: false, error: { code: "CORRUPT" } };
  if (bytes(rosterText) > MAX_ROSTER_FILE_BYTES) return { ok: false, error: { code: "TOO_LARGE" } };
  const result = parseRosterScenario(rosterText, sessionRosterContext(session));
  return result.ok ? { ok: true, roster: result.value } : { ok: false, error: { code: "INVALID_ROSTER", rosterCode: result.code } };
}

/**
 * Build the stored value. Without a roster the draft string is stored verbatim (legacy format);
 * with one, both strings are strictly validated and wrapped in the envelope.
 */
export function buildPracticeContent(draftText: string, rosterText: string | null = null, season: unknown = null): PracticeContentResult {
  if (typeof draftText !== "string") return { ok: false, code: "INVALID_SCENARIO" };
  const draft = parseDraft(draftText);
  if (!draft.ok) return draft;
  // A season part is only meaningful next to the current-player roster it was checked against.
  if (rosterText === null) return season === null ? draft : { ok: false, code: "INVALID_SEASON" };
  const roster = parseRosterFor(draft.session, rosterText);
  if (!roster.ok) return { ok: false, ...roster.error };
  let seasonPart: SeasonPracticePart | null = null;
  if (season !== null) {
    if (bytes(JSON.stringify(season) ?? "") > MAX_SEASON_PART_BYTES) return { ok: false, code: "TOO_LARGE" };
    seasonPart = parseSeasonPart(season, roster.roster);
    if (!seasonPart) return { ok: false, code: "INVALID_SEASON" };
  }
  const text = JSON.stringify(seasonPart
    ? { artifact_type: PRACTICE_BUNDLE_ARTIFACT, schema_version: PRACTICE_BUNDLE_VERSION_SEASON, draft: draftText, roster: rosterText, season: seasonPart }
    : { artifact_type: PRACTICE_BUNDLE_ARTIFACT, schema_version: PRACTICE_BUNDLE_VERSION, draft: draftText, roster: rosterText });
  if (bytes(text) > MAX_PRACTICE_CONTENT_BYTES) return { ok: false, code: "TOO_LARGE" };
  return { ok: true, session: draft.session, roster: roster.roster, season: seasonPart, text };
}

const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const playerIdText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const cutoffText = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

/**
 * Structural check of a season part against the validated current roster (no catalog needed):
 * exactly the roster's two teams, five roles each, refs of one catalog, at least one ref, no ref in
 * a slot that also holds a current player, and no player ID twice across both teams (current or
 * season). Returns a fresh copy, or null. Names are never used for identity.
 */
export function parseSeasonPart(value: unknown, roster: RosterScenario): SeasonPracticePart | null {
  if (!record(value) || !exact(value, ["catalog_id", "cutoff", "lineups"]) || !isCardHash(value.catalog_id) || !cutoffText(value.cutoff) || !record(value.lineups)) return null;
  const catalogId = value.catalog_id;
  const teamIds = [...roster.team_ids].sort();
  const rawLineups = value.lineups;
  if (!exact(rawLineups, teamIds)) return null;
  const seen = new Set<string>();
  for (const teamId of teamIds) for (const role of ROSTER_ROLES) { const p = roster.rosters[teamId]?.[role]; if (p) seen.add(p.player_id); }
  const lineups: TeamSeasonSlots = {};
  let refs = 0;
  for (const teamId of teamIds) {
    const slots = rawLineups[teamId];
    if (!record(slots) || !exact(slots, ROSTER_ROLES)) return null;
    const parsed: SeasonSlots = emptySeasonSlots();
    for (const role of ROSTER_ROLES) {
      const ref = slots[role];
      if (ref === null) continue;
      if (!record(ref) || !exact(ref, ["catalog_id", "card_id", "player_id"]) || ref.catalog_id !== catalogId || !isCardHash(ref.card_id) || !playerIdText(ref.player_id)) return null;
      if (roster.rosters[teamId]?.[role] || seen.has(ref.player_id)) return null;
      seen.add(ref.player_id);
      parsed[role] = { catalog_id: catalogId, card_id: ref.card_id, player_id: ref.player_id };
      refs++;
    }
    Object.defineProperty(lineups, teamId, { value: parsed, enumerable: true, writable: true, configurable: true });
  }
  return refs > 0 ? { catalog_id: catalogId, cutoff: value.cutoff as string, lineups } : null;
}

export type SeasonCatalogCheck = { ok: true; lineups: TeamSeasonSlots } | { ok: false; code: "NO_CATALOG" | "CATALOG_CHANGED" | "CARD_MISSING"; message: string };
/**
 * Verify a structurally valid season part against the currently published catalog (already parsed
 * and integrity-checked with the shared season-player-cards functions). The catalog must be the same
 * version (catalog_id and cutoff); each ref must resolve by card_id + player_id + role, and the
 * shared lineup validator re-checks slot/duplicate rules. Nothing is substituted on failure.
 */
export function verifySeasonPart(season: SeasonPracticePart, roster: RosterScenario, catalog: SeasonCardCatalog | null | undefined): SeasonCatalogCheck {
  const keep = " 현재 밴픽과 선수 구성은 그대로 유지합니다.";
  if (!catalog) return { ok: false, code: "NO_CATALOG", message: `시즌 선수 자료를 확인하지 못해 연습을 불러오지 않았습니다.${keep}` };
  if (catalog.catalog_id !== season.catalog_id || catalog.cutoff !== season.cutoff) return { ok: false, code: "CATALOG_CHANGED", message: `저장 때와 시즌 선수 자료 버전이 달라 연습을 불러오지 않았습니다.${keep}` };
  try {
    for (const teamId of Object.keys(season.lineups)) validateSeasonLineup(season.lineups[teamId], roster.rosters, teamId, catalog, season.lineups);
  } catch {
    return { ok: false, code: "CARD_MISSING", message: `저장된 시즌 선수를 현재 자료에서 확인하지 못해 연습을 불러오지 않았습니다.${keep}` };
  }
  return { ok: true, lineups: structuredClone(season.lineups) };
}

/** Parse a stored value: legacy plain draft string, a v1 envelope (draft + roster) or a v2 envelope (+ season refs). */
export function parsePracticeContent(raw: unknown): PracticeContentResult {
  if (typeof raw !== "string") return { ok: false, code: "CORRUPT" };
  if (bytes(raw) > MAX_PRACTICE_CONTENT_BYTES) return { ok: false, code: "TOO_LARGE" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return parseDraft(raw); }
  if (!record(value) || value.artifact_type !== PRACTICE_BUNDLE_ARTIFACT) return parseDraft(raw);
  const v1 = value.schema_version === PRACTICE_BUNDLE_VERSION && exact(value, ["artifact_type", "schema_version", "draft", "roster"]);
  const v2 = value.schema_version === PRACTICE_BUNDLE_VERSION_SEASON && exact(value, ["artifact_type", "schema_version", "draft", "roster", "season"]);
  if ((!v1 && !v2) || typeof value.draft !== "string") return { ok: false, code: "CORRUPT" };
  const draft = parseDraft(value.draft);
  if (!draft.ok) return draft;
  const roster = parseRosterFor(draft.session, value.roster);
  if (!roster.ok) return { ok: false, ...roster.error };
  if (!v2) return { ok: true, session: draft.session, roster: roster.roster, season: null, text: raw };
  const season = parseSeasonPart(value.season, roster.roster);
  if (!season) return { ok: false, code: "INVALID_SEASON" };
  return { ok: true, session: draft.session, roster: roster.roster, season, text: raw };
}
