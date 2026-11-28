import {
  buildRosterObservationContext, compareInstants, deepFreeze, serializeRosterObservationContext,
  type ObservationContextInput, type ObservationContextReason, type ObservationContextResult, type ObservationSlot, type RosterObservationContext,
} from "./roster-observation-context";
import { ROSTER_ROLES, type RosterState } from "./roster-scenario";
import type { SeasonCardCatalog, TeamSeasonSlots } from "./season-player-cards";

/**
 * Explicit observation-context preparation: a pure, clock-free controller owned by the verified
 * catalog owner (the roster editor). One explicit `prepare` call captures every input synchronously
 * and builds the observation context. The result is published only if no newer `prepare`,
 * `invalidate` or `dispose` happened in the meantime.
 *
 * - It never reads a clock. The caller supplies `analysisAsOf`, captured once at the click; that is
 *   the preparation time, not data freshness.
 * - It never fetches, looks up or persists a catalog, report or reference.
 * - It infers nothing (no strength, rating, effect or win rate) and runs nothing.
 * - Each `invalidate` bumps the generation unconditionally, so an edit A→B→A still withdraws.
 */

export type ObservationPreparationReason = ObservationContextReason | "BLOCKED" | "PROVENANCE_MISMATCH" | "RESTORE_MISMATCH";

/** Detached, deep-frozen value handed to the parent. `catalog` is the exact catalog the context was built from. */
export type ObservationPreparation = Readonly<{
  generation: number;
  /** `ownerKey|catalog_id|catalog_provenance_digest|context_key|generation`. */
  tag: string;
  ownerKey: string;
  context: RosterObservationContext;
  catalog: SeasonCardCatalog;
  /** True when this value came from an explicit practice restore that matched the saved context in full. */
  restored: boolean;
}>;

export type ObservationPreparationStatus =
  | { phase: "IDLE" }
  | { phase: "PREPARING"; generation: number; restoring: boolean }
  | { phase: "READY"; generation: number; ready: ObservationPreparation }
  | { phase: "REFUSED"; generation: number; reason: ObservationPreparationReason; message: string; restoring: boolean };

export type ObservationPreparationRequest = {
  /** Owner identity (e.g. basis key + pair key), copied into the tag. */
  ownerKey: string;
  report: unknown;
  /** The owner's verified, already loaded catalog. `null` is refused; nothing is fetched. */
  catalog: SeasonCardCatalog | null;
  teamIds: readonly [string, string];
  rosters: RosterState;
  seasonLineups: TeamSeasonSlots;
  /** Captured once by the caller at the explicit click (or the saved as-of for a restore). */
  analysisAsOf: string;
  /** The owner's existing room/restore/read/loading block at call time. */
  blocked: boolean;
  /**
   * Explicit practice restore only: the fully verified saved context. The owner rebuilds from its
   * ACTUAL report/catalog/rosters with `analysisAsOf` = the saved as-of and publishes only when the
   * canonical rebuilt context equals this one in full (else RESTORE_MISMATCH). A stored context_key
   * alone is never trusted.
   */
  expected?: RosterObservationContext | null;
};

export type ObservationPreparationSession = {
  prepare(request: ObservationPreparationRequest): Promise<ObservationPreparationStatus | null>;
  invalidate(): void;
  dispose(): void;
  status(): ObservationPreparationStatus;
  generation(): number;
};

export type ObservationPreparationOptions = {
  /** Receives a ready value, or `null` once when a published value is withdrawn. */
  onPublish: (value: ObservationPreparation | null) => void;
  onStatus?: (status: ObservationPreparationStatus) => void;
  /** Injectable for race tests; defaults to the context builder. */
  build?: (input: ObservationContextInput) => Promise<ObservationContextResult>;
};

export const OBSERVATION_PREPARATION_IDLE: ObservationPreparationStatus = Object.freeze({ phase: "IDLE" });

type SlotsResult = { ok: true; teams: Record<string, Record<string, ObservationSlot>> } | { ok: false; reason: ObservationPreparationReason; message: string };

/**
 * Exact owner slots to context refs: a SEASON ref when a season card is assigned, else the CURRENT
 * roster slot. Empty slots, both-at-once, refs to another catalog and teams outside the pair are
 * refused. Nothing is filled in.
 */
export function observationSlotsOf(teamIds: readonly [string, string], rosters: RosterState, seasonLineups: TeamSeasonSlots, catalogId: string): SlotsResult {
  if (Object.keys(seasonLineups).some((teamId) => !teamIds.includes(teamId))) return { ok: false, reason: "TEAM_INVALID", message: "현재 두 팀이 아닌 시즌 배정이 있습니다." };
  const teams: Record<string, Record<string, ObservationSlot>> = {};
  for (const teamId of teamIds) {
    const slots: Record<string, ObservationSlot> = {};
    for (const role of ROSTER_ROLES) {
      const season = seasonLineups[teamId]?.[role] ?? null;
      const current = rosters[teamId]?.[role] ?? null;
      if (season && current) return { ok: false, reason: "SLOT_INVALID", message: `${role}: 현재 선수와 시즌 선수가 함께 배정되어 있습니다.` };
      if (season) {
        if (season.catalog_id !== catalogId) return { ok: false, reason: "CATALOG_CHANGED", message: "시즌 배정이 지금 불러온 시즌 선수 자료와 다릅니다. 다른 자료로 바꾸지 않습니다." };
        slots[role] = { kind: "SEASON", card_id: season.card_id, player_id: season.player_id };
      } else if (current) slots[role] = { kind: "CURRENT", source_team_id: current.source_team_id, player_id: current.player_id };
      else return { ok: false, reason: "SLOT_INVALID", message: "빈 역할이 있어 준비하지 않았습니다. 두 팀 다섯 역할을 모두 채워 주세요." };
    }
    Object.defineProperty(teams, teamId, { value: slots, enumerable: true, writable: true, configurable: true });
  }
  return { ok: true, teams };
}

