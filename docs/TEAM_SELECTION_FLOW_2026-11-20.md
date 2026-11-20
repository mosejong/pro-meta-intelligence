# Team selection → draft screen (two-step flow) · 2026-11-20

Claude implemented; Codex verifies. No commands, tests, git or network were run. All edits are in the interim-release worktree.

## Behaviour
- **Step 1 · team selection (fresh visit):** shows a step indicator, a short heading, the existing BLUE/RED `TeamChooser`, the side swap and one primary **밴픽 시작** button.
  - The page header and language control stay.
  - The studio (rail, all five panels, board) stays **mounted** in `.draft-flow-draft` but is `hidden` and `inert`.
- **Start gate** (`draftStartBlock`) requires all of the following:
  - restore finished and data usable (`sessionReady` and a frozen report or a connected feed);
  - not importing;
  - no active room;
  - two valid, distinct team IDs.
  - Roster and simulation readiness are not required.
  - Defaults stay preselected but never auto-start.
  - A disabled start shows a one-line reason (`#draft-flow-start-note`).
- **Step 2 · draft:** a compact matchup header (step indicator, `Blue vs Red` heading, **팀 선택으로** button), followed by the unchanged studio. The big pickers exist only in step 1.
- **Back to setup:**
  - Resets nothing: board, staged pick, roles, roster, games, frozen report, notes and A/B all stay.
  - Pauses the timer.
  - The board gate `boardActive = canSelect && step === "DRAFT"` closes:
    - the auto-opponent effect, whose dependency change clears the pending 600ms timeout;
    - the timer tick;
    - stage/confirm;
    - role assign/confirm;
    - the agent panel and the simulation example.
  - The button is disabled while a room is active.
- **Returning with work:**
  - The heading reads "진행 중인 밴픽이 있어요". The button becomes **밴픽 이어가기**, and the existing `draft.setupHint` lock note shows.
  - The pickers stay disabled by the existing `changeTeam`/`swapSides` guards.
  - An optional **시리즈 초기화** opens the existing SERIES reset confirmation dialog. There is no silent reset.
- **Startup restore:** a saved session with selections, a staged pick, previous games or explicit roles/unassigned picks opens the draft step (`sessionHasDraftWork`). Notes restore and auto-off are unchanged. An empty autosave keeps the gate.
- **Other entry paths:** these open the draft step through their existing handlers:
  - deep links `#draft=…` / `#room=…` (read in a deferred effect plus `hashchange`; the fragment is never mutated and nothing is auto-accepted);
  - room activation and snapshot;
  - share accept;
  - file import;
  - named practice load.
  - The generation guards stay the first statement where they were.
- **Focus and IDs:**
  - Explicit start and back focus the step heading by ref (`tabIndex=-1`) and call `scrollIntoViewGently`, which respects reduced motion.
  - Restores and deep links never move focus.
  - `#draft-workspace` sits only on the visible step, so there is never a duplicate.
- **Header intro:** the existing `draft.intro` paragraph is `hidden` on setup and shown on the draft step. Its text is unchanged.
- **Footer:** `.studio-preview-footer` gets an explicit studio background, line and muted text, overriding a global bright-blue footer. The Riot notice wording is unchanged and stays visible.
- **CSS:** narrow `.draft-flow-*` rules in `draft-studio.css`.
  - Buttons are ≥44px; setup actions are 48px.
  - Actions go full width at ≤600px, and the setup column is capped at 760px.
  - The palette is the existing studio one, with no hero cards.

## Files
- `web/app/draft-lab.tsx` (step state, gates, views, entry paths)
- `web/app/team-selection-flow.ts` (NEW, pure helper):
  - `draftStartBlock`
  - `sessionHasDraftWork`
  - `isDraftDeepLink`
  - `boardInteractive`
  - `DRAFT_START_BLOCK_TEXT`
  - `DraftFlowStep`
