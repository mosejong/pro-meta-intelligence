# Current draft rule: failure classes and next gates (2026-11-20)

Status: **diagnostic planning after an already-observed cohort. This is not a validation result.**
The 9-match / 180-state first-set cohort (2374 inputs, fcd2 outcomes) has now been looked at by
both the baseline run (frozen at 30525faf) and the season run (after 96712294). It can't be used
for confirmation again.

What this document does not claim:
- why teams drafted what they drafted;
- that what teams actually drafted was optimal;
- that any weight should change.

All counts below are aggregate tallies from the private per-state outputs
(`outputs/current-rule-evaluation-20261120.json` and
`outputs/current-rule-season-evaluation-20261120.json`). Champion IDs were canonicalized before
comparison. The doc contains no match, team or player IDs.

## 1. Observed totals (both runs)

| | Baseline (`seasonHistory = null`) | Season (2374 cutoff, 221 players) |
|---|---|---|
| top1 / top3 | 11 / 25 of 180 | 11 / 25 of 180 |
| BAN top1 / top3 | 5 / 7 of 90 | 5 / 7 of 90 |
| PICK top1 / top3 | 6 / 18 of 90 | 6 / 18 of 90 |
| illegal, abstain, short lists | 0, 0, 0 | 0, 0, 0 |
| top-1 source TEAM_RECORD / RADAR / PLAYER_SEASON | 166 / 14 / 0 | 88 / 16 / 76 |
| pick_role_unsupported | 4 | 0 |

The 180 states are not independent observations:
- they are clustered within only 9 matches;
- many states repeat the same list (class F4 below).

No effective sample size is estimated here.

## 2. Failure classes that can be checked from the per-state lists alone

The tallies in this section are from the **season-path** `case_results`.

| ID | Class (mechanical definition) | Count |
|---|---|---|
| F1 | Miss, and the actual was **never in any top-3 list in that match** (either side, any turn) | 137 / 155 misses |
| F2 | Miss, and the actual **had been offered at an earlier turn in the same match**, but is not in the current top-3 | 18 / 155 |
| F2a | ...of which all earlier offers were in lists whose *target* was the other team (ban lists target the opponent; pick lists target the acting team) | 15 / 18 |
| F2b | ...of which an earlier offer was in a list targeting the same team | 3 / 18 |
| F2c | Miss, and the actual was offered only at a *later* turn in the same match | 0 in this cohort (an observed count, not a logical impossibility) |
| F3 | The actual never appears in **any** of the 540 candidate slots across all 9 matches (a top-3 vocabulary gap, 20 distinct champions) | 56 / 180 states |
| F4 | The list is identical to the same side's previous list of the same kind in that match | BAN 49 / 72 eligible; PICK 17 / 72 eligible |
| F5 | Late picks: both sides get the identical list on adjacent turns | 4 pairs (8 PICK states) |

Notes on these classes:
- **F1 and F3 don't tell us whether the champion was absent from the pool or present but ranked
  below 3.** The run output records only the top-3, so the pool cannot be inspected. F3 is not
  evidence of "absent from pool"; telling those two cases apart is gate G1.
- **On F4:** the counts don't show *why* a list did or did not change. Availability and
  `frame.options` both feed the ordering (see section 3), so the counts alone can't attribute a
  change to a single cause.

### Season run vs baseline

- **Bans:** all 90 ban lists are identical between the two runs.
- **Picks:** 10 of 90 pick lists differ, all of them in phase 2 or at late pick turns.
  - The top-1 champion changed in 4 states.
  - Hit/miss status changed in **0** states.
- **PLAYER_SEASON label:** at least 72 of the 76 PLAYER_SEASON top-1 selections are the same
  champion the baseline selected as TEAM_RECORD. So the season path mostly changed the source
  label, not the choice.
- **What "season evidence in 180 states" means:** season rows were available in all 180 states. It
  does not mean season rows decided 180 states.

## 3. Known rule ordering (read from `web/app/solo-draft.ts`, `web/app/solo-role-candidates.ts`)

1. **BAN:** the candidates come from `records` only. `records` is the opposing team's
   `priority_picks`, with any of those champions that are also in `frame.options` placed first. The
   rest are ordered by `game_rate` desc, then `phase_1_count`, then id, and everything is filtered
   to available champions.
   - Bans never consult meta, player profiles or season rows unless `records` is empty.
   - This is consistent with the ban lists being identical between runs. It does not by itself
     explain the pattern in F4.
2. **PICK:** `expanded` is built in this order, filtered to available champions:
   1. team records that are meta-eligible;
   2. **all** review-eligible meta, by rank;
   3. the remaining team records;
   4. role candidates (current profiles, then season rows).

   The first role-feasible entry is chosen. Because meta comes before non-meta team records, late
   pick lists can be team-independent; this is consistent with F5, but not proven by it.
