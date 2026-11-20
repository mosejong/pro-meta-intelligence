# Current draft rule: G1 pool-membership diagnostics (2026-11-20)

Status: **descriptive research tooling.**
- No rule, weight, threshold, evaluator, product, package or schema change.
- No new accuracy claim.
- The 9-match / 180-state cohort (2374 inputs, fcd2 outcomes) was already observed. Running G1 on it is
  descriptive only: no rule change may be justified by G1 counts from these 9 matches (G1 acceptance (d)
  in `CURRENT_DRAFT_RULE_FAILURE_NEXT_GATES_2026-11-20.md`).

This doc defines the tool and its semantics. It records **no cohort counts**: Codex runs the tool. The
committed summary, if one is added later, is the aggregate-only `*.summary.json`.

## Files

| File | Role |
|---|---|
| `web/tests/current-draft-pool-diagnostics-lib.mjs` | Diagnostics library |
| `web/tests/current-draft-pool-diagnostics.test.mjs` | Synthetic tests |
| `ops/current-draft-pool-diagnostics.mjs` | CLI |

Unchanged and imported as-is: `current-draft-evaluation-lib.mjs` (frozen at 30525faf),
`current-draft-season-evaluation-lib.mjs`, and every `web/app/*` module.

## How states are captured

1. The frozen evaluator runs **as-is**: `evaluateCurrentDraftRules` for BASELINE, and
   `evaluateWithSeasonEvidence` for SEASON when evidence is supplied. A pass-through recorder around
   `explainSoloDraftTurn` copies each input and output. So every evaluator gate applies:
   - the dataset schema and the preparer audit;
   - the 2374 input and fcd2 outcome hashes and retrieval times, and the forbidden 76b7 hash;
   - cutoffs before the target match, and the target match absent from evidence;
   - the standard draft order;
   - for SEASON, the season-evidence dataset hash, source, cutoff, year, roster and history hash.
2. **Byte identity.** The full evaluator result is serialized with `JSON.stringify` three times: a plain
   run before diagnostics, the recorded run, and a plain run after. All three must be equal, and the
   dataset must be unchanged; otherwise the run throws. The output records this as `byte_identity`.
3. **Alignment.** Each recorded call is aligned with its `case_results` row. The run checks that:
   - the recorded `selections` equal the match's chronological prefix (`turn − 1` actions);
   - the recorded candidates equal the row's candidates.
4. **No future information.** Facts come only from the recorded input (prefix, teams, report, season
   history) and the unchanged production functions:
   - `buildDraftAgentFrame`, `nextDraftTurn`, `applyDraftSelection`, `isChampionLocked`;
   - `soloRoleCandidates`, `canCoverRoles`;
   - `championAssetId` + `SHARE_CHAMPIONS` canonicalization.

   The actual action is used only as the query id and the class label. Later actions, roles and lineups
   are never read.

## Per-state facts (all exact)

"Target" is the team whose records the rule reads: the **opponent for bans**, the **acting team for
picks**. "Non-target" is the other team. For bans, the acting roster is the non-target.

| Fact | Meaning |
|---|---|
| `actual_legal_in_prefix`, `actual_locked_in_prefix` | Production `applyDraftSelection` / `isChampionLocked` on the prefix |
| `target_priority_rank` / `_size` | 1-based rank in the target `priority_picks`, with production sort and canonical dedup; null if absent |
| `records_rank` / `_size` | Rank in production `records`: frame-option priorities first, filtered to available champions |
| `non_target_priority_rank` | The same, in the other team's `priority_picks` |
| `meta_rank` / `_size` | Rank among review-eligible entries, production order |
| `frame_option_lane` | SAFE / PRESSURE / EXPERIMENT if the actual is a frame option, else null |
| `target_role_candidate`, `non_target_role_candidate` | `present`; `current` (present without season history); `season_row` (a season row was merged in); `roles` |
| `expanded_rank` / `_size` | Picks only: rank in production `expanded` (the source order before role feasibility) |
| `role_feasible` | Picks only: `canCoverRoles(prefix picks of acting side, rolePool, actual)`; null for bans |
| `acting_season_candidate_count` | Acting-team role candidates carrying a season row |
| `production_season_evidence` | Production's `season_evidence` |

