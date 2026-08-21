# Roadmap

## Phase 0 — Evidence Feasibility

Goal: prove what data can be obtained legally, reproducibly, and with enough historical depth.

Deliverables:

- source inventory
- terms/access notes
- patch coverage map
- sample raw snapshots
- `AVAILABLE / LIMITED / RESEARCH / REJECTED` classification

Exit gate: no core feature depends on an unverified source.

## Phase 1 — Historical Data Spine

Build normalized schemas for:

- patches
- tournaments / games
- teams / players
- champions / roles
- picks / bans / draft positions
- derived region/team metrics

Add immutable historical cutoff support.

Exit gate: recreate selected historical tournament snapshots without future leakage.

## Phase 2 — Baseline Meta Radar

Implement transparent baseline features:

- presence
- pick / ban deltas
- regional divergence
- team concentration
- demand / demand velocity

Build first patch-level analyst page.

Exit gate: metrics are reproducible and explainable from raw records.

## Phase 3 — Blind Spot Benchmark

Define review-candidate labels and historical evaluation windows.

Run baseline backtests before ML.

Deliver:

- Recall@K
- lead time
- false alerts
- failure-case log

Exit gate: clear benchmark against which future complexity will be judged.

## Phase 4 — Expert / OTP Evidence

Validate high-Elo / OTP / expert sources and ingestion policy.

Add:

- original source retention
- Korean translation
- opinion vs fact labeling
- quantitative support / contradiction

Exit gate: demonstrate whether expert signals improve historical candidate ranking.

## Phase 5 — Player Familiarity / Test-cost Proxy

Research public-history features that can estimate relative familiarity without overstating stage readiness.

Exit gate: useful ranking or documented rejection if no robust signal exists.

## Phase 6 — Analysis Harness

Implement independent specialist passes, skeptic, judge, evidence board, and human analyst decisions.

Run A/B comparisons against single-agent and non-LLM baselines.

Exit gate: multi-agent path must justify added cost/latency or be simplified.

## Phase 7 — Strategy Agent + Emergency Brief

Natural-language querying over verified structured data.

Core examples:

- regional divergence this patch
- non-obvious jungle test candidates
- evidence for/against a candidate
- historical analogues
- 3-minute match-day brief

Exit gate: generated answers remain grounded and traceable.

## Phase 8 — Synthetic Private Team Demo

Create a clearly synthetic team dataset for:

- scrim results
- internal test notes
- player feedback
- candidate state transitions

Show how the same public engine becomes team-specific when an authorized private adapter is connected.

Exit gate: private data boundary and no-external-LLM mode demonstrated.

## Phase 9 — Professional Prototype

Required presentation package:

- deployed service
- clean GitHub repository
- benchmark report
- case studies
- strategy brief PDF
- 3–5 minute demo
- separate esports data/strategy resume entry

## Submission Rule

Do not submit because the UI looks finished.

Submit only when the repository can answer:

1. What problem does this reduce for a professional staff?
2. What evidence proves the ranking is useful?
3. Where does the system fail?
4. Why is each AI component necessary?
5. How is private team data protected?
