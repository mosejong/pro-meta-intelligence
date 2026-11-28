import type { DraftRoomStore } from "./draft-room-store";

export type FeedReloadResult = "UPDATED" | "UNCHANGED" | "READ_FAILED" | "INVALID_JSON" | "INVALID_REPORT";

/**
 * One reload attempt: read the published report, validate it, and hand it to the store for new rooms.
 * Any failure keeps the last valid report. Only the outcome code and the public patch/cutoff are reported
 * (never file contents or paths).
 */
export function reloadFeed(store: Pick<DraftRoomStore, "replaceReport">, read: () => string): FeedReloadResult {
  let text: string;
  try { text = read(); } catch { return "READ_FAILED"; }
  let report: unknown;
  try { report = JSON.parse(text); } catch { return "INVALID_JSON"; }
  try { return store.replaceReport(report) ? "UPDATED" : "UNCHANGED"; } catch { return "INVALID_REPORT"; }
}

/** Reload interval from the environment: unset = off; otherwise whole seconds, at least 60. */
export function feedReloadSeconds(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 60) throw new Error("DRAFT_ROOM_FEED_RELOAD_SECONDS must be a whole number of seconds, at least 60");
  return value;
}
