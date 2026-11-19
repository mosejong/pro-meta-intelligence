import { MAX_DRAFT_FILE_BYTES, parseDraftSession, type DraftSession, type DraftSessionErrorCode } from "./draft-session";
import { buildRosterIndex, MAX_ROSTER_FILE_BYTES, parseRosterScenario, rosterBasis, type RosterErrorCode, type RosterScenario } from "./roster-scenario";

/**
 * Optional "current players" bundle for the practice library. The stored value is either the
 * legacy plain draft scenario string (unchanged draft-session v2/v3/v4) or a small versioned
 * envelope holding that same draft string plus an unchanged roster-scenario v1 string. The roster
 * is always validated against the draft's own frozen report (basis), team pair and player index;
 * an invalid roster rejects the whole item instead of being dropped. Inputs are never mutated.
 */
export const PRACTICE_BUNDLE_ARTIFACT = "practice-bundle";
export const PRACTICE_BUNDLE_VERSION = 1;
export const MAX_PRACTICE_CONTENT_BYTES = MAX_DRAFT_FILE_BYTES + MAX_ROSTER_FILE_BYTES + 1024;

export type PracticeContent = { session: DraftSession; roster: RosterScenario | null };
export type PracticeContentError =
  | { code: "TOO_LARGE" }
  | { code: "INVALID_SCENARIO"; sessionCode?: DraftSessionErrorCode }
  | { code: "INVALID_ROSTER"; rosterCode: RosterErrorCode }
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
  return parsed.ok ? { ok: true, session: parsed.session, roster: null, text } : { ok: false, code: "INVALID_SCENARIO", sessionCode: parsed.code };
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
export function buildPracticeContent(draftText: string, rosterText: string | null = null): PracticeContentResult {
  if (typeof draftText !== "string") return { ok: false, code: "INVALID_SCENARIO" };
  const draft = parseDraft(draftText);
  if (!draft.ok || rosterText === null) return draft;
  const roster = parseRosterFor(draft.session, rosterText);
  if (!roster.ok) return { ok: false, ...roster.error };
  const text = JSON.stringify({ artifact_type: PRACTICE_BUNDLE_ARTIFACT, schema_version: PRACTICE_BUNDLE_VERSION, draft: draftText, roster: rosterText });
  if (bytes(text) > MAX_PRACTICE_CONTENT_BYTES) return { ok: false, code: "TOO_LARGE" };
  return { ok: true, session: draft.session, roster: roster.roster, text };
}

/** Parse a stored value: legacy plain draft string, or a v1 envelope (draft + roster both required). */
export function parsePracticeContent(raw: unknown): PracticeContentResult {
  if (typeof raw !== "string") return { ok: false, code: "CORRUPT" };
  if (bytes(raw) > MAX_PRACTICE_CONTENT_BYTES) return { ok: false, code: "TOO_LARGE" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return parseDraft(raw); }
  if (!record(value) || value.artifact_type !== PRACTICE_BUNDLE_ARTIFACT) return parseDraft(raw);
  if (value.schema_version !== PRACTICE_BUNDLE_VERSION || Object.keys(value).length !== 4 || typeof value.draft !== "string") return { ok: false, code: "CORRUPT" };
  const draft = parseDraft(value.draft);
  if (!draft.ok) return draft;
  const roster = parseRosterFor(draft.session, value.roster);
  if (!roster.ok) return { ok: false, ...roster.error };
  return { ok: true, session: draft.session, roster: roster.roster, text: raw };
}
