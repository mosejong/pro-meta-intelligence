# Setup practice mode (2026-11-20)

This is a product usability change. It acts on the design suggestion in
`NEXT_PRODUCT_USABILITY_AUDIT_2026-11-20.md`: the automatic opponent already existed, but it could only be
found after the draft had started. That audit finding was a discoverability issue, not a correctness bug.

No scoring, model, storage, share, room, translation, package or dependency change.

## What changed

The team-selection step now has one compact choice, **진행 방식**, directly above the start button:

| Option | Meaning |
|---|---|
| 양쪽 모두 직접 선택 | Both sides are picked by hand. This is the fresh default and today's behaviour |
| 내 팀 {blue team} · 블루 · 상대 자동 | I play blue; red is played automatically |
| 내 팀 {red team} · 레드 · 상대 자동 | I play red; blue is played automatically |

The control reuses the existing `soloEnabled` and `manualSide` state, and the existing 600 ms automatic-turn
effect. The draft-step checkbox "상대 자동 밴픽" and the "내 진영" select are unchanged, so the mode can still
be changed mid-game.

## Semantics, including the correction to the audit

The audit's sketch cleared the notes, the staged card and the timer on every start. **That was wrong, and it
is not what this change does.**

1. **Setup is a draft only.** A radio only sets `setupChoice`, which lives in memory and is never saved.
   - On SETUP, nothing auto-plays, no timer runs and nothing is cleared.
   - The automatic turn stays gated by `boardActive`, which is true only on the DRAFT step.
2. **The choice is applied only by the explicit "밴픽 시작" / "밴픽 이어가기" click.**
   - `draftStartBlock` is checked first, so every existing start gate still applies.
   - `practiceModeChange(choice, current, roomActive)` then decides what to change.
3. **Continue with the effective mode unchanged leaves everything as it was.**
   - The helper returns `null`.
   - The board, roles, roster, games, staged card, notes, timer state and prior `soloEnabled` are all kept.
   - The automatic opponent, which was paused on SETUP, resumes only after this explicit continue.
4. **Changing the mode reuses the existing control semantics exactly once, at the click.**
   - Turning the automatic opponent on or off behaves like the checkbox. It clears the staged card, the
     last automatic-turn record and the set's automatic-turn notes, and it stops the timer.
   - Switching my side while solo stays on behaves like the side select. It clears the staged card and the
     last automatic-turn record; the notes and timer are kept.
   - Choosing manual leaves `manualSide` as it is.
   - When something would be cleared, setup shows a short Korean notice before the user commits.
5. **Back to setup shows the actual current mode and side**, not a forced manual. It resets `setupChoice`
   to `null` and changes no mode or board state.
6. **Load paths keep the automatic opponent off and never enable it silently.**
   - Covered: startup restore, file import, share accept, practice-library load, `hashchange`/deep link and
     room join.
   - All of them keep the existing `setSoloEnabled(false)`, and they also drop any pending setup choice.
   - A restored notes side (`manualSide`) is shown under manual mode. Solo stays off on continue until the
     user explicitly selects a solo option.
   - In a room the control is disabled and the helper always resolves to manual.
7. **Fresh "my red" start.** When blue picks first, blue's first action intentionally auto-plays about
   600 ms after the click.
8. **Nothing new is persisted.** The autosave request is still `{ scenario, manualSide, records }`. Neither
   `soloEnabled` nor the setup choice is ever stored, shared or sent to a room.

## Files

| File | Change |
|---|---|
| `web/app/team-selection-flow.ts` | Adds `PracticeMode`, `currentPracticeMode` and `practiceModeChange`, all pure and import-free |
| `web/app/draft-lab.tsx` | Adds the `setupChoice` state and the setup fieldset; the conditional apply in `enterDraft`; the reset in `backToSetup`, `restoreSession`, the hash pause and room join |
| `web/app/draft-studio.css` | Adds `.draft-flow-mode`: existing palette, 44 px rows, wraps at 390 px |
| `web/tests/team-selection-flow.test.mjs` | Adds 3 tests: the helper matrix, the wiring source guards, and SSR (manual default, disabled until the session is ready) |

## Verification status

- **Not run.** No tests or commands were run while writing this change.
- **Codex checks the source and SSR tests** with `cd web && node --test tests/team-selection-flow.test.mjs`,
  then the full `npm test`.
- **Codex checks the following on PC and mobile:**
  - a solo RED start gives exactly one blue automatic action;
  - a manual start gives none;
  - going back pauses the automatic opponent;
  - continuing unchanged preserves the notes;
  - a reload keeps the automatic opponent off.

## Risks

- **Brittle source guards.** The new source-guard tests match exact JSX and handler text, as the existing
  tests in this file do. A harmless refactor of the draft-step checkbox or select will fail them on purpose.
- **Browser support for the selected-row border.** The border on the selected row uses `:has()`. In older
  browsers only the radio dot shows the selection, which is still usable.
- **Long team names.** They wrap within the row (`overflow-wrap: anywhere`); this has not yet been checked in
  a real 390 px capture.

## Codex independent verification

- Web635/635, Pages5/5, typecheck and full lint passed. No Python source changed since the previously verified879-test research integration.
- Native Chrome PC/mobile: initial24-case run passed23; one old mobile flow test toggled the automatic opponent off/on AFTER its resumed turn, deliberately clearing the very notes it asserted. It now waits for the real resumed turn directly, preserving the same board/notes assertions. Both PC/mobile reruns passed.
- Two additional PC/mobile incoming-hash cases verify a pending setup solo choice is discarded, preview is explicit and neither hash load nor accept enables auto.
- Across the completed runs,26 distinct targeted browser cases passed: manual default, deferred RED intent, one automatic BLUE action on explicit start, unchanged continuation notes, explicit mode-change clears at continue only, reload autooff, previous14 note-retention cases, storage recovery and shared previews. No product code was changed to accommodate test timing.
- The implementation-time SSR assertion expected a particular input attribute order; Claude corrected only the test to require the right radio/checked value regardless of order. The full web635 run includes that correction.
- A390px screenshot was inspected: labels wrap, controls are accessible, no horizontal document overflow. Original capture: outputs/setup-practice-mode-mobile-20261120.png (local, not a published artifact).
