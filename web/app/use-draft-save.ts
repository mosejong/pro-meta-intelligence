"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { createDraftSaveSession, createDraftSaveTracker, guardDraftUnload, type DraftSaveStatusCode } from "./draft-autosave";
import { saveDraftAutosave, type DraftAutosaveRequest } from "./solo-review-autosave";

type SaveStatus = { code: DraftSaveStatusCode };

// Survives client route changes so a failed/pending write cannot lose its leave guard.
// Each request writes the raw board plus its optional local practice notes (or deletes old notes) atomically.
const tracker = createDraftSaveTracker<DraftAutosaveRequest>(saveDraftAutosave);

/**
 * Submit each committed draft request without a cancellable debounce window. A new request object
 * (board text, manual side or notes changed, including notes removed on an identical board) is
 * submitted once; re-renders with the same memoized request never resubmit.
 * Returns a manual retry that resubmits only the latest request after a failed write;
 * it is a no-op while a write is pending or when there is no savable request.
 */
export function useDraftSave(request: DraftAutosaveRequest | null, onStatus: (status: SaveStatus) => void) {
  const statusCallback = useRef(onStatus);
  const session = useRef<ReturnType<typeof createDraftSaveSession<DraftAutosaveRequest>> | null>(null);
  useLayoutEffect(() => { statusCallback.current = onStatus; }, [onStatus]);

  // Layout effects install the leave guard before the newly painted draft is interactive.
  // Declared before the submit effect so the session exists when the first request arrives.
  useLayoutEffect(() => {
    let mounted = true;
    session.current = createDraftSaveSession(tracker, (code) => { if (mounted) statusCallback.current({ code }); });
    const release = guardDraftUnload(window, tracker);
    return () => { mounted = false; session.current = null; release(); };
  }, []);

  // Superseded submissions stop updating UI (session generation) but never cancel writes.
  useLayoutEffect(() => { void session.current?.submit(request)?.catch(() => undefined); }, [request]);

  return useCallback(() => { void session.current?.retry()?.catch(() => undefined); }, []);
}
