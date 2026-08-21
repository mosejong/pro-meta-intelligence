# Data and Evidence

## 1. Evidence Classes

Every insight should identify its evidence class.

### A. Structured Competitive Data
Examples: game results, picks/bans, side, draft order, role, tournament, patch.

### B. Solo Queue / High-Elo Signals
Examples: pick-rate change, role migration, build shifts, player practice frequency, rank-bucket adoption.

### C. OTP / Expert Signals
Examples: public specialist commentary, guide updates, stream/video analysis, public social posts.

### D. Patch / System Context
Champion, item, rune, objective, map, economy, and system changes.

### E. Private Team Evidence
Authorized scrim/test/feedback data only. Synthetic data in the public prototype.

## 2. Evidence Rules

- Store source URL or durable source identifier when permitted.
- Store observed timestamp and patch context.
- Preserve original language where possible.
- Korean translation is a derived artifact, not the source of truth.
- Separate direct observation from analyst inference.
- Never convert OTP/expert opinion directly into a ground-truth label.
- Record missingness explicitly.

## 3. Candidate Signal Families

Potential signal groups:

- global / regional pick-ban presence
- regional divergence
- team-specific concentration
- player-specific concentration
- draft-position specificity
- high-Elo demand and demand velocity
- OTP build or role transition
- patch causal plausibility
- expert commentary agreement/disagreement
- historical analogues

No single signal is sufficient to declare a pick strategically valid.

## 4. Patch Demand

`Demand` describes adoption/attention level.

`Demand Velocity` describes the rate of change.

Potential observations:

- SoloQ pick/ban-rate delta
- high-Elo delta
- new high-Elo adopters
- OTP build migration
- pro practice/adoption where publicly observable
- external analysis volume, with strong spam/duplication controls

Demand is not equivalent to strength.

## 5. Expert / OTP Intelligence

Each expert item should ideally store:

- source identity / handle
- source type
- region / rank context when verified
- champion / role
- patch
- original statement
- Korean translation
- extracted claim
- confidence in extraction
- supporting quantitative evidence
- contradicting evidence

## 6. Translation Requirements

- Preserve domain terms when a Korean equivalent would distort meaning.
- Keep the original excerpt/source accessible.
- Mark ambiguous slang rather than forcing a translation.
- Summaries must distinguish fact, opinion, and prediction.

## 7. Historical Snapshots

Backtests require immutable time cutoffs.

For each evaluation date, construct a snapshot containing only information available at or before that timestamp. No later tournament result, guide update, patch interpretation, or retrospective article may enter the feature set.

## 8. Data Source Status Matrix

Every candidate data source should be categorized before implementation:

- `AVAILABLE` — documented, legal, stable enough for prototype use
- `LIMITED` — useful but incomplete, rate-limited, or region-restricted
- `RESEARCH` — source exists but access/terms/coverage require validation
- `REJECTED` — unreliable, prohibited, non-reproducible, or inappropriate

The project should not silently scrape around access restrictions.

## 9. Provenance First

Every user-facing strategic claim should answer:

1. What data supports this?
2. What contradicts it?
3. What patch/time window does it cover?
4. How large is the sample?
5. Is this measured, inferred, translated opinion, or model output?
