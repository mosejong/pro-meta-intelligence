# Current solo draft-rule evaluation · 2026-11-20

Status: **implemented, not run.** No commands, tests, scoring or historical runs were executed when this was written. Codex verifies and runs it independently. This file contains no scores and no expected rates.

## What it measures

The evaluator replays already-prepared first-set professional drafts, one turn at a time, through the **unchanged production** `explainSoloDraftTurn` and `suggestSoloDraftTurn` (`web/app/solo-draft.ts`). It loads them through Vite SSR, the same way the existing tests and `scripts/evaluate-draft.mjs` do. It does not use `previewOpponentPick`, and it does not use a Python or substitute scorer.

**Per state t (turn 1..20, bans and picks):**
- **Input:** only the observed prefix `selections[0..t-2]`, `previousPicks = []`, `seasonHistory = null`, `firstPickSide` from the prepared case, and `manualSide` set to the side opposite the acting one.
- **Scoring only:** the actual action at t. It is never passed to the rules.
- **Fixed candidate count:** 3 (selected plus up to 2 alternatives, exactly as the API returns them). There is no fitting, tuning or weight search.
- **API agreement:** `explain.selected` must equal `suggestSoloDraftTurn` on the same input, and `turn`, `kind` and `side` must match the replayed state. Any disagreement throws.
- **Abstentions:** a `null` from the rules is a counted abstention and stays in the denominator.

**Reported (aggregate):**
- States, abstentions, top-1 agreements, top-3 inclusions, short candidate lists, emitted candidates, and illegal emitted candidates. Illegal means already selected in the prefix or not a canonical champion.
- Breakdowns: overall, by BAN/PICK, by BAN/PICK × acting side, and by BAN/PICK × first-pick or second-pick team.
- Counts of the selected candidate's `source` and `evidence`, the number of picks with `role_supported = false`, and the number of states with `season_evidence`.
- The true denominator: prepared matches, evaluator exclusions, evaluated matches, states, and the preparer's own exclusion counts passed through unchanged.

Per-team rows (`by_team`, which contain team IDs) and per-case rows exist only in the full output under ignored `outputs/`. `summarizeEvaluation` strips them for any committed summary.

Agreement is **concordance with observed pros**. It is not win prediction, utility, quality or advantage. States within a match are correlated.

## Input contract (fail closed, no repair)

The input is the exact output of `src/pro_meta_intelligence/backtest/draft_dataset.py` (unchanged, present on main and in the original workspace): `schema_version "1"`, `draft-historical-dataset`, `FIRST_SET_IMMEDIATE_OPPONENT_PICK`, `snapshots[]` and `matches[]` with `ordered_draft` selections, plus `audit`.

The evaluator **throws** on any of the following:
- **Schema and fixture flags:**
  - Wrong artifact, scope or schema.
  - `fixture_only` datasets, unless a unit test passes `allowFixture`.
  - Fixture and real flags that disagree.
- **Audit:** missing audit, or `audit.eligible_matches` not equal to the match count.
- **Frozen sources:**
  - A candidate snapshot that is not the **2374** capture (`sha256:2374ae61…`), with cutoff equal to its retrieval time `2026-11-04T03:03:22.056760+00:00` in the snapshot, report and prep.
  - An outcome that is not the **fcd2** capture (`sha256:fcd2e451…`, `2026-11-11T02:19:29.155420+00:00`), in each match and in `audit.last_capture_at`.
  - The **76b7** capture anywhere. It is 2022 data.
- **Timestamps:** a timestamp without a timezone, or a match outside `2374 cutoff < observed_at ≤ fcd2 retrieval`.
- **Leakage and evidence:**
  - The target match appears in any evidence list or in `recent_games`.
  - Any `recent_games` row is after the cutoff.
  - Patch mismatch.
  - Missing or duplicate team.
- **Case shape:**
  - Missing or invalid `first_pick_side`, or one that contradicts the draft order.
  - `game_number ≠ 1`, or not exactly 20 selections.
  - Non-standard turn, side, slot or phase.
  - Duplicate champion.
  - Duplicate match.
- **Production API:**
  - A function is missing or the two APIs disagree.
  - A snapshot is mutated by the rules.

A champion name that the product cannot canonicalize is the only counted exclusion (`UNKNOWN_CHAMPION_ID`). It is never substituted.

## How Codex runs it

1. **Prepare the dataset.** The current preparer always uses the **latest** capture in the archive root as the outcome source, so running it on the full archive would pick 76b7, and the evaluator rejects that by design. Prepare from a read-only copy of an archive root that contains the 2374 and fcd2 captures but **not** 76b7, and pass `--observed-after 2026-11-04T03:03:22.056760+00:00`. Earlier August captures may stay in the root; the boundary excludes their matches. Whether `SnapshotArchive.inspect` accepts that copied root, including `_request_attempts.json`, is unverified.
2. **Evaluate:** `node ops/current-draft-evaluation.mjs <dataset.json> outputs/<run>/current-draft-eval.json`. Node needs to be ≥ 22.13 with `web/node_modules` installed. The CLI refuses output paths outside `outputs/` and writes `<run>.summary.json` (aggregate only, plus the preparer audit).
3. **Unit tests:** run `node --test tests/current-draft-evaluation.test.mjs` from `web/`. The file is not added to `npm test`, because `web/package.json` is outside this task's owned files. Adding it is an integration step.
4. **Order of review:** record the audit and denominator before reading any agreement count. Commit the aggregate as is.

## Missing or limited inputs (documented, not fabricated)

- **SeasonHistory:** the preparer does not produce one. Every state passes `seasonHistory: null`, so the `PLAYER_SEASON` branch cannot fire, and `season_evidence_state_count` should be 0. The product loads a live season file instead. Substituting it would leak a current static feed, so it is not used.
- **Target-game lineup and roles:** neither is supplied or used. Roster status comes only from OpponentPrep's past-only CURRENT players, and role hints come only from past `priority_picks` and radar rows.
- **Fearless:** later sets need inferred series membership, which is not approved. This tool scores first sets only, with `previousPicks = []`.
- **24h availability:** the preflight's 24h rule is not in the preparer. Instead, availability is bounded by the physical 2374 capture, which is earlier than every eligible match.
- **Coverage:** the window is 2026-11-04 → 2026-11-11 only, so no full-season 2026 claim is possible. The captures were already used for other team and player research (`SOURCE_PREVIOUSLY_USED_FOR_OTHER_RESEARCH`).
- **Original-only work:** the newer research work in the original workspace (context-signal audit, 083cddf5) is unrelated to this input path and was not duplicated.

## Files

- `web/tests/current-draft-evaluation-lib.mjs`: the evaluator, the production API loader and the aggregate summary.
- `web/tests/current-draft-evaluation.test.mjs`: unit tests covering:
  - real API invocation and equality with direct calls;
  - prefix-only inputs, with changes to future or actual actions leaving earlier candidates unchanged;
  - the true denominator, abstentions and unknown-name exclusions;
  - red first pick;
  - 22 rejection cases;
  - a substitute-scorer rejection.
- `ops/current-draft-evaluation.mjs`: the CLI.
- No UI, scorer, preparer or package changes.
