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