## Primary classes: disjoint and exhaustive

Exactly one class per state, decided in this order.

| Class | Definition |
|---|---|
| `ABSTAIN` | Production returned null, and so did the reconstruction |
| `NOT_COMPUTABLE` | Facts can't be stated exactly. The reason is recorded: reconstruction null-ness differs from production; reconstructed turn differs; actual locked or not legal in the prefix; actual not canonical |
| `TOP3` | Actual is in production's 3 candidates |
| `BAN_TARGET_PRIORITY_BEYOND_TOP3` | Ban; actual is in the target's priorities, so it is in `records` at rank > 3 |
| `BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE` | Ban; not in the target's priorities, but in the target's role candidates or current meta. Bans never read those sources unless `records` is empty |
| `BAN_NOT_IN_TARGET_SOURCES` | Ban; in none of the target's priorities, role candidates or meta |
| `PICK_NOT_IN_POOL` | Pick; not in the acting priorities, meta or acting role candidates. This is exactly the `expanded` source set, and the code asserts the equivalence |
| `PICK_IN_POOL_ROLE_INFEASIBLE` | Pick; in the pool, but `canCoverRoles` is false |
| `PICK_IN_POOL_FEASIBLE_BEYOND_TOP3` | Pick; in the pool, role-feasible, not in the top 3 |

How these relate to the G1 sketch:
- `POOL_ABSENT` → `PICK_NOT_IN_POOL` / `BAN_NOT_IN_TARGET_SOURCES`.
- `IN_POOL_RANK_GT_3` → `*_BEYOND_TOP3`.
- `BAN_SOURCE_LIMIT` → `BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE`.
- `ROLE_FILTERED` is narrowed to `PICK_IN_POOL_ROLE_INFEASIBLE`. It does **not** claim the champion
  "would rank top 3"; that counterfactual isn't stated.
- `CROSS_TARGET_ONLY` is a flag, not a class (see below).

Ranked beyond 3 is never labelled absent. Absence means "not in the sources the rule reads", not
"outside the top 3".

## Flags: non-exclusive

Flags are counted only for computable states, and any number can be true for a state.

| Flag | Meaning |
|---|---|
| `in_frame_options` | Actual is a frame option |
| `in_non_target_team_sources` | Actual is in the other team's priorities or role candidates |
| `non_target_sources_only` | Actual is in the other team's sources and in none of the target's (the G1 `CROSS_TARGET_ONLY`) |
| `acting_season_candidates_available` | The acting team has at least one season candidate row |
| `actual_has_acting_season_row` | The actual's acting role candidate carries a season row |
| `ban_records_fewer_than_top3` | Ban with fewer than 3 available target records, so later slots come from RADAR/FALLBACK |

**Season flags record availability, not cause.** Season rows come from the acting roster even on bans.

## Shadow selection position

`soloContext` isn't exported, and no hook was added. `reconstructSoloContext` is a line-for-line copy
of `solo-draft.ts` `soloContext`/`select`, built on the same production functions.
- `shadowOrder` iterates `select` with growing exclusions, as `explainSoloDraftTurn` does for its
  alternatives.
- **Per state**, the shadow's first 3 choices (id, source, `role_supported`) are compared with
  production's 3.
  - **Equal:** status `VERIFIED_TOP3_EQUAL`, with the actual's `position` and `position_source`.
    `position_basis` is `PRODUCTION_TOP3` for positions 1–3 and `RECONSTRUCTED_SELECT` beyond that.
  - **Not equal:** status `MISMATCH_UNAVAILABLE`, and position = null. No rank is substituted.
