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

## Optional full-evidence path: season history (added 2026-11-20, separately versioned)

Status: **implemented, not run.** No commands, tests or historical runs were executed when this was written. This section contains no scores and no expected rates.

**The baseline is untouched.** The protocol frozen at commit `30525faf` stays exactly as it was: `current-draft-evaluation-lib.mjs`, its tests, `ops/current-draft-evaluation.mjs` and their `seasonHistory = null` output. None of those files changed. Codex already ran that baseline: 9 matches, 180 states. This path is **coverage completion, not tuning**. Its result files were not inspected while writing it, and nothing in it searches over weights, candidates or rules.

**What the new artifact declares about the comparison:**
- The base cohort was **already observed** (`BASE_COHORT_ALREADY_OBSERVED`).
- The baseline had **no season evidence** (`BASELINE_MISSING_SEASON_HISTORY`).
- Any comparison with the baseline is therefore an **exploratory integration diagnostic** (`comparison_status: "EXPLORATORY_INTEGRATION_DIAGNOSTIC"`).
- It is not a confirmatory trial, not a fresh holdout and not proof of utility (`NOT_A_CONFIRMATORY_TRIAL`, `NOT_A_FRESH_HOLDOUT`, `NOT_PROOF_OF_UTILITY`).

### Step 1. Season evidence (Python, 2374 capture only)

`ops/prepare_current_draft_season_evidence.py`, artifact `current-draft-season-evidence`, version `current-draft-season-evidence-v1`.

**Inputs:** an explicit prepared dataset (the same file the baseline used), the **2374** CSV and its `.meta.json`. Every argument is required, and none has a default.

**Source verification** reuses `ops/build_player_season_history.verify_archive`:
- `source_id`, data file name, sha256, byte length, file stem, and a timezone-aware `retrieved_at`.

**Pin checks** against the physical 2374 capture:
- The hash must be `sha256:2374ae61…` and `retrieved_at` must be exactly `2026-11-04T03:03:22.056760+00:00`.
- fcd2 (outcomes) and 76b7 (2022 data) are rejected explicitly.
- The capture must not be in the future.

**Import:** the CSV is read with the existing `OracleElixirCSVAdapter`. The adapter hash must match the archive metadata. If any target `match_id` appears in the season source, the preparer fails.

**Per prepared snapshot, built as of exactly the 2374 cutoff:**
- The snapshot, report and opponent-prep cutoffs must equal the capture retrieval time, with a timezone.
- The snapshot must be real data (no fixture flag) and its patch must be consistent.
- Every evidence `source_versions` entry must cite OE, the 2374 hash, and the **adapter's own** `source_version`.
- The roster basis comes from `player_season.roster_basis_from_feed(report)`, and the references from `roster_references_from_feed(report)`. Both come from the **historical snapshot report**, never from the published feed or the target game's lineup or roles.
- The season is the UTC year of the cutoff and must equal 2026.
- The history is built with the existing `build_player_season_history`. That function excludes matches and events after the cutoff and outside the season. The adapter also rejects games dated after the capture.
- The result is checked with the existing `validate_output`.

**Why no `import_report` is needed:** a prepared snapshot report has no `input.import_report`, so the feed-based `select_accepted_snapshot` and `build_from_archive` path is not used. The source block `{source_id, source_version, content_hash, retrieved_at}` and `import_report` come from the verified capture and the adapter's own import of it. Nothing is guessed or faked.

**Fail-closed cases:**
- If no profile has a `player_id`, the preparer fails with `MISSING_FIELD: opponent_prep.teams[].player_profiles[].player_id`.
- If a report has no prep, it fails with `MISSING_FIELD: snapshot.report.opponent_prep`.

**Output:** `dataset_sha256` (sha256 of the exact dataset bytes), `source`, `season`, `claims`, and one `histories[]` entry per snapshot. Each entry holds `snapshot_id`, `patch_id`, `season`, `cutoff`, `roster_basis`, `roster_reference_count`, `history_sha256` and `history_json`. The output path must be under ignored `outputs/`.

### Step 2. Evaluation (JS, same production rules)

`web/tests/current-draft-season-evaluation-lib.mjs`, evaluator `current-solo-rule-concordance-season-v1`, plus the CLI `ops/current-draft-season-evaluation.mjs`.

**Cross-validation before any state is replayed.** Any mismatch throws:
- **Evidence artifact:** type and version, and the four declaration claims.
- **Dataset:** `dataset_sha256` must equal the sha256 the CLI computes over the dataset bytes.
- **Source:** must be the 2374 hash and its exact retrieval time. fcd2 and 76b7 are rejected. The season must be 2026.
- **Snapshot coverage:** histories cover exactly the prepared snapshots, with no missing, extra or duplicate entries.
- **Per snapshot:**
  - `sha256(history_json) === history_sha256`.
  - `roster_basis` deep-equals the production `rosterBasis(report)`.
  - The cutoff string equals the report, snapshot and 2374 cutoffs.
  - The year equals the cutoff year, and the patch matches.
  - The snapshot evidence cites the season source version.
  - The **production** `parsePlayerSeasonHistory(text, {basis, season})` accepts the history. It rejects a different basis, cutoff or year, a source retrieved after the cutoff, and any period after the cutoff.
  - The parsed source equals the evidence source.
  - The history's (team, player) set equals the snapshot's roster references.

