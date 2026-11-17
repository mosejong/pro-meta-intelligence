"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { createDraftSaveSession, createDraftSaveTracker, guardDraftUnload, type DraftSaveStatusCode } from "./draft-autosave";
import { writeLocalDraft } from "./draft-session";

type SaveStatus = { code: DraftSaveStatusCode };

// Survives client route changes so a failed/pending write cannot lose its leave guard.
const tracker = createDraftSaveTracker(writeLocalDraft);

/**
 * Submit each committed draft without a cancellable debounce window.
 * Returns a manual retry that resubmits only the latest snapshot after a failed write;
 * it is a no-op while a write is pending or when there is no savable snapshot.
 */
export function useDraftSave(snapshot: string | null, onStatus: (status: SaveStatus) => void) {
  const statusCallback = useRef(onStatus);
  const session = useRef<ReturnType<typeof createDraftSaveSession> | null>(null);
  useLayoutEffect(() => { statusCallback.current = onStatus; }, [onStatus]);

  // Layout effects install the leave guard before the newly painted draft is interactive.
  // Declared before the submit effect so the session exists when the first snapshot arrives.
  useLayoutEffect(() => {
    let mounted = true;
    session.current = createDraftSaveSession(tracker, (code) => { if (mounted) statusCallback.current({ code }); });
    const release = guardDraftUnload(window, tracker);
    return () => { mounted = false; session.current = null; release(); };
  }, []);

  // Superseded submissions stop updating UI (session generation) but never cancel writes.
  useLayoutEffect(() => { void session.current?.submit(snapshot)?.catch(() => undefined); }, [snapshot]);

  return useCallback(() => { void session.current?.retry()?.catch(() => undefined); }, []);
}