3. **Pick source labels**, in order of precedence:
   - RADAR if the champion is meta and not in the team's priorities;
   - otherwise PLAYER_SEASON if it has a season role row;
   - otherwise TEAM_RECORD.

   This precedence is enough to move a TEAM_RECORD champion to PLAYER_SEASON without changing the
   choice.
4. **Season rows:**
   - They come from the **acting** team's roster, even on bans, which is why the season-evidence
     flag is set in every state.
   - They are admitted only if the cutoff, patch, year and `retrieved_at <= cutoff` all match, and
     only for a single FOUND current player per role.
   - They affect picks only through role feasibility and as the last fallback.

## 4. Prioritized next implementation gate

**G1 (do next): pool-membership diagnostics only, with no rule or weight change.**

Where it lives: an instrumentation function in the research evaluator lib (not production). It
replays each state through the same `explainSoloDraftTurn` inputs and emits, for the actual
champion only:
- its rank in the target team's `priority_picks`, and in `records` after availability;
- whether it is in `frame.options`;
- its meta rank;
- its presence in role candidates (current, season), with role;
- its index in `expanded`;
- `roleFeasible(actual)`;
- the season-row count of the acting team.

It derives these per-state classes:

| Class | Definition |
|---|---|
| `POOL_ABSENT` | Not in the target priorities, meta or role candidates |
| `IN_POOL_RANK_GT_3` | In the pool, but ranked below the top 3 |
| `ROLE_FILTERED` | Would rank in the top 3 but fails `canCoverRoles` |
| `BAN_SOURCE_LIMIT` | A ban whose actual is in the target's role candidates or meta but not in its `priority_picks` |
| `CROSS_TARGET_ONLY` | Present only in the other team's pool |

Acceptance for G1:
- (a) Re-running the baseline and season protocols produces byte-identical `case_results` and
  summaries.
- (b) Fixture tests cover each class.
- (c) The committed output is aggregate-only (class counts by kind and phase). Per-state rows stay
  under `outputs/`.
- (d) Running G1 on this cohort is labelled descriptive. No rule change may be justified only by
  the G1 counts from these 9 matches.

**G2: any rule change. BLOCKED until G1 is accepted and section 5 can run.**

Write the change against class definitions, not against these cases. Freeze it in a commit before
any new outcome capture is opened.

## 5. Evaluation design on later, untouched physical captures

**Status: BLOCKED. No qualifying capture pair is asserted to exist.**

**Inputs required:**
- **Input capture:** a physically retrieved source file whose recorded `retrieved_at` and content
  hash were stored at retrieval time, retrieved **after fcd2** and before every target match.
- **Outcome capture:** a separate physically retrieved file, retrieved after the target matches.
- **Hashes:** neither hash may be 2374, fcd2 or any other already-observed hash.
- **No backdating:**
  - Filtering a later file to an earlier date does not count as an input capture.
  - Re-stamping a retrieval time does not count either.
  - If either capture is missing, the run is recorded as `BLOCKED_NO_CAPTURE`. Don't substitute a
    proxy.

**Frozen in one commit before the outcome capture is opened:**
- the cohort definition:
  - the calendar/event window;
  - the selection and exclusion rules (confirmed first-set games only; each match absent from every
    earlier capture; same-patch training required);
  - the minimum match count;
- the rule version and evaluator version;
- k = 3;
- the metrics:
  - top1 and top3 by kind and side;
  - the abstain and illegal rates;
  - the G1 class distribution;
- the baseline-vs-season comparison as a pre-specified secondary analysis;
- exact binomial intervals;
- no thresholds tuned on this cohort.

**Cohort size:** the actual eligible cohort size can't be known until the outcomes are in.

- Report the actual cohort and every exclusion count as they turn out.
- If the frozen minimum match count isn't reached, report `UNDERPOWERED`, not a result.
- Never widen, narrow or shift the window afterwards to reach a sample size or a desired score.

**Reporting:**
- The result is concordance with the observed drafts, not quality or optimality.
- States are clustered by match; this is stated explicitly.
- The fcd2 cohort is listed as observed and excluded.

## Verification note

Codex independently recalculated this taxonomy from canonicalized season-path `case_results`,
using the production `championAssetId`.

**Confirmed:**
- F1 = 137, F2 = 18;
- F2c (later-only) = 0;
- F3 = 56 states / 20 distinct champions;
- F4 BAN = 49 / 72;
- F5 = 4 pairs / 8 states;
- changed pick lists = 10, changed top-1 = 4, hit-status changes = 0.

**Corrected from the first draft of this doc:**
- F2a: 14 → 15;
- F2b: 4 → 3;
- F4 PICK: 16 → 17 / 72.

**Wording corrections:**
- Removed the claim that ban lists change only when one of their own entries becomes unavailable,
  because `frame.options` also contributes to ordering.
- Replaced "logically impossible" for later-only offers with an observed count of 0 in this cohort.
- Dropped the implied effective-sample-size estimate.
- Changed the future design to freeze the window, the selection rules and a minimum match count,
  rather than the cohort size.
