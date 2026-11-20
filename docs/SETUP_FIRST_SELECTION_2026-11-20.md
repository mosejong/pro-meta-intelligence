# Setup first-selection control (2026-11-20)

Usability/discoverability improvement, not a correctness bug and not a new draft format.

## Problem
First selection (BLUE/RED) was only configurable on the DRAFT step. With setup solo mode the opponent may
auto-act 600 ms after the explicit start, so choosing a different first side required: start manual →
change first side → back → enable opponent → continue.

## Change
- `web/app/draft-lab.tsx`
  - `firstSideLocked = room.active || !canSelect || selections.length > 0 || Boolean(pendingChampion)` — the exact
    existing guard of the DRAFT-step select. `games.length` is intentionally not part of it: a new set may pick its
    first side while prior Fearless locks stay.
  - `chooseFirstPickSide(side)` — one guarded handler shared by both selects. Keeps the existing semantics
    (`setFirstPickSide`, freeze `seriesReport` if unset). No step/timer/mode/selection/staged/notes side effects.
  - SETUP: collapsed `<details className="draft-flow-options">` "경기 설정" between the practice-mode fieldset and
    the start button, with `<label className="draft-setup-first-selection">시작할 첫 선택 진영` and a select over the
    same `firstPickSide` state. Option text adds team names when available.
  - DRAFT-step select: same disabled condition and behaviour, now via the shared handler.
- `web/app/draft-studio.css`: restrained styles for the details/summary/select (44px targets, wraps at 390px, no card).
- `web/tests/team-selection-flow.test.mjs`: source guard (shared guard/handler, no side effects, two selects only,
  separate class/label, collapsed, auto turn still gated by `boardActive`) and an SSR check (collapsed, BLUE default,
  disabled before session ready, draft-step control not duplicated).

## Unchanged
No new state or persisted field; autosave/share/import/restore/room/Fearless carry `firstPickSide` as before.
Auto turns stay gated by `boardActive` (SETUP never acts), so a setup choice only takes effect after explicit start.
Staged cards are never discarded to enable the control; it is simply disabled while the current set has work.
No first-side guess from actual outcomes.

## Not run
Per task constraints no commands were executed: tests, typecheck, lint and the PC/mobile acceptance flow
(fresh manual BLUE no auto; SETUP RED first with my BLUE solo → zero actions until start then exactly one RED auto
action; reverse; board-back lock after an action; new set allows change with Fearless locks; reload restores side
with auto off) are for Codex.

## Risks
- Placement/visual fit at 390px is reasoned from CSS only, not rendered.
- The SSR `selected=""` option assertion relies on React's static rendering of controlled `<select>` values.
- The locked-state hint uses `hasCurrentWork`; when locked for room/not-ready reasons the generic hint is shown.

## Codex independent verification — 2026-11-20

- Local full web637/637, targeted flow12/12, typecheck/lint and Pages5/5 passed. No Python or recommendation-rule changes.
- Native Chrome PC/mobile:26 distinct targeted cases passed across completed runs (24/26 initially; both new-set cases passed after correcting the test capture). The first aborted attempt used getByLabel for a label containing option text; the browser exposed the correct combobox name, so the test now uses that exact accessible role/name. New-set tests had captured CSS-dependent innerText then compared DOM text; corrected to textContent. Neither issue required product changes or weaker board/lock/restore assertions.
- Both first-side combinations remain idle on setup and take exactly one opposing automatic action only after start. After an action both selectors lock. New set allows RED first while ten previous Fearless picks stay locked; a staged card locks configuration and survives back/continue and reload. Auto remains off after reload. Prior mode and14 notes-retention paths pass.
- Latest main9e47c8b7 changes only official schedule timestamps/hashes with events still empty; integrate it before publication. CI will validate the merged tree.
- Separate pending private-metadata export changes are in another worktree and not included. No collector, artifacts, new source, raw data or private archive code changed in this branch.
