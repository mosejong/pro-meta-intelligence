# Next functional slice review · 2026-11-20

Read-only review. No product/test edits, commands, network, git or provider requests. Sources read: INTERIM_RELEASE_AND_NEXT_STEPS (its paused-automation line is superseded), SETUP_FIRST_SELECTION, and targeted parts of `web/app/draft-lab.tsx` and `web/app/draft-result-panel.tsx` (via Grep).

## Observed (from code)
- When a set finishes (`selections.length === 20`), `DraftResultPanel` renders (`web/app/draft-lab.tsx:951`). It has exactly three actions: same-team replay, next Fearless set, and save result image (`web/app/draft-result-panel.tsx:62`). None of them opens the simulation.
- The simulation lives in a separate studio tab (`draft-lab.tsx:1044-1059`): `SimulationExamplePanel`, then `SimulationReadinessPanel` (fed the same `selections/games/firstPickSide/roster/positionRoles`), then `ExperimentReplayPanel` (runs only when you press its button).
- A focus-and-scroll route into that tab already exists, but only from A/B: `onOpenRoleAssignment` → `showStudioTab("SIMULATION", …)` focuses `.simulation-readiness-team select:not(:disabled)` or the readiness `summary` (`draft-lab.tsx:1036-1041`; helper `showStudioTab` at `:542`).
- On completion the details tab's agent panel says "완성된 결과를 저장하고 실제 경기 결과와 비교할 수 있습니다." (`draft-lab.tsx:1021`). This copy names neither the simulation nor any button.

## Not verified (assumptions)
- I did not check whether first-time users actually miss the SIMULATION tab. No user-study evidence was read. The gap is inferred from the missing control, not observed in use.
- I did not confirm what `SimulationReadinessPanel` shows on a fresh 20-pick board with positions unconfirmed. It is presumably a role-assignment gate, which is the intended next step.
- Mobile tab rail visibility of SIMULATION was not rendered.

## Candidates (max 3)
| # | Slice | Verdict |
|---|---|---|
| A | A "이 밴픽으로 가정 시뮬레이션 준비" action in `DraftResultPanel` that reuses the existing SIMULATION focus route | **Recommend.** This is the missing draft→simulation link. It needs no new data or model, and it computes or claims nothing. |
| B | Rewrite the COMPLETE copy at `:1021` to point to the simulation | Copy only. It does not give users a working control. Fold the wording into A if wanted. |
| C | Targeted boundary test only (20-pick state → readiness receives current selections) | This is the fallback if A is rejected. A should include it anyway. |

## Proposed delta (A)
- `web/app/draft-result-panel.tsx`: add an optional prop `onOpenSimulation?: () => void`. When the prop is present, render a 4th button "가정 시뮬레이션 준비" in `.draft-result-actions`. It uses the same `disabled` flag as the other buttons and has no other side effects.
- `web/app/draft-lab.tsx:951`: pass `onOpenSimulation={() => showStudioTab("SIMULATION", focusSimulationReadiness)}`. Pull the focus/scroll body at `:1036-1041` out into a local `focusSimulationReadiness()` so A/B and the result panel share one route. A/B behaviour stays the same.
- No new state, persistence, auto-run, outcome, win rate or champion/player effect. `ExperimentReplayPanel` still runs only when you press its own button. The button is hidden in room mode because the panel is already disabled when `room.active`. Pass `undefined` in room mode so the button is not shown there.
- Owned files: the two above, `web/tests/team-selection-flow.test.mjs` (or a new `web/tests/draft-result-simulation-link.test.mjs`), and one e2e spec, e.g. `web/tests/e2e/simulation-readiness.spec.mjs` (extend it).

## Acceptance (PC 1280 + mobile 390)
1. Complete a manual set of 20 → the result panel shows 4 actions. Pressing the new one selects the SIMULATION tab (`aria-selected`). Focus lands on the first enabled readiness role select, or on the readiness summary. The panel is scrolled into view.
2. Solo mode, completed with auto turns → same as 1. No extra auto action is triggered, and `selections.length` stays 20.
3. The readiness panel reflects the just-completed picks: champion names in its role selects match the board.
4. Nothing runs automatically: the experiment result region stays empty until its own button is pressed.
5. Room-active state: the button is absent. When `disabled`, the button is disabled.
6. From A/B, the "역할 지정" route still focuses the same target (regression check).
7. At 390px the 4 buttons wrap without horizontal overflow, and each tap target is at least 44px.

## Unit tests (meaningful, not counts)
- SSR of `DraftResultPanel`: with `onOpenSimulation` → button present with that label. Without it → absent. `disabled` propagates.
- Source guard in `draft-lab.tsx`: one shared `focusSimulationReadiness` is used by both the A/B and result-panel routes. The result-panel handler calls only `showStudioTab` (no `setSelections`, `setSoloEnabled`, timer or replay calls). The prop is not passed when `room.active`.

## Risks
- Adding a 4th action could crowd the result panel on mobile. Mitigation: acceptance check 7.
- If the readiness panel is collapsed or not ready on first open, the focus falls back to its summary. This is acceptable but should be confirmed in e2e.

## Next action
Implement A as a single small PR (Claude), with Codex verifying PC/mobile acceptance checks 1-7. Do not touch PR137, the private snapshot export, OE provider requests (cached sourceNov18; no request before 2026-11-21 18:48 KST), or the recommendation weights.
