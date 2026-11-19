# Solo review stage 2: atomic local storage pair (no UI wiring)

Date: 2026-11-20. Claude implements; Codex verifies. Builds on the stage 1 codec (`ae7d2105`, `web/app/solo-review-retention.ts`).
Design: `docs/LOCAL_REVIEW_RETENTION_DESIGN_2026-11-20.md`.

## Storage layout (unchanged)
- IndexedDB `pro-meta-draft`, version 1, store `sessions`. There is no new store and no version bump.
- `current`: the exact raw board text, as before.
- NEW key `current-solo-review` (`SOLO_REVIEW_KEY`) in the same store holds an opaque review string, at most 64 KiB UTF-8 (`SOLO_REVIEW_STORAGE_MAX_BYTES`, equal to the codec's `MAX_SOLO_REVIEW_BYTES`; a test asserts the two match).

## API (`web/app/draft-session.ts`, storage section only)
- `SOLO_REVIEW_KEY = "current-solo-review"`, `SOLO_REVIEW_STORAGE_MAX_BYTES = 65536`, `type LocalDraftWithReview = { scenario: string | null; review: string | null }`.
- `readLocalDraftWithReview(timeoutMs = DRAFT_STORAGE_TIMEOUT_MS): Promise<LocalDraftWithReview>`
  - Reads `get(current)` and `get(current-solo-review)` in ONE readonly transaction.
  - It resolves only on `oncomplete`, and only after the board read succeeded.
  - A missing, non-string, empty or oversized (UTF-8 bytes) review gives `review: null`.
  - A failed sidecar request is `preventDefault`ed, so the board still returns.
  - Open failure, a failed board request, a transaction abort and the deadline all reject, as `readLocalDraft` does.
  - The connection is closed on every path. Both strings are opaque: the caller parses the board, computes the hash and runs `parseSoloReview`.
- `writeLocalDraftWithReview(scenario, review: string | null, timeoutMs = DRAFT_STORAGE_TIMEOUT_MS): Promise<void>`
  - Writes PUT `current` plus PUT review, or DELETE review, in ONE readwrite transaction.
  - An empty, non-string or oversized review is treated as null (DELETE) and is never truncated.
- `writeLocalDraft(text, timeoutMs)`: same public signature. It now always DELETEs the sidecar in the same transaction as the board PUT, so no stale reasons survive, even when the board bytes are identical.
- `readLocalDraft`: unchanged.
- Both writers share the single `pendingWrite` queue. Calls run in invocation order, and a failed write does not block later writes.

## Write state machine (`persistLocalDraft`)
- **State:** `settled`, `fellBack`, `active` (the current transaction), and one deadline timer.
- **Settlement:** the first of these settles the promise: complete, error, abort, deadline or synchronous setup failure. Settling clears the timer. Callbacks from a non-active transaction, and any callback after settlement, are ignored.
- **Fallback (at most one):**
  - It applies only when the transaction included a non-null review and then aborted by itself, for example on a `QuotaExceededError`.
  - `onerror` does not settle in that case. On the `abort` event, after the original has fully rolled back, one transaction with board PUT plus sidecar DELETE starts on the same connection.
  - If the fallback fails, the write rejects. There is no third attempt.
  - Board-only writes (`writeLocalDraft`, or a null review) never fall back.
- **No fallback cases:** the deadline, `blocked` or open failure, and synchronous setup errors. On the deadline the promise rejects and the active transaction is aborted, so no transaction starts after settlement.
- **Exact bound:**
  - The open takes at most `timeoutMs`, which keeps the existing open deadline.
  - All transactions together, original plus optional fallback, take at most `timeoutMs`; the timer is shared.
  - The worst case is therefore about 2 × `timeoutMs`, the same as before this change.
  - `DRAFT_STORAGE_TIMEOUT_MS` (10 s) is unchanged.
- **No overlap:** the fallback runs inside the same queued job and starts only after the original's abort event, so commits never overlap and the queue is never reordered.

## Tests
- NEW `web/tests/solo-review-storage.test.mjs`, added to the `web/package.json` test script after `draft-storage-deadline`.
- Its fake IndexedDB models atomicity:
  - put and delete only queue operations.
  - The persistent map changes only at commit, which happens in a later macrotask.
  - An abort discards the queued operations.
  - Errors and aborts fire asynchronously.
  - The fake records any transaction overlap.
  - Module timers are counted for leaks.
- Coverage:
  - Constants and DB identity.
  - Pair read: single transaction, completion gating (a hung commit times out, aborts and closes), missing, object, empty, exact-limit, oversize ASCII and multibyte review cases, a failing sidecar get, and a failing board get.
  - Pair write: one transaction; null, empty, invalid and oversize reviews delete rather than truncate.
  - Legacy `writeLocalDraft` clears the same-board sidecar, and its quota failure does not fall back.
  - Cross-API queue order with failure recovery and no overlap.
  - Quota rollback, a single board-only fallback after the abort, and fallback failure.
  - Deadline: abort, close, no fallback, no late writes, stale callbacks ignored; a deadline during the fallback is covered too.
  - Open blocked or hung: no transactions, the late connection is closed, no timers left.
- `web/tests/draft-storage-deadline.test.mjs`: the only change is a no-op `delete()` on test 3's fake store, because the board-only write now deletes the sidecar. All assertions are unchanged.
- **Not run:** no commands, tests, typecheck or lint were run by Claude. These tests show the behaviour against the fake only. Save reliability in real browsers is NOT proven: quota behaviour, event ordering and eviction can differ.

## Remaining stage 3 (not done here)
- Wire `use-draft-save`, the autosave tracker and `draft-lab` to `writeLocalDraftWithReview` and `readLocalDraftWithReview`.
- Compute the board SHA with `crypto.subtle` outside the transaction, then serialize with `serializeSoloReview`.
- Restore path: run `parseSoloReview(review, session, sha)`. On any failure, drop the review silently and keep the board.
- Show an honest restored-note label (local practice notes from this browser, not a verified record).
- Update the stale "not retained" comments and copy: `solo-draft-explanation.tsx:7`, `solo-draft-history.ts`, the history panel, `draft-lab.tsx:250`, and the related text-test assertions.
- Add browser and E2E tests for save → reload → restore, and for clearing on a board-only write.
- Older builds that write the board without the sidecar delete remain limited, so a stale review is possible. The SHA and context checks reject mismatches. No authenticity claims.

## Codex independent verification and service limit
Initial related suite22/23 found an old autosave fake lacked delete(); same Claude updated that fake without changing its ordering assertions.
Codex separately reproduced a real ordering defect: bubbled request error advanced the writer queue before terminal abort. Same Claude changed settlement to wait for terminal abort, including synchronous setup failure after transaction creation. Independent regression now passes.
Final related24/24, typecheck and changed-file lint passed. These remain fake-IDB/unit proofs, not actual-browser quota/eviction proof. No storage UI wiring or full-suite/browser rerun is claimed.
Claude fix call ended with a real usage limit after edits: "You've hit your 5-hour limit · resets 7:40am (Asia/Seoul)". No further Claude calls were made. Final narrative completion report is absent; actual code was reviewed/tested by Codex. Stage3 remains unimplemented.
The state-machine section above is superseded where it lists request error as settlement: request error is NONTERMINAL, only recorded until abort. The queue does not advance on that event.
