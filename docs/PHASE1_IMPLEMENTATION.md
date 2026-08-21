# Phase 1 Implementation

## Scope

Phase 1 is an executable evaluation foundation. It proves that the project can represent
point-in-time data, prevent feature leakage, rank candidates with transparent heuristics, and score
those rankings against a future window without an LLM, network source, database, or private data.

It does **not** establish predictive performance on real League of Legends data.

## Package layout

```text
src/pro_meta_intelligence/
  ingestion/        # source protocols and deterministic fixture adapters
  baselines/        # explicit non-ML ranking formulas
  backtest/         # outcome labeling, metrics, and JSON report
  fixtures/         # versioned synthetic scenario
  models.py         # immutable domain and provenance contracts
  leakage.py        # reusable cutoff filters and strict validation
  cli.py             # evaluation entrypoint
tests/
```

Issue #2 names `src/pro_meta_intelligence/`; that name takes precedence over the abbreviated
`src/pro_meta/` example in the earlier Phase 0 build plan.

## Time contract

The implementation maps the Phase 0 `event_time` concept to `observed_at`:

- `observed_at`: when the represented event or aggregate window occurred,
- `available_at`: when the analysis system could have used that record,
- `retrieved_at`: when this stored source version was retrieved for the dataset.

Feature materialization always filters on `available_at <= cutoff`. Equality is allowed. The
`reject_future` guard is applied again to the materialized snapshot and generated candidate signals
so a future record fails loudly if it crosses the feature boundary.

Future outcomes are separate from features. They are read only up to `evaluation_end` and are used
only after rankings have been generated.

## Domain models

The immutable dataclasses include the models required by Issue #2:

- `PatchSnapshot`
- `MatchRecord`
- `PickBanEvent`
- `PlayerChampionUsage`
- `EvidenceRecord`
- `CandidateSignal`
- `BacktestWindow`

Source records carry a `Provenance` value with source ID/type/URI/version, retrieval time, content
hash, and schema version. Fixture hashes are stable fixture identifiers; they are not represented as
cryptographic verification of a real upstream payload.

## Fixture adapters

The three protocols are intentionally small:

- `PatchDataSource`
- `ProMatchDataSource`
- `SoloQueueDataSource`

The included adapters read a local JSON scenario. They make CI and development fully offline and
deterministic. They are adapter examples, not Riot, Data Dragon, or Oracle's Elixir connectors.

## Baseline formulas

### Recent pro presence change

```text
score = recent unique-match presence / recent matches
      - prior unique-match presence / prior matches
```

The current implementation treats both picks and bans as presence and compares adjacent seven-day
windows. Only positive deltas become candidates.

### High-Elo usage change

```text
score = current pick_count / current game_count
      - prior pick_count / prior game_count
```

The two latest available aggregate windows per champion-role are compared. Sample-size policy beyond
the explicit denominator is deferred until a real source contract exists.

### Patch buff heuristic

```text
score = 1 for a direct BUFF in the latest available patch snapshot
```

This is deliberately categorical. It is not a probability and does not estimate buff magnitude.

Every candidate includes the formula, named component values, evidence IDs, an explanation, and the
latest observed/available timestamps used by the signal.

## Synthetic scenario

The fixture contains:

- Zyra jungle as a candidate that is picked twice after the cutoff,
- Shyvana jungle as a detected false positive,
- a future Karthus high-Elo row with a deliberately extreme value,
- adjacent pre-cutoff pro and high-Elo windows,
- direct synthetic patch changes.

The Karthus row is unavailable at the cutoff and cannot enter any baseline. With `top_k=2`, all three
baselines find Zyra and retain one false alert. This is designed to validate mechanics, not to make a
balance claim about any real champion or patch.

## Metrics and output

The backtest reports:

- Recall@K
- Precision@K
- false-alert rate and count
- median lead time in hours
- full deterministic candidate rankings

The minimal outcome label is at least two future professional `PICK` events within the evaluation
window. That threshold is part of the scenario rather than tuned after the result.

Run:

```bash
python -m pro_meta_intelligence evaluate --output outputs/synthetic-backtest.json
```

## Known limitations

- All evaluation data is synthetic.
- The adoption label does not yet enforce tier classification, pre-window off-meta thresholds, patch
  continuity, role-resolution confidence, or strategic context.
- Presence uses event availability and unique match IDs but has no upstream QA layer yet.
- High-Elo aggregates do not yet include region, queue, sample-size guards, or source corrections.
- Patch buffs are manually labeled by the fixture and do not parse patch-note semantics.
- Lead time is measured from the evaluation cutoff to first qualifying adoption, not from a
  continuously monitored first-alert event.
- No real-source licensing, terms, availability-lag, or correction policy has been implemented.

## Next acceptance gate

Before treating results as evidence of real utility:

1. Implement one real source adapter at a time behind the existing protocols.
2. Record and test each source's conservative availability policy.
3. Add upstream QA and immutable content hashing.
4. Freeze a meaningful-adoption policy before inspecting holdout outcomes.
5. Run multiple historical cutoffs and publish misses as well as successes.
6. Add region, team, role-resolution, and sample-size handling only with tests and ablations.

LLMs, RAG, agents, crawling, a dashboard, private-team features, and Creator Mode remain intentionally
outside Phase 1.
