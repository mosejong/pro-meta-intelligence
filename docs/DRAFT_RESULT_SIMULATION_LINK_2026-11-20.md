# Draft result → simulation link (2026-11-20)

Implements candidate A from `docs/NEXT_FUNCTIONAL_SLICE_REVIEW_2026-11-20.md`. Navigation only.

## Change
- `web/app/draft-result-panel.tsx`: optional `onOpenSimulation?: () => void`. If provided, a 4th action
  `<button class="draft-result-simulation">가정 시뮬레이션 준비</button>` is rendered after the image button, with
  `disabled={disabled}` (same flag as the other actions). Omitted → not rendered; the three existing actions are unchanged.
- `web/app/draft-lab.tsx`
  - New `openSimulationReadiness()` next to `showStudioTab`: the former inline A/B body moved verbatim
    (select SIMULATION → focus first enabled `.simulation-readiness-team select` or `.simulation-readiness > summary` → `scrollIntoViewGently`).
  - A/B `onOpenRoleAssignment={openSimulationReadiness}` (same behaviour, shared helper).
  - `DraftResultPanel … onOpenSimulation={room.active ? undefined : openSimulationReadiness}`.
- `web/tests/team-selection-flow.test.mjs`: one test — SSR of the READY result (fixture as in `draft-result-image.test.mjs`)
  asserts: no callback → no button and exactly 3 buttons; callback → button with label, enabled; `disabled` → `disabled=""`;
  rendering invokes no callbacks and does not mutate selections. Narrow source checks: helper calls `showStudioTab("SIMULATION"`
  and no draft/position/solo/timer/roster/ready-input setters; A/B and result both use the helper; room mode passes `undefined`.

## Unchanged
No CSS change: `.draft-result-actions` already `flex-wrap: wrap` and `.draft-result button { min-height: 44px }` (`web/app/solo-draft.css:23-24`).
No new state/persistence/room protocol. No simulation, experiment, recommendation, data or storage change. `ExperimentReplayPanel`
still runs only on its own button; no automatic result, percentage or champion/player/item effect is shown. Readiness inputs are
the existing props (`selections/games/firstPickSide/roster/positionRoles`). Assumption limits of the simulation panel remain.

## Not run (no commands per task)
Unit tests, typecheck, lint, Pages build, and PC(1280)/mobile(390) interaction are for Codex:
1. Manual 20-pick set → 4 actions; pressing the new one selects SIMULATION (`aria-selected`), focus on first enabled role select or readiness summary, scrolled into view.
2. Solo completed set → same; no extra auto action; selections stay 20.
3. Readiness shows the just-completed picks.
4. Experiment result empty until its own button.
5. Room active → button absent; `disabled` → disabled.
6. A/B "역할 지정" route still focuses the same target.
7. 390px: 4 buttons wrap, no horizontal overflow, ≥44px targets.

## Risks
- SSR fixture assumes `sampleReport` teams + the 20 ids give READY (same assumption the image/report tests already rely on).
- The source checks slice `openSimulationReadiness` up to the `/** Rail selection` comment; moving that comment breaks the test, not the product.
- Focus timing relies on the existing `showStudioTab` `setTimeout(0)` behaviour, unchanged from the A/B route.

## Independent verification checkpoint
- Related team-flow/SSR tests13/13 and existing report/image tests15/15 passed.
- Typecheck, complete ESLint and Pages5/5 passed. Independent e2e spec lint passed.
- Codex owns `web/tests/e2e/draft-result-simulation-link-review.spec.mjs`: manual and solo actual20-turn completion, same five champion names per side in all five role selectors, explicit missing-role gate, no auto experiment, shared A/B focus route, unchanged20turns, 44px targets and no horizontal overflow/page errors.
- The first browser attempt was stopped because the test omitted opening the collapsed A/B evidence panel. The test now follows the visible disclosure before clicking its role-assignment link; product source was unchanged.
- Real room-active behavior is guarded in source/SSR; this batch does not claim a live friend-room deployment or room end-to-end verification.
- No actual model effects, win accuracy, user utility or real-player strength are established by these interaction checks.

Local native Chrome: 4/4 passed (desktop/mobile × manual/solo), 1.5 minutes. Public deployment not yet claimed at this checkpoint.
