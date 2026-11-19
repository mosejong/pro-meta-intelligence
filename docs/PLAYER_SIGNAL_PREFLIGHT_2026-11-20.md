# Player-signal preflight: fixed directional golddiffat15 context signal — 2026-11-20

Read-only feasibility assessment. No code, tests, commands, network or model work was done, and none is authorized by this document.
Sources read:
- `docs/PLAYER_EFFECT_NEXT_GATES_2026-11-19.md`, `docs/METRIC_CONTEXT_COHORT_2026-11-19.md`, `docs/PREGAME_METRIC_CONTEXT_2026-11-19.md`
- `docs/LANE_STAT_CONSISTENCY_2026-11-19.md`, `docs/SOURCE_REGISTRY.md`, `docs/AUTONOMOUS_USAGE_POLICY_2026-11-19.md`
- `ops/benchmark_metric_context_cohort.py`, `ops/benchmark_match_baselines.py`, `ops/pregame_metric_context.py` (header), `ops/audit_pregame_history_support.py` (`_game_issue`, `_observations`)

**Verdict: permissible as a bounded exploratory diagnostic.** No hard blocker was found. The remaining gaps are honest-labelling and design choices, not reasons to stop. The diagnostic is not a player model, it does not admit a feature, and it does not unlock any UI.

## 1. What is already implemented, verified or prepared

| Need | Status | Evidence |
| --- | --- | --- |
| Per-player pre-match signal | **Implemented and verified.** `build_metric_context` returns `position_fraction` in [0,1] (peers below + ½ exact ties, divided by eligible peers). It uses the same league, role and exact patch, excludes the target match and the target player, uses the latest 20 games with at least 5 valid and at least 5 peers, and applies a simulated 24h delay. | `PREGAME_METRIC_CONTEXT`; Codex reported 83 related tests passing. |
| Support set | **Verified.** 198 of 878 cohort targets have all 10 queries `descriptive_context_available`. It is built in-process as a `frozenset` by `assess_context_support_with_ids` and never serialized. | `METRIC_CONTEXT_COHORT`, real fcd2 rerun. |
| Outcome label | **Implemented.** `Prediction.blue_won = winner_team_id == blue_team_id`. `_record_issue` rejects games where the winner is not a participant or the same team plays both sides. | `benchmark_match_baselines.py:113-128,237` |
| Target side identity | **Implemented.** `_game_issue` requires exactly participant IDs 1–10 and a valid identity (5 unique roles per side, unique playerid, consistent teamid within each side). It also requires each raw row's `side` teamid to equal the adapter's `blue_team_id` or `red_team_id`. Every supported game passed this check. | `audit_pregame_history_support.py:90-108` |
| Label join | **Prepared.** Supported IDs and predictions are joined by `match_id` in one process through `partition_predictions`. The supported partition has n=198. | `benchmark_metric_context_cohort.py:301-306` |
| Full-timeline baselines | **Done.** One `simulate` run over the whole timeline, with warmup and Elo updates kept and no subset refit. On the supported set: fixed 0.5 Brier 0.25, Blue Laplace 0.246299, Elo 0.251480. `score` already reports `accuracy_with_half_credit_ties`. | `METRIC_CONTEXT_COHORT` table |
| Sign or orientation of the metric | **Arithmetic verified; definition not verified.** On fcd2, every computable slot satisfies blue+red golddiffat15 = 0 and own goldat15 − lane-opponent goldat15 = own golddiffat15 (44,305 of 44,305 per rule, 0 inconsistent). So a higher value means the player was ahead of their same-role opponent at 15 in past games. The provider dictionary has not been re-checked and units are `RAW_UNITS_NOT_VERIFIED`. | `LANE_STAT_CONSISTENCY` |
| Source policy | **No prohibition found.** The registry records OE as "free … for analysts, commentators, and fans", with Riot terms applying. The registry forbids raw redistribution, and Riot policies forbid de-anonymizing players. An aggregate-only local diagnostic does neither: no raw rows, IDs or player values leave the process. `PLAYER_EFFECT_NEXT_GATES` routes *training-data use scope / public derivatives* to the existing policy gates. This diagnostic trains nothing and publishes nothing, so no new approval is triggered. I found no statement that forbids this use, and I am not inventing an approval requirement. | `SOURCE_REGISTRY.md`, `PLAYER_EFFECT_NEXT_GATES` §승인 |
| Prior signal-vs-outcome look | **None found in the files read.** Every prior artifact keeps labels and positions apart, by design. The cohort and the metric specification have been explored; the signal–label relation has not. | claims `NO_MODEL_NO_LABELS_NO_OUTCOME`, `AGGREGATE_ONLY_…` |