- `web/app/draft-studio.css`
- `web/tests/team-selection-flow.test.mjs` (NEW), registered by literal path in the main `npm test` list and also runnable alone with `npm run test:team-flow`
- The header save-failed flag (`focusSaveRetry`) is an explicit user shortcut. It reveals the draft step, then focuses the retry. Background callbacks never switch steps.
- `web/tests/e2e/studio-panels.mjs`: adds the `enterDraftWorkspace(page)` helper. It is a real user click, waits for the final restored step, and leaves the existing helpers unchanged.
- `rendered-html.test.mjs` was not changed. Its home-page assertions still hold, because the panels stay mounted with the same per-panel `hidden` state and there is exactly one `.draft-match-setup` before the draft panel. Codex should confirm.

No storage, schema, share, room, model, dependency or lock changes. The step is memory-only.

## E2E entry migration identified during implementation (subsequently completed by Codex)
Specs that `goto(root)` and then wait for `.draft-stage` to be non-inert now wait forever on fresh state, because the board is gated on the setup step. They should call `enterDraftWorkspace(page)` after load (and after reloads with an empty board):
- ab-real-evidence, ab-player-evidence
- draft-studio (×4)
- experiment-batch-core, experiment-comparison, experiment-replay
- guest-club (×6, including the second page)
- historical-readiness-core, neutral-navigation
- player-pool (×2), player-season (×2)
- publication-reliability (×3)
- roster-workshop (×2), season-lineup (×2)
- simulation-player-evidence, simulation-readiness
- studio-layout-review, studio-polish (×2), studio-sidetabs, workspace-storage (×2)

Further assumptions:
- `neutral-navigation` and `player-season` click or read `.draft-match-setup .team-chooser-trigger`. These are only visible on the setup step: change teams before starting, or go back with **팀 선택으로**.
- `studio-sidetabs` expects `.draft-match-setup` count 1 and none inside `.studio-shell`. This still holds.
- Specs that reload expecting a restored board are fine when the board has work. Reloads of an empty board return to setup.

## Not run / risks
- Claude did not run commands during implementation. Codex independently ran verification; see the dated integration section below.
- Risk: `inert` on the outer setup/draft wrappers relies on React 19 boolean `inert` (already used in this file).
- Risk: the deep-link effect also switches the rail to the DRAFT tab so the share/room UI is visible.
- Risk: the reset dialog opened from setup lives outside both steps, so it works from either step.
- Risk: the locale test's skeleton comparison should be unaffected, because the new copy is Korean-only and identical across locales. Codex should confirm.
- Risk: `exampleBlockReason` now receives `canSelect: boardActive`. It is only visible on the draft step.

## Codex integration verification — 2026-11-20

- Final product after board-first reorder: typecheck, lint, web 564/564 and Pages 5/5 passed.
- Native Chrome PC/mobile: first final run 11/12 passed; one desktop next-set restore readiness helper exceeded its 15-second budget even though the restored screen appeared. The helper now waits up to the established 45-second startup budget for the visible back button or enabled start action. Both PC/mobile keyboard + next-set Fearless restore cases passed on rerun (2/2). This is a test startup wait change, not a product data/state bypass.
- Other final checks passed on both sizes: select teams/start; back interrupts pending automatic action; continue/reload preserves board and notes; save-failure recovery shortcut; shared-link preview requires explicit acceptance; named/shared identical-board load clears private prior notes.
- Prior to the board-first reorder, 32/32 scoped PC/mobile restore, A/B, notes and role regressions passed. Those are a separate checkpoint, not a claim that the entire E2E library was rerun after the reorder.
- Shared test helpers/specs were migrated to explicit real setup/start actions; the history panel moved after the board and tests now locate its actual visible component. The latest global lint passed.
- Board precedes management/share/library. Setup and current draft screenshots were independently captured at 390px and 1440px. Existing Riot notice is preserved.
- This feature remains local and has not been deployed. Previously authorized intermediate deployment was PR #131 at a811a8fb.

- Additional post-reorder PC/mobile retention coverage: 10/10 passed (BLUE/RED notes restore without automatic opponent restart, corrupt notes preserve the board, undo/manual-side pruning persists, reset/import restores only appropriate data). Combined with the four identical-board load checks in the prior final run, all 14 targeted notes-retention checks passed after reorder.
