import { buildPracticeContent, type SeasonPracticePart } from "./practice-roster-bundle";
import {
  reportEvidenceDigest, verifyRosterObservationContext,
  type ObservationContextReason, type RosterObservationContext,
} from "./roster-observation-context";
import type { SeasonCardCatalog } from "./season-player-cards";

/**
 * Helpers between the practice library and the observation-context owner. Pure, clock-free and
 * fetch-free. The library's stored observation part is STRUCTURAL ONLY and never trusted: a restore
 * always re-runs the full async verifier against the already loaded catalog and the SAVED report,
 * and the owner then rebuilds from its actually applied state (see roster-observation-session.ts).
 */

/**
 * Context to attach to an explicit practice save, or null (ordinary v1/v2 save; nothing fabricated).
 * Attached only when the opt-in flag is on, a prepared context exists, roster and season parts are
 * both present, the bundle codec accepts it for this exact draft/roster/season (report cutoff,
 * catalog version, team pair and all ten slots), and its report digest equals the digest of the
 * report the saved draft serializes. Any disagreement falls back to the ordinary save.
 */
export async function practiceObservationForSave(input: {
  enabled: boolean;
  prepared: RosterObservationContext | null;
  scenario: string | null;
  roster: string | null;
  season: SeasonPracticePart | null;
}): Promise<RosterObservationContext | null> {
  const { enabled, prepared, scenario, roster, season } = input;
  if (!enabled || !prepared || scenario === null || roster === null || season === null) return null;
  try {
    const content = buildPracticeContent(scenario, roster, season, prepared);
    if (!content.ok || !content.observation) return null;
    if (await reportEvidenceDigest(content.session.report) !== prepared.report_evidence_digest) return null;
    return content.observation;
  } catch { return null; }
}

export type PracticeObservationVerdict =
  | { ok: true; expected: RosterObservationContext }
  | { ok: false; reason: ObservationContextReason | "ABORTED" | "STALE"; message: string };

/**
 * Full verification of a stored observation part. Inputs are captured synchronously before the first
 * await; `isCurrent` (load ticket/token) and `signal` are checked again after it. The catalog is the
 * one ALREADY loaded and season-verified for this load; the report is the SAVED session report.
 * Nothing is fetched and no receipt is substituted.
 */
export async function verifyPracticeObservation(input: {
  observation: RosterObservationContext;
  catalog: SeasonCardCatalog;
  savedReport: unknown;
  signal?: AbortSignal | null;
  isCurrent?: () => boolean;
  verify?: typeof verifyRosterObservationContext;
}): Promise<PracticeObservationVerdict> {
  const verify = input.verify ?? verifyRosterObservationContext;
  let observation: unknown, report: unknown, catalog: unknown;
  try {
    observation = structuredClone(input.observation);
    report = structuredClone(input.savedReport);
    catalog = structuredClone(input.catalog);
  } catch { return { ok: false, reason: "INPUT_INVALID", message: "관측 문맥을 확인할 입력을 복사하지 못했습니다." }; }
  const signal = input.signal ?? null;
  const isCurrent = input.isCurrent ?? (() => true);
  if (signal?.aborted) return { ok: false, reason: "ABORTED", message: "확인을 취소했습니다." };
  let result: Awaited<ReturnType<typeof verifyRosterObservationContext>>;
  try { result = await verify(observation, { report, catalog }); }
  catch { result = { ok: false, reason: "INPUT_INVALID", message: "관측 문맥을 확인하지 못했습니다." }; }
  if (signal?.aborted) return { ok: false, reason: "ABORTED", message: "확인을 취소했습니다." };
  if (!isCurrent()) return { ok: false, reason: "STALE", message: "더 새로운 작업이 있어 결과를 쓰지 않습니다." };
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  return { ok: true, expected: result.context };
}
