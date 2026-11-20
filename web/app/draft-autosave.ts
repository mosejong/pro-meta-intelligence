/**
 * Tracks durable acknowledgements independently of component status messages.
 * `T` is the submitted save value (a raw draft string by default; draft-lab submits a board + notes request).
 */
export function createDraftSaveTracker<T = string>(write: (value: T) => Promise<void>) {
  let revision = 0;
  let acknowledged = 0;
  const savedListeners = new Set<() => void>();
  return {
    hasUnsavedChanges: () => acknowledged < revision,
    onSaved(listener: () => void) {
      savedListeners.add(listener);
      return () => { savedListeners.delete(listener); };
    },
    submit(value: T): Promise<void> {
      const submitted = ++revision;
      // Mark dirty before the writer starts, including synchronous writer failures.
      return Promise.resolve().then(() => write(value)).then(() => {
        acknowledged = Math.max(acknowledged, submitted);
        savedListeners.forEach((listener) => listener());
      });
    },
  };
}

export type DraftSaveStatusCode = "SAVING" | "SAVED" | "SAVE_FAILED";

/**
 * Per-screen save flow on top of the shared tracker. Every committed snapshot is submitted
 * immediately; a manual retry resubmits only the LATEST snapshot (never an older one), and
 * only after its write failed and nothing is pending. Status callbacks from superseded
 * submissions are ignored, so a slow old write cannot overwrite the newest status.
 * Nothing here retries automatically, so status re-renders can never cause a save loop.
 */
export function createDraftSaveSession<T = string>(
  tracker: { submit(value: T): Promise<void> },
  onStatus: (code: DraftSaveStatusCode) => void,
) {
  let generation = 0;
  let latest: T | null = null;
  let pending = false;
  let failed = false;
  function run(value: T) {
    const mine = ++generation;
    pending = true;
    failed = false;
    const saved = tracker.submit(value);
    void Promise.resolve().then(() => { if (mine === generation && pending) onStatus("SAVING"); });
    void saved.then(
      () => { if (mine === generation) { pending = false; onStatus("SAVED"); } },
      () => { if (mine === generation) { pending = false; failed = true; onStatus("SAVE_FAILED"); } },
    );
    return saved;
  }
  const canRetry = () => latest !== null && failed && !pending;
  return {
    /** null = no savable snapshot right now (restoring, importing, no locked data). */
    submit(value: T | null) {
      latest = value;
      return value === null ? null : run(value);
    },
    canRetry,
    retry() { const value = latest; return canRetry() && value !== null ? run(value) : null; },
  };
}

/** Browser leave protection while IndexedDB is pending or its last write failed. */
export function guardDraftUnload(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  tracker: Pick<ReturnType<typeof createDraftSaveTracker>, "hasUnsavedChanges" | "onSaved">,
) {
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!tracker.hasUnsavedChanges()) return;
    event.preventDefault();
    // Required by browsers that still use the legacy returnValue contract.
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", beforeUnload);
  let released = false;
  const removeWhenSaved = () => {
    if (released && !tracker.hasUnsavedChanges()) {
      target.removeEventListener("beforeunload", beforeUnload);
      unsubscribe();
    }
  };
  const unsubscribe = tracker.onSaved(removeWhenSaved);
  // A route change may unmount the UI while IndexedDB is still writing. Retain its
  // guard until the persistent tracker acknowledges the latest draft, including retries.
  return () => { released = true; removeWhenSaved(); };
}
