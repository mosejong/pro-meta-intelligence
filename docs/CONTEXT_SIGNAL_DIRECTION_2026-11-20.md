# Fixed context-signal directional diagnostic · 2026-11-20

Specification frozen locally before any new pinned-data signal run. The underlying cohort was already explored; this is not public preregistration or independent validation. No fitted model or product feature admission.



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


## Execution record
No new directional result generated yet. Expected support198/878 is prior support-count evidence, not a result of this proposed signal.

Refactor comparison must preserve all substantive prior support/query/exclusion/baseline fields; changed source-code fingerprint metadata must be recorded explicitly rather than falsely claiming literal byte identity.

## Implementation (Claude, 2026-11-20) — not run

The specification above is unchanged. Claude ran no commands, tests, ruff or pinned-data runs; Codex runs and records them.

### Files
- `ops/benchmark_metric_context_cohort.py`: minimal refactor.
  - New frozen in-process `ContextQueryResult(match_id, side, status, position_fraction)`.
  - New `assess_context_support_with_queries(raw, matches, *, expected_hash, cohort=DEFAULT_CONFIG) -> (report, supported_ids, queries)`. It is the existing support pass, with each query's helper result also kept: `side` is the raw row side lowercased (the target already passed `_game_issue`), and `position_fraction` is the helper's own value, never recomputed.
  - `assess_context_support_with_ids` now returns the first two of these, so its report, ID set and every query/exclusion/supply count are computed by the same code path as before. `assess_context_cohort` and its CLI are untouched.
- NEW `ops/benchmark_context_signal_direction.py`.
- NEW `tests/test_context_signal_direction.py`.

### API (`ops.benchmark_context_signal_direction`)
- `signal_directions(queries, supported_ids) -> {match_id: +1 | -1 | 0}`, in-process only.
  - Queries of unsupported games are ignored.
  - Each supported game needs exactly 5 `blue` and 5 `red` queries, all `descriptive_context_available`, each with a finite fraction in [0, 1] (bool/str/None/NaN/inf rejected). Otherwise `ValueError`; a supported ID with no queries is also an error.
  - Direction compares `math.fsum(blue)` with `math.fsum(red)`; exact equality is a tie (for finite floats this is exactly `S == 0`).
- `exact_binomial_two_sided(successes, trials) -> float | None`: exact integer/`Fraction` arithmetic, p = 0.5, doubled smaller tail capped at 1. `trials == 0` returns None (no test).
- `evaluate_directions(directions, supported_predictions) -> dict`.
  - Hard error if the two ID sets differ, sizes differ, or a prediction repeats.
  - Returns `direction`, `sign_test`, `elo_agreement`, `mcnemar` and `by_league_descriptive`.
  - Elo correct/tie uses the same rule as the existing `score` (`p == 0.5` is a tie, else `(p > 0.5) == blue_won`).
- `assess_direction(raw, matches, *, expected_hash, config=DEFAULT_CONFIG) -> dict`.
  - One support pass, one `clean_records` + `simulate`, and the existing `partition_predictions`, which errors if a supported ID has no prediction. There is no subset refit.
  - Adds `reference_same_games`: the existing `summarize(supported)["all_targets"]["overall"]` (fixed_half, blue_laplace, team_elo: n, Brier, logloss, half-credit accuracy, ties).
  - Adds `coverage`: scored supported games versus all cohort target predictions. Neither number is hard-coded.
- CLI: `python -m ops.benchmark_context_signal_direction --input <csv> --retrieved-at <ISO+tz> --content-hash <sha256> --output <new .json>`.
  - The guards are copied from the cohort CLI: hash format, timezone, `validate_output_path`, byte hash before running, adapter hash match, source unchanged before writing, `open("x")` (no overwrite), and withdrawal if the source changes after writing.

### No-test and empty rules
- n = 0: status `NO_SUPPORTED_GAMES`, `concordance_half_credit` None, and both tests `NOT_RUN_*` with p None.
- No non-tie games: the sign test is `NOT_RUN_NO_NON_TIE_GAMES`.
- No discordant signal/Elo pairs: McNemar is `NOT_RUN_NO_DISCORDANT_PAIRS`.
- No exact p = 1 is substituted in these cases.

### Output
- Aggregate JSON only: top-level keys are fixed and tested.
- No match, player or team IDs, fractions, means, S values, per-game labels, signal probabilities or Elo probabilities.
- `by_league_descriptive` holds only `n` and `concordant` per league, labelled `DESCRIPTIVE_ONLY_NO_TEST_SMALL_N`.
- The artifact never classifies its own result. The fixed interpretation strings are included, and the reviewer applies them, because "within sign-test noise" has no frozen alpha.

