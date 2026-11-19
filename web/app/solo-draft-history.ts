import type { DraftSelection } from "./draft-agent";
import { soloAutoRecordMatches, type SoloAutoRecord } from "./solo-draft-explanation";

/**
 * Memory-only review list of the opponent's real auto-confirmed turns in the current set.
 * Each entry is a frozen copy of the record built immediately before its confirmation; nothing here
 * re-derives an explanation later (late season data, report refreshes, etc. never rewrite it).
 * Never persisted, shared, linked or sent to a room.
 */
export type SoloAutoHistory = readonly SoloAutoRecord[];

/** Key for the full context a history entry is valid in: solo matchup/side/series plus data basis. */
export function soloHistoryContext(autoContext: string, basis: string): string {
  return JSON.stringify([autoContext, basis]);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Freeze a copy so later mutation of the source (or of the caller's state) cannot alter the review. */
export function freezeSoloAutoRecord(record: SoloAutoRecord): SoloAutoRecord {
  return deepFreeze(structuredClone(record));
}

/** True when `entry` is consistent with `record`'s pre-choice prefix (same context, earlier turn, same champion there). */
function consistentWith(entry: SoloAutoRecord, record: SoloAutoRecord): boolean {
  return entry.context === record.context && entry.turn < record.turn
    && record.prefix[entry.turn - 1] === entry.champion_id
    && entry.prefix.every((id, index) => record.prefix[index] === id);
}

/** Append a new real auto record; entries from another context or a different past prefix are dropped. */
export function appendSoloAutoHistory(history: SoloAutoHistory, record: SoloAutoRecord): SoloAutoHistory {
  return [...history.filter(entry => consistentWith(entry, record)), freezeSoloAutoRecord(record)];
}

/**
 * Keep only entries still present on the current board on the same prefix/context. Callers store the
 * result back, so an entry removed by undo/reset/context change never comes back even if the same
 * champion is later chosen manually on the same turn.
 */
export function pruneSoloAutoHistory(history: SoloAutoHistory, selections: DraftSelection[], context: string): SoloAutoHistory {
  const kept = history.filter(entry => soloAutoRecordMatches(entry, selections, context));
  return kept.length === history.length ? history : kept;
}