## 2. Hard blockers and routine design choices

**Hard blockers:** none. These are the items I checked:
- **Identity:** fail-closed, and every supported game passed.
- **Time:** cutoff = target `observed_at` with a 24h simulated delay, the same assumption the baselines use. The target is excluded from its own history.
- **Label:** derived from the adapter winner, with the side–team equality enforced per row.
- **Scope:** the same fixed cohort. There is no subset refit, and no new source or API.

**Must be labelled, but none is a blocker:**
1. `RAW_UNITS_NOT_VERIFIED` and `FIELD_DEFINITION_FROM_ARITHMETIC_NOT_DICTIONARY`. Only the monotonic ordering inside one league/role/patch is used, so unit scale does not matter. Orientation is backed by the arithmetic check, not by the dictionary.
2. `ALREADY_EXPLORED_COHORT`, `NOT_PREREGISTERED_PUBLICLY`, `NO_INDEPENDENT_HOLDOUT`. The 198 games are the only eval set. Freezing the specification in a committed document before the run guards only against our own forking. It is not validation.
3. `CONFOUNDED_WITH_TEAM_STRENGTH`. A player's past gold lead at 15 is largely a team and schedule outcome, not individual ability. Agreement with Elo direction is therefore reported, so redundancy is visible.
4. `SELECTED_SUBSET_22_6_PERCENT`. The other 680 games get no signal and no fallback. Coverage is reported, and results do not generalize to the full 878.
5. `SIMULATED_24H_DELAY` and `TARGET_ROSTER_KNOWN`: the same assumptions the baselines make.

**Routine design choices**, fixed below in §4:
- the tie rule and float handling
- the reference rows
- the uncertainty statistic
- league breakdown or none

## 3. Recommended next task: one bounded implementation

**Fixed directional concordance diagnostic for the golddiffat15 context signal on the 198-game supported set.** It is aggregate-only, has no probabilities, does no fitting and admits nothing to the UI.

Owned files (Claude implements; Codex verifies and adds its own independent review test):
- **`ops/benchmark_metric_context_cohort.py` (narrow refactor only):** extract the existing per-target query loop into a private in-process iterator. It yields `(match_id, side, status, position_fraction)` per query, and `assess_context_support_with_ids` consumes it. The public output must stay byte-identical. This avoids re-implementing the support or status logic.
- **NEW `ops/benchmark_context_signal_direction.py`:** a CLI with the same input, hash, retrieved-at and output guards as the cohort CLI (it reuses `validate_output_path`, hash checks and the source-unchanged checks).
- **NEW `tests/test_context_signal_direction.py`**
- **NEW `docs/CONTEXT_SIGNAL_DIRECTION_2026-11-20.md`:** this specification, copied verbatim and committed **before** any run on fcd2.

Do not edit:
- `tests/test_metric_context_cohort_review.py`
- the other Codex review tests
- web, engine or UI code
- the source registry

## 4. Frozen specification, set before seeing any output

- **Unit:** each game in the supported set (exactly the frozenset from the unchanged support rule). No other game is scored, and there is no fallback.
- **Inputs per game:** the 10 `position_fraction` values from the support pass itself, not recomputed. Side comes from the raw row `side`, already checked against the adapter team IDs.
- **Signal:** `S = fsum(blue five fractions) − fsum(red five fractions)`. This equals 5 × (blue mean − red mean); the sign is what matters.
  - Fixed, no weights, no role weighting, no threshold, no scaling, nothing estimated.
- **Direction:** `S > 0` predicts blue, `S < 0` predicts red, and `S == 0` exactly is a tie.
  - Tie check: compare the two `math.fsum` results with `==`. There is no tolerance.
- **Label:** `Prediction.blue_won` from the single existing full-timeline `simulate` run, joined by `match_id` in-process.
  - Hard error if any supported ID is missing from the predictions, or if counts differ from the partition's n.
- **Primary aggregate:**
  - `n`, `concordant`, `discordant` and `ties`
  - `concordance_half_credit = (concordant + 0.5·ties) / n`
  - coverage: n out of 878 cohort targets
