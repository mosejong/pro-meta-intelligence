# Solo review stage 3: autosave and restore wiring

Date: 2026-11-20. Claude implements; Codex verifies.
This builds on the codec (`ae7d2105`, `docs/SOLO_REVIEW_CODEC_2026-11-20.md`) and the storage pair (`a9d3045b`, `docs/SOLO_REVIEW_STORAGE_2026-11-20.md`). Neither was changed here.

## What the user gets
- With "상대 자동 밴픽" on, the opponent's automatic choices build a review list. That list, together with the chosen manual side, now survives a reload on the same device and the same exact board.
- After the reload:
  - The automatic-choice toggle stays OFF.
  - The last-choice card stays empty (`lastAuto` is null).
  - The saved manual side is selected.
  - The review list shows the frozen records exactly as saved. Nothing is re-suggested or re-explained.
- While any restored record is still on the board, the review panel shows: `이 기기에 저장된 연습 메모에서 불러온 설명입니다. 증명 자료나 예측 근거가 아닙니다.`
- The copy and TXT export text is unchanged.

## API (`web/app/solo-review-autosave.ts`, new)
- **`type DraftAutosaveRequest = { scenario: string; manualSide: DraftSide; records: SoloAutoHistory }`**
- **`webCryptoSha256(text)`:** returns the lowercase hex SHA-256 of the exact UTF-8 bytes, or `null` when `crypto.subtle` is missing.
- **`createSoloReviewAutosave({ digest?, write? })`:** returns `save(request)`.
  - Each request's digest starts immediately, but its write (`writeLocalDraftWithReview`) only begins after the previous request's write has settled. Digests can therefore finish in any order without reordering commits.
  - A rejected write never blocks the next one.
  - If there are no records, no hash, a malformed hash, a digest error or a codec refusal, it writes the board with `review = null`, which deletes the sidecar atomically.
  - The board write is never skipped.
  - The adapter has no timers, retries or network calls.
- **`saveDraftAutosave`:** the single module-wide saver.
- **`readLocalDraftForRestore({ read?, digest? })`** returns one of:
  - `{kind:"EMPTY"}`
  - `{kind:"INVALID", result}`, from the unchanged `parseDraftSession`
  - `{kind:"RESTORED", session, notes: {manualSide, records} | null}`

  It hashes and runs `parseSoloReview` only when a sidecar exists. Any note failure gives `notes: null`, with the board still restored. Storage failures reject as before. It never touches React state.

## Wiring
- **`draft-autosave.ts`:** `createDraftSaveTracker<T = string>` and `createDraftSaveSession<T = string>`. This is a type generalization only; revision, acknowledgement, leave-guard and latest-only retry behaviour are unchanged.
- **`use-draft-save.ts`:**
  - The module-wide tracker now writes `DraftAutosaveRequest` values through `saveDraftAutosave`.
  - `useDraftSave(request | null, onStatus)` submits on each new request object.
  - There is still no debounce and no automatic retry.
- **`draft-lab.tsx`:**
  - `saveSnapshot` is still the raw `serializeDraftScenario` string, and the practice library still uses it.
  - New `autosaveRequest = useMemo(saveSnapshot === null ? null : {scenario, manualSide, records: prunedHistory}, [saveSnapshot, manualSide, prunedHistory])`.
    - It is null in exactly the cases where `saveSnapshot` is null: not ready, importing, room active, or no locked data.
    - Timer and status renders do not resubmit.
    - Changing the notes or the manual side resubmits even when the board bytes are identical.
  - Startup calls `readLocalDraftForRestore()`. The result is applied only if the effect is still active AND `restoreGeneration` is unchanged.
    - `restoreGeneration` is a ref bumped by `restoreSession` (local, import, share and library), by every room snapshot, and by room activation.
    - So neither a stale read nor a late hash can override a board accepted in the meantime.
    - Solo controls are already disabled until `sessionReady`.
  - `restoreSession` clears `autoHistory` and `restoredNotes` to a fresh `[]`. Any board-only restore therefore produces a new request with no records, which deletes the sidecar even when the board string is identical.
  - Only the initial local restore then applies the saved `manualSide`, `autoHistory` and `restoredNotes`.
  - Pruning stays authoritative: undo, reset, team, side, first pick, next game, basis, room and toggling auto all prune or clear records. The next autosave writes the pruned list or deletes the sidecar, so deleted notes cannot come back on reload.
  - Provenance: `restoredNotes` keeps the identity of the restored record objects. The panel note shows while `prunedHistory` still contains any of them.