**Replay:** the wrapper calls the **unchanged base evaluator** `evaluateCurrentDraftRules`. Each `explainSoloDraftTurn` and `suggestSoloDraftTurn` call gets `{...input, seasonHistory}`, with the history found by the state's snapshot report. The wrapper first requires that the base input still has `seasonHistory === null`, and throws if no history exists for that snapshot. The production functions, prefix-only inputs, fixed 3 candidates, denominator, legality checks and API-agreement checks are therefore exactly the baseline's.

**Output:** `artifact_type: "current-draft-rule-season-evaluation"`, plus:
- `base_evaluator_version`;
- `season_history`: source plus a per-snapshot summary (hash, player and found counts). It does not include the history text.
- `base_cohort`: `frozen_protocol_commit: "30525faf"`, `baseline_season_history: null`, `already_observed: true`;
- `comparison_status`, and claims equal to the base claims minus `SEASON_HISTORY_NOT_SUPPLIED`, plus the season and declaration claims.

`summarizeEvaluation` still strips `by_team` and `case_results`.

### How Codex runs it (unrun)

1. `python -m ops.prepare_current_draft_season_evidence --dataset <the baseline dataset.json> --csv outputs/oracles-elixir/raw/oracles-elixir-match-data/2374ae61….csv --meta outputs/oracles-elixir/raw/oracles-elixir-match-data/2374ae61…<timestamp>.meta.json --output outputs/<run>/season-evidence.json`
2. `node ops/current-draft-season-evaluation.mjs <the baseline dataset.json> outputs/<run>/season-evidence.json outputs/<run>/current-draft-season-eval.json`. This writes the full result and `.summary.json` under `outputs/`.
3. Tests:
   - `python -m pytest tests/test_current_draft_season_evidence.py`
   - `node --test tests/current-draft-season-evaluation.test.mjs` from `web/`
   - Re-run the frozen `node --test tests/current-draft-evaluation.test.mjs` to confirm the baseline is unchanged.
   - Neither new test file is added to `npm test` or CI config, because those files are outside the owned set.

### Unrun checks

- Nothing in this section has been executed: not the preparer, the JS wrapper, either CLI or any test.
- Whether the real 2374 snapshot report's evidence `source_version` equals the adapter's `source_version` for the 2374 CSV. If not, the preparer fails closed on purpose. Nothing is rewritten.
- Whether the real snapshot reports carry `player_profiles` with `player_id`. If none do, the preparer fails closed with `MISSING_FIELD`.
- Whether `validate_output`'s 3MB public budget holds for a full 2374 season history. If it does not, the preparer fails closed. The limit is inherited unchanged.
- Whether the JS fixture history passes the production parser exactly as written, and whether the template feed's first `source_versions` entry exists.
- Whether `tmp_path_factory` paths stay short enough on Windows for `SnapshotArchive.store` in the new Python tests.

### Limitations

- Same cohort and window as the baseline: 2026-11-04 → 2026-11-11, first sets only, already observed. It is not a holdout, and no full-season 2026 claim is possible.
- Season history covers only games in the 2374 CSV up to its retrieval time, for players named in each snapshot's past-only profiles. Players who join later, or roles for the target game, are never used.
- The production rules use season history only for CURRENT profiles with a recognized role that is unique per role. Other players add nothing, by design of the unchanged rules.
- `season_evidence_state_count` counts states whose acting-team candidate pool contained season rows. It does not show that season rows were selected or helped.
- The 2374 capture was already used for other research (`SOURCE_PREVIOUSLY_USED_FOR_OTHER_RESEARCH`).

### Files (this section)

- `ops/prepare_current_draft_season_evidence.py` (new).
- `tests/test_current_draft_season_evidence.py` (new). It covers:
  - the build and the snapshot basis;
  - future player stats excluded;
  - 19 malformed provenance, time, year and field cases;
  - archive corruption and mismatch;
  - the frozen pins;
  - no default or fallback inputs;
  - output under `outputs/` only.
- `web/tests/current-draft-season-evaluation-lib.mjs` (new): the wrapper, strict cross-validation and the season API loader.
- `web/tests/current-draft-season-evaluation.test.mjs` (new). It covers:
  - real production calls with the history;
  - a byte-identical baseline before and after the season run;
  - a NOT_FOUND history equal to the baseline;
  - 25 rejections, including a different roster basis, cutoff, year, future stats, source and dataset mismatches, roster-set mismatches and missing evidence;
  - no published or live history access.
- `ops/current-draft-season-evaluation.mjs` (new): the CLI.
- No base, UI, scorer, model, collector or package files changed.

## Codex verification checkpoint

Implementation-time unrun lists above are historical handoff notes. Independent execution completed: base JS28 plus season JS31 (combined59/59), Python26/26, scoped lint/format, verified2374 archive season build, and both real cohort CLIs. Frozen protocols30525faf and96712294 preceded their respective scoring runs. See [independent review](CODEX_CURRENT_DRAFT_RULE_REVIEW_2026-11-20.md) for results and limits. No product scorer changed, no predictive improvement claimed, no publish/deploy.