- **Fixed reference rows on the same games:**
  - **Existing values:** `accuracy_with_half_credit_ties` from the existing `summarize` for `fixed_half` (≡0.5), `blue_laplace` and `team_elo`.
  - **Agreement table with Elo direction:** a 2×2 of (signal correct or wrong) × (Elo correct or wrong). Tie games and Elo p == 0.5 games are counted separately.
- **Uncertainty:** report one statistic, fixed in advance: an exact two-sided binomial sign test on the non-tie games against 0.5. On the 2×2, also report an exact McNemar test (a binomial test on the discordant pairs). Both are labelled exploratory. No other test is added after looking.
- **Breakdown:** overall only. By-league n and concordant counts are allowed only as a descriptive appendix, with no per-league test. Small n is labelled.
- **Never output:**
  - probabilities from the signal, coefficients or fitted thresholds
  - per-game rows, match, player or team IDs
  - fractions, means or `S` values, labels per game
  - histograms of `S`
- **Claims to carry:** `EXPLORATORY_ALREADY_SEEN_COHORT`, `NOT_PUBLIC_PREREGISTRATION_OR_INDEPENDENT_VALIDATION`, `FIXED_UNFITTED_DIRECTIONAL_SIGNAL`, `NO_PROBABILITIES_NO_COEFFICIENTS`, `CONFOUNDED_WITH_TEAM_STRENGTH`, `NOT_PLAYER_STRENGTH_OR_EFFECT`, `RAW_UNITS_NOT_VERIFIED`, `SIGN_FROM_ARITHMETIC_CHECK_NOT_DICTIONARY`, `SIMULATED_24H_NOT_ACTUAL_AVAILABILITY`, `TARGET_ROSTER_KNOWN_ASSUMPTION`, `SUPPORTED_SUBSET_ONLY_NO_FALLBACK`, `NO_UI_ADMISSION`, `AGGREGATE_ONLY`.
- **Interpretation, fixed in advance:**
  - **Any value:** no feature admission, no UI change and no historical-player gate change.
  - **Concordance at or below the Elo direction accuracy, or within sign-test noise of 0.5:** "no directional evidence beyond team baselines on this set".
  - **Concordance above both:** "a descriptive association worth testing on a future unseen period". It is not an ability claim, and it does not justify loosening support rules, windows, peers or patch pooling to cover more games.

## 5. Acceptance

**Deterministic tests** use a synthetic adapter fixture like the one in `test_metric_context_cohort.py`:
- **Orientation:** a blue side with higher histories predicts blue. Swapping sides flips the prediction. A label flip changes concordant to discordant.
- **Exact ties:** an exact tie is counted as a tie (half credit). An almost-tie is not.
- **Unsupported games:** an unsupported game contributes nothing, with no fallback and no coverage leak.
- **Joins:** a supported ID missing from the predictions raises an error. Supported n equals `partition_predictions["supported"]`.
- **No refit:** the reference accuracies equal `summarize` on the single full-timeline run. A supported-only refit would give different Elo, and the test shows it is not used.
- **No order dependence:** the result does not change when the input rows are reordered.
- **Refactor safety:** the cohort CLI output is byte-identical before and after the refactor on the fixture.
- **Output content:** the output JSON contains no IDs, fractions, `S`, per-game labels or probabilities (key and value scan, as in the existing tests).
- **Guards:** output and input rejection paths are reused, and the source is unchanged after the run.

**Real pinned-data checks** are run by Codex after the specification document is committed:
- **Input:** source sha256 `fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de` with `--retrieved-at 2026-11-11T02:19:29.155420Z`.
- **Refactor check:** the rerun of `ops.benchmark_metric_context_cohort` is identical to `outputs/metric-context-cohort-final-fcd2-20261120.json`.
- **Cohort size:** the diagnostic reports n = 198 out of 878, and `concordant + discordant + ties = 198`.
- **Reference rows:** the same-set reference rows reproduce Elo Brier 0.251480 and Blue Laplace 0.246299 through the same `summarize` call, and the accuracy fields come from that call.
- **Records:** Codex records the result in the specification document. The value is not hard-coded in code or tests.

## 6. Explicitly out of scope

- probability calibration, logistic or other fits, weight or threshold search
- other metrics, combining metrics, role weights
- relaxing support rules or pooling patches
- 13-metric support comparisons
- a whole-878 comparison: different cohort, never compared
- new collection, sources, APIs, SoloQ or translation
- web or UI wiring
- historical-player gate changes
- push or deploy
