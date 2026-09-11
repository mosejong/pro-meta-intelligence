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

## Next validation

The next Draft Lab gates are:

1. add a format registry for tournaments that use fearless or modified series rules;
2. validate role assignment, composition tags, and counter relations against maintained sources;
3. compare agent options with analyst decisions on hidden draft states;
4. measure top-k option recall, illegal-action rate, edit burden, and time saved;
5. add series-level used-champion memory only after the competition format is explicit.