- Primary classes never use the shadow.
- FALLBACK covers every champion, so every legal champion eventually gets a position. **A position
  is not pool membership.** Not-in-pool champions are typically reached only through FALLBACK, and the
  summary reports position sources next to the position buckets.

## Tests (`web/tests/current-draft-pool-diagnostics.test.mjs`)

- **Shadow equals production:** the shadow's top 3 equals production's (id, source,
  `role_supported`) on every prefix of 7 synthetic drafts:
  - blue-first and red-first;
  - ban records exhausted with no meta (FALLBACK);
  - meta only (RADAR);
  - meta plus current profiles on both teams;
  - a parsed `SeasonHistory` (PLAYER_SEASON);
  - Fearless `previousPicks`.

  The test asserts that all 4 sources occur.
- **Classes:** a synthetic case for every class, including target-vs-acting for bans and role
  infeasibility.
- **Absent vs ranked vs not computable:** these stay distinct; a FALLBACK position on an absent
  champion; a mismatching production list gives an unavailable position with the class unchanged.
- **No future features:** changing turns 11–20 leaves the rows for turns 1–10 identical.
- **Legality and draft order:** red-first order, legal prefixes, and red bans reading blue's
  priorities.
- **Canonical aliases:** `Lee Sin`/`LeeSin` and `Kai'Sa`/`Kaisa` match in priorities, meta and
  selections.
- **Byte identity:** baseline and season evaluator outputs are byte-identical before and after;
  drifting API output is rejected; season flags follow the acting roster.
- **Input rejection:** wrong dataset hash, missing byte hash, unflagged fixture, wrong 2374 or fcd2
  provenance, and an incomplete API are all rejected.
- **Summary:** aggregate-only (kind × phase), with no match, team, player, snapshot or champion IDs.

## Running (Codex)

```text
cd web && node --test tests/current-draft-pool-diagnostics.test.mjs
node ops/current-draft-pool-diagnostics.mjs PREPARED_DATASET_JSON outputs/current-draft-pool-diagnostics-20261120.json [SEASON_EVIDENCE_JSON]
```

- **Dataset and evidence:** use the same prepared dataset and the same season evidence as the
  existing season run.
- **Output location:** the output must be under `outputs/` and must not overwrite an input.
- **No live fallback:** the CLI never falls back to published or live data.
- **Output files:**
  - `OUTPUT.json` holds per-state rows and stays ignored.
  - `OUTPUT.summary.json` holds aggregate counts only: by mode × kind × phase × class, plus flags,
    shadow status and position buckets/sources for misses.

## Limitations

- **Reconstruction.** Positions beyond 3 come from a reconstruction of `select`, not from a production
  call. They are checked indirectly: per state, the top 3 must match production, and the synthetic tests
  exercise every branch. A transcription error that only affects later iterations wouldn't be caught.
  Because of this, position buckets are reported, never used for classes.
- **Code drift.** If `solo-draft.ts` changes, the reconstruction can drift. Per-state verification then
  turns positions into `MISMATCH_UNAVAILABLE` rather than reporting wrong ones. It doesn't update the
  copy.
- **Cohort.** The cohort is already observed, small and clustered (states within a match are
  correlated). Counts are descriptive, with no intervals or significance, and they say nothing about
  why teams drafted what they drafted.
- **Concordance, not quality.** Missing the observed action is not a rule error. Concordance is not
  quality or optimality.
- **Pool definition.** "Pool" is the set of sources the current rule reads, not what a team could
  plausibly play. A champion outside every source is outside the rule's vocabulary; this is not a
  statement about the team.
- **Role facts.** These use the prefix's acting picks and the rule's own role hints. The actual roles
  played are unknown by design.
- **Season mode.** It covers only the 2374 capture as of its cutoff, and only where the production
  eligibility rules admit a single FOUND current player per role.
- **Ban role candidates.** Target role candidates for bans are computed with the same history, purely
  diagnostically; the ban rule never reads them while `records` is non-empty.
