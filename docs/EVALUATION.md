# Evaluation

## 1. Evaluation Philosophy

The project should prefer falsifiable claims over impressive demos.

A complex method must justify itself against simpler baselines. If an LLM, ML model, or multi-agent harness does not improve measurable decision support, it should be removed, simplified, or clearly labeled experimental.

## 2. Primary Metrics

### Candidate Recall@K
Among later-relevant non-obvious picks, how many were already present in the top-K review candidates before adoption?

### Median Lead Time
How early did the system surface a candidate before meaningful professional adoption or strategic appearance?

### False Alert Rate
How often did high-priority candidates fail to produce useful downstream evidence or adoption?

### Review Compression
How much analyst/staff review time is reduced compared with manual browsing or unranked candidate lists?

### Evidence Coverage
What percentage of user-facing claims can be traced to a source or reproducible derived metric?

### Calibration
When the system reports confidence, does observed reliability match that confidence range?

## 3. Baselines

At minimum compare against:

- patch buff / nerf magnitude ranking,
- high-Elo pick-rate delta,
- high-Elo ban-rate delta,
- pro presence delta,
- regional divergence only,
- team concentration only,
- simple weighted heuristic.

If a learned model cannot beat a transparent heuristic, keep the heuristic.

## 4. Time-locked Backtesting

Evaluation must use walk-forward or rolling historical cutoffs.

Example:

1. Freeze all data at date T.
2. Generate top-K candidates using only data available by T.
3. Observe professional adoption in a future evaluation window.
4. Score recall, lead time, and false alerts.
5. Advance the cutoff and repeat.

The implemented Oracle's Elixir path is documented in
[`BLIND_SPOT_BENCHMARK.md`](BLIND_SPOT_BENCHMARK.md). It consumes only matured hash pairs named by
the immutable history audit and keeps the future outcome import out of candidate generation.

Future information leakage is considered a critical failure.

## 5. Holdout Strategy

Do not tune specifically on famous cases such as the 2025 Worlds jungle Mundo example and then present that case as proof.

Recommended pattern:

- Development events: older MSI / Worlds / regional playoffs
- Validation events: separate tournaments / seasons
- Final holdout: an event never used for feature design or threshold tuning

## 6. Ablation Tests

Measure whether each expensive component earns its place.

Examples:

- without expert/OTP signal
- without historical similarity
- without player-fit proxy
- without LLM synthesis
- single agent vs multi-agent
- no skeptic agent vs skeptic agent
- heuristic vs ML

## 7. Multi-Agent Evaluation

Each agent should be scored independently where possible:

- recall
- precision / false alerts
- lead time
- evidence quality
- disagreement usefulness

The ensemble should not receive credit simply for having more agents.

## 8. Human Evaluation

Potential analyst/staff study:

- task completion time
- number of evidence sources opened
- ability to identify the strongest candidate
- ability to identify uncertainty/counterevidence
- subjective trust only as a secondary metric

## 9. Failure Case Log

Every meaningful miss or false positive should be documented with:

- historical cutoff
- candidate
- system score
- evidence available at the time
- why the model/analyst was wrong
- whether the error implies a feature, data, or framing change

## 10. Professional Submission Gate

Before presenting the prototype as a serious esports analytics portfolio, require:

- at least one reproducible historical benchmark suite,
- baseline table,
- leakage checks,
- documented failure cases,
- transparent limitations,
- evidence trace for demo claims.
