# Draft Lab

Draft Lab is an interactive, evidence-bounded draft scenario workspace. It reproduces the standard
professional 5-ban / 5-pick turn order instead of presenting a static recommendation card.

## Turn contract

The deterministic sequence contains 20 actions:

1. blue and red alternate three first-phase bans;
2. blue picks once, red picks twice, blue picks twice, and red completes the first pick phase;
3. red and blue alternate two second-phase bans;
4. red picks once, blue picks twice, and red makes the final pick.

Every champion becomes unavailable immediately after a pick or ban. Undo removes only the latest
action, and changing either team or side clears the scenario so evidence from two contexts cannot be
silently mixed.

The champion grid sits between the two team boards. Clicking a champion or an agent option only
stages that champion; the analyst then presses the ban/pick confirmation button to advance the turn.
Undo, reset, and team changes clear the staged choice. Search filters the same shared champion grid.

## Draft Agent v1

The first agent is deterministic. On every turn it reads only:

- the selected teams' same-patch public priority picks and phase-one counts;
- their public pick evidence IDs;
- eligible Global Meta Radar entries and their evidence IDs;
- already locked champions and the active side, phase, and action.

It returns at most three distinct options:

- **Safe** — the strongest directly observed team tendency relevant to the action;
- **Pressure** — a contested, early-phase, or globally reviewed option that may constrain the next
  rotation;
- **Experiment** — an eligible Radar candidate that requires an explicit practice question.

The score is only a deterministic sorting value. It is not shown as win probability. A global-only
candidate cannot receive medium or high evidence confidence without a directly relevant team event.

## Human and AI boundary

The analyst always confirms the champion. The agent does not auto-lock a pick, infer scrim results,
claim composition synergy, estimate champion mastery, or predict the selected team's intent.
Provider-backed generative AI remains disabled until the paired human holdout gate passes.

Scenario JSON records the immutable patch, cutoff, teams, format, and completed turn sequence for a
later review. A later phase can reconcile this record against an actual game without changing the
original scenario.

## Staged opponent preview and reproducibility

A staged champion is shown with a dashed border in its current slot. Before confirmation, the
preview excludes it and all locked champions, then shows up to three candidates for the opposite
side's next PICK turn. It does not fill unplayed intervening turns: their number is displayed.
There is no preview when that side has no remaining pick. Cancellation leaves the committed draft intact.

The preview ranks observed team picks by rounded game rate times 10,000, plus phase-one count times
10 and the bounded eligible Radar rank contribution `max(0, 35 - rank)`. Global-only candidates retain
low confidence. This is a public-frequency heuristic, not a calibrated probability, composition model,
or learned response to the staged champion. Changing a staged champion changes availability; it does
not invent counter relations. Ties use canonical champion IDs, with no random or time-dependent input.

The first staged choice captures the report for the entire series. Undo, current-game reset, side
swap, and series reset retain that report. A page reload restores the captured report from local
IndexedDB after a successful save, and pauses the timer. When storage is unavailable, the UI reports
that explicitly and JSON export/import remains available. Schema-v2 exports
include the full public analysis snapshot, model version, previous games, and computed locks so that
the same model and inputs can reproduce the result independently of later feed updates. The staged,
unconfirmed choice is included. Import is local-only, bounded to 16MB, and validates the report,
model version, team pairing, all turn positions, duplicate locks and completed prior games before
replacing the current session. Locks are recomputed from prior picks. Invalid files preserve the
current work; an incompatible model version is rejected instead of silently changing its analysis.

Model `fearless-preview-v2` separates target-team evidence from eligible global Radar evidence.
Confidence counts unique target-team events; global-only observations never describe those events
as that team's own picks. Ties include canonical ID, role, counts and evidence IDs to eliminate
dependence on source row order, including duplicate champion-role rows.

## Hard Fearless series

This workspace uses both-team, all-prior-game pick restrictions, following the format described in
[Riot's LCK format announcement](https://lolesports.com/ko-KR/news/2025-lck-new-format/).
Each game still has the standard 20 actions. Only a complete, valid game can be saved and advanced.
Its ten picks become unavailable for both sides' picks and bans in every following game; its ordinary
bans do not carry forward. The engine, manual grid, agent, and opponent preview share these locks.

Side swap retains prior-game locks. Team replacement is disabled after saving a game; start a new
series to change the matchup. Current-game reset preserves history, while series reset clears it.
An empty new game can reopen the preceding game for correction, removing that game's locks until it
is saved again. This is a draft rehearsal: advancing records a completed draft, not an observed match
result. It does not infer previous sets from the public feed or support tournament-specific exceptions.

## Next validation

The next Draft Lab gates are:

1. add a format registry for tournament-specific exceptions to Hard Fearless;
2. validate role assignment, composition tags, and counter relations against maintained sources;
3. compare agent options with analyst decisions on hidden draft states;
4. measure top-k option recall, illegal-action rate, edit burden, and time saved;
5. validate opponent-preview ranking against held-out real drafts.