### Tests (synthetic adapter fixtures from the context-cohort tests; not run)
- **Orientation:** equal histories give an exact tie, and the rookie target is ignored. Blue-higher histories with a red win give discordant / Elo-only-correct; with a blue win they give concordant / signal-only-correct. Red-higher gives concordant / both-correct.
- **Reference rows:** they equal an independent full-timeline `summarize`, and differ from a subset refit.
- **Robustness:** input order does not change the report. Games 12h before the target (inside the 24h delay) and after it leave the target's 10 queries unchanged.
- **Iterator:** `assess_context_support_with_ids` equals the first two results of the new function, and the exposed fractions are the expected 1.0 ×5 and 0.4 ×5.
- **Empty:** a cohort with no supported games is explicit.
- **Pure rules:** exact tie; a one-ulp-of-0.5 perturbation that `math.fsum` rounds away, so it is a tie under the frozen rule; a 2⁻⁵¹ perturbation whose rounded sum differs, giving blue or red; unsupported malformed queries ignored, invalid or nonfinite fractions rejected, wrong side counts/side/status/missing queries rejected, strict label join, a full counts/2×2/league fixture, and an empty evaluation.
- **Binomial:** known exact values (0/0 None, 0/1 1.0, 5/5 0.0625, 8/10 and 2/10 0.109375, 5/10 1.0, 0/20 2⁻¹⁹) and bad-count rejection.
- **CLI:** the output structure is allowlisted with a key scan and no `oe:`-prefixed strings (no generic word bans), the output paths are refused, the hash, timezone and no-overwrite guards hold, wrong library bytes are rejected, and a source changed during the run writes nothing.

### Checks for Codex
- Ruff and pytest for the new tests, `tests/test_metric_context_cohort.py` and the independent `tests/test_metric_context_cohort_review.py`.
- Rerun the cohort CLI on fcd2 and compare its substantive sections with `outputs/metric-context-cohort-final-fcd2-20261120.json`, recording any source-fingerprint metadata difference explicitly.
- Then run the directional CLI and record the result here.

### Remaining risks
- The fixture's 2×2 cells are each exercised by the pure-function test rather than by real adapter games.
- `side` relies on the raw `side` column after `_game_issue` (whose identity check requires exactly 5 roles per side), not on participant ordering.
- The single supported fixture game cannot exercise the by-league appendix across leagues on adapter data.

## Actual pinned-data result (Codex, after frozen spec7686e064)
Input fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de, actual retrieved-at2026-11-11T02:19:29.155420Z. No download performed.
- Supported198/878 (22.6%); unsupported680 unscored, no fallback.97 concordant,92 discordant,9 exact ties. Half-credit directional agreement **51.26%**.
- SAME198 games: fixed half50.00%, BlueLaplace56.06%, chronological teamElo55.56%. Their Brier/logloss rows match prior same-set results; whole878 scores are not substituted.
- Sign test non-ties189,97 concordant, exploratory exact p0.7711746227. Paired McNemar37 signal-only vs44 Elo-only,81 discordant pairs, p0.5052364408; signal ties9 excluded from paired2x2 and accounted separately.
- Decision: this fixed single descriptive metric did NOT show directional value beyond team baselines in this already-seen selected sample. No feature admission, player strength score, substitution effect, engine change or gate relaxation. This is not proof that every player metric is useless.
- Tests additionally assume independent game pairs for the nominal binomial interpretation; repeated teams/series may violate that assumption. Exploratory p-values are not calibrated confidence evidence or independent confirmation.
- Artifact outputs/context-signal-direction-fcd2-20261120.json. Existing cohort rerun outputs/metric-context-cohort-refactor-fcd2-20261120.json equals prior parsed report at EVERY field (no differing paths). Substantive and metadata fields unchanged in this actual run; no hashes were stripped to force equality.
- Related55/55 plus ruff check/format pass. FullPython840/840 pass19.51s, outputs/python-context-direction-integration-20261120.log. Independent tests enumerate all binary outcomes up to10 trials and audit paired tie accounting.
- Initial test-only failures (missing fixture directories; one-ULP perturbation that rounds to equal fsum totals) were returned to same Claude. Claude corrected fixtures and explicitly tested rounded tie versus a representably different sum; algorithm/spec/tie tolerance unchanged.
- Source implementation/refactor by Claude, independent tests/docs/run by Codex. No web change, new data, probabilities from signal, fitting/tuning, product push/merge/deploy.