- **`solo-draft-history-panel.tsx`:** optional `restored` prop, which adds a single `<p role="note">` with the text above. Nothing else in the markup changes.
- **Comments:** the stale "memory-only / never stored" comments in `solo-draft-history.ts`, `solo-draft-history-text.ts`, `solo-draft-explanation.tsx`, the panel and `draft-lab.tsx` now describe the local same-board notes accurately.
- **Unchanged:** files, the practice library, share links and rooms carry no notes, and scenario protocols v2–v4 are unchanged. There is no model, source, readiness, roster or A/B change.

## Tests (not run by Claude)
- **NEW `web/tests/solo-review-autosave.test.mjs`:**
  - WebCrypto exact UTF-8 SHA.
  - Reverse-order digest completion keeps write order, and a first rejection does not block the next write.
  - No records, missing crypto, hash failure, a malformed hash or a codec refusal produce a board-only write.
  - Real save → restore for RED and BLUE manual sides, with frozen records unchanged.
  - Corrupt, side-tampered or SHA-mismatched notes, or a hash failure, keep the board. Only board problems give INVALID or EMPTY, and a read failure rejects.
  - A restore stays pending until a late digest settles. The lab guard is a static source check: active plus generation, auto stays off, generations bumped, notes cleared.
  - Generic tracker/session with requests: latest-only retry, no automatic retry, leave guard, and a same-board notes removal that deletes the sidecar.
- **`web/tests/draft-autosave.test.mjs`:** the static check now expects `useDraftSave(autosaveRequest, …)`, exact memo dependencies `[saveSnapshot, manualSide, prunedHistory]`, and no direct storage reads in the lab. All other assertions are unchanged.
- **`web/tests/solo-draft-history-text.test.mjs`:**
  - New SSR test: the label is added only when `restored` is set, and it is the only markup difference.
  - The comment test now expects the same-board local-notes wording instead of "never stores or restores" for `solo-draft-history.ts`. The panel and text assertions are unchanged.
- **`web/package.json`:** one entry after `solo-review-retention`.

## Limits and risks (honest)
- The startup-generation guard and the React wiring are covered only by static checks plus the existing Codex E2E (`tests/e2e/solo-review-retention-review.spec.mjs`). Unit counts alone do not prove the feature.
- Codex still has to verify: undo/reset/cross-tab/restore-path E2E, PC and mobile, and full web integration.
- A second tab writing the same board can replace notes; the last writer wins, and the SHA plus context checks still reject notes for another board.
- Turning automatic play back on clears the restored list (existing toggle behaviour).
- Older builds can leave a stale sidecar. It is rejected by the SHA, context and board checks unless the board is byte-identical, and even then it is shown only as local practice notes.
- Restored notes are the user's own local notes. They are not authentic AI output, evidence or prediction.

## Codex independent verification — actual final integration
- Claude completed actual same-session response after the quota;15-minute check registration restored only after confirmed success. No account/model/paid bypass.
- Related41/41 and typecheck passed. Same Claude corrected unused test binding and memoized prunedHistory without disabling rules; affected12/12, typecheck, lint and Pages build then passed.
- Independent PC/mobile basic8/8: BLUE/RED reload preserves exact readable text and manual side, auto remains off and last-choice card absent; corrupt notes restore board only; undo and manual-side change remove notes across reloads.
- Independent PC/mobile restore-path4/4: reopening identical named practice or accepting identical share clears sidecar and stays cleared after reload. Notes never silently attach merely because board bytes match.
- Native Chrome two-tab storage test passed:30 interleaved writes/reads never mixed board and another tab's notes, and legacy same-board writer clears notes visible to peer. Initial independent browser fixture used implicit page-owned context; Codex corrected own fixture to an explicit shared browser context before claiming this evidence.
- Whole web **557/557 passed**,104.13s. Log outputs/web-solo-review-restore-integration-20261120.log. Pages contract5/5 and final independent-test lint passed.
- Mobile screenshot outputs/solo-review-restored-mobile-20261120.png visually inspected. No horizontal overflow; note label/readable fallback visible.
- Not newly verified: real iOS/mobile hardware, actual disk exhaustion/eviction, interrupted startup digest against live friend-room entry, file-import path with notes. Unit/source/other existing protocol tests are not represented as browser proof of those cases. No public deployment/admission claim.
- Product source implemented/fixed by Claude only; Codex wrote independent tests/docs. No new source collection/API, push/merge/deploy.

## Remaining import/reset boundary verified
Independent actualPC/mobile2/2 passed: export scenario contains no review sidecar schema/key; current-game reset deletes notes; re-import restores board only; further reload keeps notes absent. Combined with previous12 this is14 distinct PC/mobile checks on unchanged product code. No full-suite repetition for test-only addition. Live room/delayed startup hash remains outside this browser proof.