export function createObservationPreparationSession(options: ObservationPreparationOptions): ObservationPreparationSession {
  const build = options.build ?? buildRosterObservationContext;
  let generation = 0;
  let current: ObservationPreparationStatus = OBSERVATION_PREPARATION_IDLE;
  let published = false;
  let disposed = false;

  function setStatus(next: ObservationPreparationStatus) {
    current = next;
    options.onStatus?.(next);
  }
  function invalidate() {
    generation++;
    if (published) { published = false; options.onPublish(null); }
    if (current.phase !== "IDLE") setStatus(OBSERVATION_PREPARATION_IDLE);
  }

  async function prepare(request: ObservationPreparationRequest): Promise<ObservationPreparationStatus | null> {
    if (disposed) return null;
    invalidate();
    const token = generation;
    const restoring = request.expected !== undefined && request.expected !== null;
    const refused = (reason: ObservationPreparationReason, message: string) => {
      const status: ObservationPreparationStatus = Object.freeze({ phase: "REFUSED", generation: token, reason, message, restoring });
      setStatus(status);
      return status;
    };
    if (request.blocked) return refused("BLOCKED", "다른 작업(친구 방·복원·읽기·불러오기) 중이라 준비하지 않았습니다.");
    if (!request.catalog) return refused("CATALOG_MISSING", "시즌 선수 자료를 먼저 불러와 주세요. 현재 선수로 대체하지 않습니다.");

    // Everything is captured before the first await; later edits of the sources cannot reach the build.
    let report: unknown, catalog: SeasonCardCatalog, teams: Record<string, Record<string, ObservationSlot>>;
    let ownerKey: string, asOf: string, teamIds: [string, string];
    let expectedText: string | null = null;
    try {
      if (restoring) {
        const serialized = serializeRosterObservationContext(request.expected);
        if (!serialized.ok) return refused("RESTORE_MISMATCH", "복원할 준비 내용의 형식을 확인하지 못해 사용하지 않습니다.");
        expectedText = serialized.text;
      }
      ownerKey = String(request.ownerKey);
      asOf = String(request.analysisAsOf);
      teamIds = [String(request.teamIds[0]), String(request.teamIds[1])];
      const slots = observationSlotsOf(teamIds, request.rosters, request.seasonLineups, request.catalog.catalog_id);
      if (!slots.ok) return refused(slots.reason, slots.message);
      teams = structuredClone(slots.teams);
      report = structuredClone(request.report);
      catalog = deepFreeze(structuredClone(request.catalog));
    } catch { return refused("INPUT_INVALID", "입력을 복사하지 못했습니다."); }

    setStatus(Object.freeze({ phase: "PREPARING", generation: token, restoring }));
    let result: ObservationContextResult;
    try { result = await build({ report, catalog, analysis_as_of: asOf, teams }); }
    catch { result = { ok: false, reason: "INPUT_INVALID", message: "관측 문맥을 준비하지 못했습니다." }; }
    if (disposed || token !== generation) return null;
    if (!result.ok) return refused(result.reason, result.message);

    const context = result.context;
    const reportCutoff = (report as { cutoff?: unknown }).cutoff;
    const sorted = [...teamIds].sort();
    if (context.catalog_id !== catalog.catalog_id || context.catalog_cutoff !== catalog.cutoff || context.report_cutoff !== reportCutoff
      || context.team_ids[0] !== sorted[0] || context.team_ids[1] !== sorted[1]
      // Same instant at nanosecond precision (the builder normalizes to UTC); never Date.parse.
      || compareInstants(context.analysis_as_of, asOf) !== 0) {
      return refused("PROVENANCE_MISMATCH", "준비한 문맥이 캡처한 자료 기준과 일치하지 않아 사용하지 않습니다.");
    }
    if (expectedText !== null) {
      // Full canonical comparison (every slot, clock, digest and key) before anything is published.
      const rebuilt = serializeRosterObservationContext(context);
      if (!rebuilt.ok || rebuilt.text !== expectedText) return refused("RESTORE_MISMATCH", "저장된 관측 문맥과 지금 적용된 선수 구성·자료가 달라 준비를 복원하지 않았습니다.");
    }
    const ready: ObservationPreparation = deepFreeze({
      generation: token,
      tag: [ownerKey, context.catalog_id, context.catalog_provenance_digest, context.context_key, token].join("|"),
      ownerKey,
      context: deepFreeze(structuredClone(context)),
      catalog,
      restored: restoring,
    });
    const status: ObservationPreparationStatus = Object.freeze({ phase: "READY", generation: token, ready });
    setStatus(status);
    published = true;
    options.onPublish(ready);
    return status;
  }

  return {
    prepare,
    invalidate() { if (!disposed) invalidate(); },
    dispose() { if (disposed) return; invalidate(); disposed = true; },
    status: () => current,
    generation: () => generation,
  };
}
