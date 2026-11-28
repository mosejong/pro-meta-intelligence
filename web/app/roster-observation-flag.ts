import { useSyncExternalStore } from "react";

/**
 * Explicit opt-in for roster observation-context preparation and its practice v3 attachment.
 * Default OFF: absent, unreadable or any value other than "on" means off. When off, practice saves
 * stay the ordinary v1/v2 formats and a stored v3 practice restores only its draft/roster/season.
 * Device-local convenience only (never shared, never part of a practice, link or room message).
 */
export const OBSERVATION_FLAG_KEY = "pro-meta-roster-observation-context-v1";
const CHANGE = "pro-meta-observation-flag-change";

export function readObservationFlag(): boolean {
  try { return typeof window !== "undefined" && window.localStorage.getItem(OBSERVATION_FLAG_KEY) === "on"; }
  catch { return false; }
}

/** Explicit user toggle. A failed write leaves the flag as it was (and reports false). */
export function setObservationFlag(on: boolean): boolean {
  try {
    if (on) window.localStorage.setItem(OBSERVATION_FLAG_KEY, "on");
    else window.localStorage.removeItem(OBSERVATION_FLAG_KEY);
  } catch { return false; }
  window.dispatchEvent(new Event(CHANGE));
  return true;
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener("storage", listener); };
}

export function useObservationFlag(): boolean {
  return useSyncExternalStore(subscribe, readObservationFlag, () => false);
}
