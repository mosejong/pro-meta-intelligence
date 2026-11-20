# Next product usability audit (2026-11-20)

Scope: a review of the source and two captures for the deployed two-step journey: choose teams → start → solo
opponent → roles → save/share/rematch. This was **not** browser testing. Nothing was run, and no source,
package, test or other doc was changed. PR133's head and the files it owns are untouched.

Sources read:
- `web/app/team-selection-flow.ts`
- `web/app/draft-lab.tsx`: state, effects, the setup step, and the draft panel down to the share panel (about lines 1–909)
- `docs/USER_PRODUCT_VISION_2026-11-17.md`
- `outputs/team-flow-public-setup-mobile-20261120.png`
- `outputs/team-draft-screen-mobile-20261120.png`

## Verdict

- **No confirmed correctness bug** was found in this journey. Start gating (`draftStartBlock`), resuming
  saved work (`sessionHasDraftWork`), going back to setup without a reset, and turning solo off on restore,
  deep link and room all behave as their comments and help text describe.
- **One source-backed friction issue**, classified as a **design suggestion, not a bug**: the setup step
  never asks the novice which team is theirs or whether the opponent should play automatically. The
  automatic opponent exists, but it is off by default and can only be found inside the draft step.

## Finding: the "me vs opponent" choice is missing from setup

### Trigger
A first-time user picks two teams and presses "밴픽 시작".

### Source evidence (confirmed facts)

| Fact | Where |
|---|---|
| `soloEnabled` starts as `false`, and `manualSide` starts as `"BLUE"` | `draft-lab.tsx` ~249–250 |
| The setup step shows only the stepper, two `TeamChooser`s, the swap button, "밴픽 시작"/"밴픽 이어가기" (`enterDraft`) and an optional series reset. There is no side, "my team" or solo control | `draft-lab.tsx` ~787–804 |
| The solo checkbox "상대 자동 밴픽" and the "내 진영" select live only inside the DRAFT tab panel, below the studio tabs | `draft-lab.tsx` 831–835 |
| While solo is off, the help text says both teams are picked by hand: "끄면 양 팀을 직접 선택합니다." | `draft-lab.tsx` 836 |
| Solo is deliberately forced off by `restoreSession`, by `hashchange` and by joining a room | `draft-lab.tsx` ~364–368, ~391–395, 901 |
| Restoring notes brings back `manualSide` but leaves solo off | `draft-lab.tsx` ~424–437 |
| Mobile setup capture: two teams, "진영 교체", "밴픽 시작", and nothing about my team or the opponent | `team-flow-public-setup-mobile-20261120.png` |
| Mobile draft capture: the "상대 자동 밴픽" box is unchecked and sits under the tabs, away from the start action | `team-draft-screen-mobile-20261120.png` |

### Actual current behaviour
- After "밴픽 시작", the novice controls **both** sides for all 20 turns.
- That changes only if they notice and tick "상대 자동 밴픽" and set "내 진영".
- Vision item 6 says "나와 상대가 각각 팀을 고른다", but setup treats the two teams as just BLUE and RED.

### Why this is a design suggestion and not a bug
- Controlling both sides by hand is intended. The help text says so, and vision item 8 keeps manual control
  of both sides separate from remote rooms.
- The code is correct. The issue is that the solo mode is hard to find at the moment the user decides how
  they want to play.

## Minimal change (future task)

Add one compact choice to the setup step, directly above the start button:

- `양쪽 직접 조작`: the default, and identical to today's behaviour.
- `혼자 연습 — 내 팀: [BLUE 팀명 | RED 팀명], 상대 자동`

The choice is applied **only inside the explicit click handler** of "밴픽 시작" / "밴픽 이어가기":
- **Solo:** call `setManualSide(side)` and then `setSoloEnabled(true)`.
- **Manual:** set `soloEnabled` to false.

When the user presses start, use the same resets as the existing checkbox (line 833):
- `setPendingChampion(null)`
- `setLastAuto(null)`
- `setAutoHistory([])`
- `setTimerRunning(false)`

Rules:
- **Never applied automatically.** Restore, import, share-accept, deep link, `hashchange` and room join keep
  solo off, as they do today. Only the user's click on start turns it on.
- **Resuming work.** When "밴픽 이어가기" resumes existing work, the choice is preselected from the restored
  `manualSide` with solo shown as off. It changes state only if the user changes it and clicks.
- **Rooms.** The control is hidden or disabled when `room.active`, matching line 833.
- **Undo.** When the chosen mode turns solo on, existing selections are not modified. Undo keeps its current
  solo semantics (line 888).
- **Draft step.** The draft-step checkbox and select stay as they are. They remain the way to switch modes
  mid-draft, and "팀 선택으로" still resets nothing.
- **Saved data.** No change to the saved board, notes, share or room format: `soloEnabled` is not persisted
  today, and that stays the same.
- **Suggested helper.** A small pure helper in `team-selection-flow.ts` keeps the decision testable:

  ```ts
  startMode(choice: "MANUAL" | "SOLO_BLUE" | "SOLO_RED", roomActive: boolean)
    → { soloEnabled: boolean; manualSide: "BLUE" | "RED" }
  ```

  It forces manual when `roomActive` is true.

### Existing state and APIs reused
- `soloEnabled` / `setSoloEnabled`
- `manualSide` / `setManualSide`
- `enterDraft`
- `draftStartBlock` (start stays blocked for the same reasons)
- The solo auto-turn effect: `suggestSoloDraftTurn` with its 600 ms delay, gated by `boardInteractive`
- The team names already shown by `TeamChooser`

No new data, prediction logic, weights, API, translation or external service is needed. The new strings
are Korean, like the solo strings around them.

## Acceptance tests

Unit test, extending `web/tests/team-selection-flow.test.mjs` with the helper:
- `MANUAL` returns solo off.
- `SOLO_RED` returns solo on with side RED.
- Any choice with `roomActive` returns solo off.

The existing tests that keep solo off on restore stay green.

Manual checks, on PC (≥1280 px) and on mobile (≈390 px):

1. Setup shows the choice next to the start button without horizontal scroll. The default is `양쪽 직접 조작`.
2. Choose `혼자 연습, 내 팀 = RED` and press start:
   - on the draft step, the "상대 자동 밴픽" box is checked and "내 진영" is 레드;
   - blue's first ban auto-plays after about 600 ms;
   - red's turns wait for the user.
3. Press start with the default: both sides are manual, exactly as in today's captures.
4. Go to "팀 선택으로" and come back: the board, the selections and the solo state are unchanged.
5. Reload with saved work: the draft resumes with solo **off** and the notes are intact. Nothing auto-plays
   until the user explicitly chooses solo and clicks "밴픽 이어가기", or ticks the box.
6. Open a share link or deep link, or join a room: solo stays off, and in a room the setup choice is
   unavailable.
7. Finish all 20 turns in solo mode: the result panel auto-reveals as it does today (line 893), and
   rematch/next game keeps working.

## Benefit independent of prediction quality

- The vision's core flow, "I pick my team, the opponent plays", becomes reachable in a single click at the
  moment of intent.
- It uses an opponent that already exists. It makes no claim about better predictions and does not depend
  on any unproven rule change.
- Users who prefer manual control of both sides see no difference.

## Out of scope
- Statistical weights or rule changes based on the 9 observed matches.
- Billing, a paid API, translation work, or new data collection.
- A live external room service.
- Persisting `soloEnabled` across reloads (deliberately not done; see the restore comments).
