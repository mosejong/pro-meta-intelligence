# Pro Meta Intelligence

> **Detect what is worth testing before practice time is wasted.**

Pro Meta Intelligence is an evidence-driven League of Legends esports strategy intelligence platform designed to surface **blind spots, joker-pick candidates, regional meta divergence, and practice-efficient test candidates** from public data.

The goal is not to replace coaches or players with AI. The goal is to reduce information-search cost and help analysts bring better questions, evidence, and test candidates to coaching staff and players.

## Core Product Thesis

Professional teams operate under limited practice time. A useful system should therefore optimize for two things at once:

1. **Blind Spot Recall** — reduce the chance that a strategically relevant pick is never reviewed.
2. **Practice Efficiency** — reduce the number of low-value candidates that consume player and scrim time.

The system ranks candidates for review, not as automatic truths.

## Main Capabilities

- **Global Meta Radar** — patch-level analysis across regions, teams, roles, and draft positions.
- **Blind Spot / Joker Detector** — finds picks that are underrepresented globally but show meaningful regional, team, high-Elo, or OTP signals.
- **Patch Demand & Demand Velocity** — tracks how quickly interest and adoption change after a patch.
- **OTP / Expert Intelligence** — collects high-level one-trick and expert signals with source, timestamp, translation, and evidence status.
- **Player Fit & Estimated Test Cost** — estimates familiarity and low-cost test candidates from public player history without pretending to know private scrim mastery.
- **Staff-era Draft Fingerprint** — describes recurring draft patterns while avoiding unsupported causal attribution to an individual coach.
- **Historical Similarity & Backtesting** — performs time-locked evaluation using only information available at a historical cutoff.
- **Strategy Agent** — lets analysts query the evidence layer in natural language.
- **Emergency Brief** — produces a short match-day or patch-drop briefing for time-constrained staff.
- **Private Team Adapter** — supports private scrim and internal feedback schemas without mixing them into public AI services.
- **Analysis Harness** — compares multiple independent agents, baselines, counterarguments, evidence, and human decisions.

## Non-goals

- Predicting the single "correct" draft.
- Claiming that public solo-queue activity equals stage readiness.
- Attributing a team draft choice to one coach without sufficient evidence.
- Treating community or OTP opinions as ground truth.
- Using LLM output as a substitute for statistical validation.

## Evaluation First

The project will compare complex methods against simple baselines. Candidate systems must beat or justify their complexity against methods such as:

- patch buff ranking,
- Challenger pick-rate growth,
- pro presence growth,
- simple regional divergence scores.

Primary evaluation targets:

- `Recall@K` for later-relevant non-meta / joker candidates,
- median lead time,
- false-alert rate,
- analyst review-time reduction,
- calibration / confidence quality,
- ablation results for expert signals, agents, and ML components.

## Architecture

See:

- [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DATA_AND_EVIDENCE.md`](docs/DATA_AND_EVIDENCE.md)
- [`docs/EVALUATION.md`](docs/EVALUATION.md)
- [`docs/ANALYSIS_HARNESS.md`](docs/ANALYSIS_HARNESS.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Design Principle

**Deep when there is time. Short when there is not. Evidence first in both cases.**

The public prototype will use only public or synthetic data. Any private team layer will be demonstrated with synthetic scrim records unless an authorized team dataset is explicitly provided.

## Current implementation status

The repository now combines the Phase 1 evaluation foundation with an operational Phase 2 current
data path:

- immutable typed records with separate `observed_at` and `available_at`,
- reusable point-in-time filtering and strict future-data rejection,
- offline adapters for patch, professional match, and high-Elo aggregate fixtures,
- three transparent baselines,
- deterministic top-K backtesting and JSON output,
- a synthetic adoption/false-positive scenario,
- reviewed Oracle's Elixir acquisition, validation, and immutable local archiving,
- explicit current-patch publication readiness with disclosed exclusions,
- an immutable OE walk-forward Blind Spot Benchmark with separate cutoff/outcome hashes, Recall@K,
  lead time, false alerts, evidence coverage, and miss logs,
- an explainable real-data Meta Radar/Creator snapshot feed and public static dashboard,
- a meeting-ready Team Decision Brief with evidence, counterevidence, practice questions, stop
  conditions, print/PDF output, and machine-readable JSON handoff.
- a selectable Opponent Prep Pack with same-patch side splits, phase-aware picks and bans, observed
  first rotations, quality warnings, and exact match evidence.
- a three-minute Match-day Emergency Brief that cross-checks opponent preferences against global
  champion-role signals, separates the patch test queue, and exports or prints with evidence.
- an own-team lens that combines official upcoming fixtures with same-league relevance, contested
  picks, current meta overlap, sample strength, and data quality to rank which opponent to review first.

This is not yet evidence of predictive value. Real point-in-time daily snapshots must accumulate
before Phase 3 can measure Recall@K, lead time, and false-alert behavior without hindsight leakage.

## Quick start

Requires Python 3.11 or newer.

```bash
python -m pip install -e ".[dev]"
python -m pytest
python -m ruff check src tests
python -m ruff format --check src tests
python -m pro_meta_intelligence evaluate --output outputs/synthetic-backtest.json
```

The generated report is explicitly marked `fixture_only: true`.

See also:

- [`docs/PHASE1_IMPLEMENTATION.md`](docs/PHASE1_IMPLEMENTATION.md)
- [`docs/SOURCE_REGISTRY.md`](docs/SOURCE_REGISTRY.md)
- [`docs/ORACLES_ELIXIR_IMPORT.md`](docs/ORACLES_ELIXIR_IMPORT.md)
- [`docs/OE_COVERAGE_AUDIT.md`](docs/OE_COVERAGE_AUDIT.md)
- [`docs/LEAGUE_REGION_MAP.md`](docs/LEAGUE_REGION_MAP.md)
- [`docs/OE_HISTORY_READINESS.md`](docs/OE_HISTORY_READINESS.md)
- [`docs/BLIND_SPOT_BENCHMARK.md`](docs/BLIND_SPOT_BENCHMARK.md)
- [`docs/META_RADAR.md`](docs/META_RADAR.md)
- [`docs/SNAPSHOT_FEED.md`](docs/SNAPSHOT_FEED.md)
- [`docs/FEED_JOB.md`](docs/FEED_JOB.md)
- [`docs/CREATOR_BRIEF.md`](docs/CREATOR_BRIEF.md)
- [`docs/TEAM_DECISION_BRIEF.md`](docs/TEAM_DECISION_BRIEF.md)
- [`docs/OPPONENT_PREP.md`](docs/OPPONENT_PREP.md)
- [`docs/EMERGENCY_BRIEF.md`](docs/EMERGENCY_BRIEF.md)
- [`docs/COMPETITIVE_POSITIONING.md`](docs/COMPETITIVE_POSITIONING.md)
- [`web/README.md`](web/README.md)
- [`docs/PRODUCT_MODES.md`](docs/PRODUCT_MODES.md)

## Policy-gated static-data ingestion

The source layer now includes a fail-closed registry, Riot Data Dragon static JSON ingestion, and a
validated local-import path for Oracle's Elixir professional-match CSV snapshots. It does not enable
arbitrary crawling or Riot Web API access.

```bash
python -m pro_meta_intelligence sources
python -m pro_meta_intelligence fetch-oe \
  --year 2026 \
  --archive-dir outputs/oracles-elixir/raw
python -m pro_meta_intelligence sync-oe-feed \
  --year 2026 \
  --source-timezone UTC
python -m pro_meta_intelligence fetch-ddragon --version latest --locale en_US
python -m pro_meta_intelligence import-oe \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --output outputs/oracles-elixir/import-report.json
python -m pro_meta_intelligence audit-oe-coverage \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --output outputs/oracles-elixir/coverage.json
python -m pro_meta_intelligence audit-oe-history \
  --archive-dir outputs/oracles-elixir/raw \
  --source-timezone UTC \
  --output outputs/oracles-elixir/history-readiness.json
python -m pro_meta_intelligence benchmark-oe-history \
  --archive-dir outputs/oracles-elixir/raw \
  --source-timezone UTC \
  --output outputs/oracles-elixir/blind-spot-benchmark.json
python -m pro_meta_intelligence benchmark-oe \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --radar-output outputs/oracles-elixir/radar-2026.json \
  --output outputs/oracles-elixir/benchmark-2026.json
```

Raw responses are stored under the ignored `outputs/ddragon/` directory by content hash. A raw
catalog is normalized into a temporal snapshot only when a separately verified patch release time is
provided with `--release-at`.

The Oracle's Elixir downloader is restricted to exact annual file IDs verified in the provider's
official folder, enforces the published daily interval, rejects HTML quota pages and schema drift,
and archives the raw CSV by content hash without republishing it. The importer also accepts a
caller-supplied local file, rejects malformed games, normalizes validated match and pick records,
and uses the explicit retrieval time as conservative `available_at`. A current annual file is never
backdated into an earlier historical cutoff.

`sync-oe-feed` is the unattended path. Under one exclusive writer lock it downloads the reviewed
file when the daily interval permits, otherwise reuses only the newest verified archive, validates
and normalizes it, and advances the Radar/Creator feed. If the provider is unavailable and no cache
exists, it leaves the current public feed unchanged.

The same sync also audits the immutable archive and attempts the walk-forward benchmark. It writes
a compact, public-safe `web/public/feed/history-status.json` with four operational gates: retrievals,
distinct normalized states, collection span, and matured future-outcome cutoffs. The dashboard reads
that status independently from the main Radar feed, so collection progress can advance even when a
new Radar publication is rejected or unchanged. Raw provider rows and the detailed private audit
remain under the ignored `outputs/` archive.

Production operators can turn those artifacts into a fail-closed freshness signal with
`check-oe-feed-health`. The initial `HISTORY_NOT_READY` collection phase remains healthy, while a
failed or stale job, stale source snapshot, invalid public feed, or missing history status returns a
nonzero exit code. A reviewed Windows runner and Task Scheduler registration script are documented
in [`docs/PRODUCTION_OPERATIONS.md`](docs/PRODUCTION_OPERATIONS.md).

The reviewed Windows publisher can optionally copy only `current.json` and `history-status.json`
into a locked detached worktree and fast-forward them to the publication branch. It refuses dirty
state, unexpected staged paths, unhealthy feeds, and non-fast-forward pushes; raw archives never
enter the publisher worktree.

Before an unattended publication, the annual coverage audit checks the selected patch's validated
match, distinct-team, and mapped-region counts, blocking import-contract issues, and unknown
leagues. Reviewed incomplete games and missing team IDs may be excluded only when the remaining
sample passes; their patch/league/code counts and warnings are embedded in the published feed. It
exposes measurements and reason codes rather than a composite score. A failed readiness gate is
audited and leaves the existing public feed unchanged.

Historical backtests have a stricter contract. `audit-oe-history` verifies every archived metadata
record and raw file, deeply imports each distinct content version at its earliest retrieval time,
measures collection gaps, and counts cutoffs with a later outcome window. It performs no network
request and never treats repeated unchanged bytes as a new historical state.

`benchmark-oe` measures import, Radar construction, serialization, throughput, and output size over
a caller-supplied real file. Its committed report contains only aggregate evidence and a source hash;
provider rows stay outside Git. See [`docs/OE_REAL_FILE_BENCHMARK.md`](docs/OE_REAL_FILE_BENCHMARK.md).

## Explainable Meta Radar

Phase 2 now has a deterministic JSON analyst snapshot over validated professional picks:

```bash
python -m pro_meta_intelligence build-radar \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --retrieved-at 2026-08-22T03:00:00Z \
  --cutoff 2026-08-22T03:00:00Z \
  --output outputs/meta-radar/current.json
```

The report exposes pick presence and change, distinct-team demand and velocity, regional divergence,
team concentration, sample warnings, source versions, match IDs, pick-event IDs, and every formula.
It has no learned or arbitrary composite score. Current Oracle's Elixir normalization is pick-only,
so the report does not claim pick/ban presence.

## Analyst dashboard

The [public Meta Radar](https://mosejong.github.io/pro-meta-intelligence/) turns the currently
published real provider snapshot into an interactive analyst surface. The `web/` app includes
role and eligibility filters, selectable candidate evidence, quality warnings, regional comparison,
and an evidence packet with event IDs, match IDs, source hashes, and formulas. It ships with a
same-origin real feed plus a deterministic fallback snapshot, and accepts local JSON through the
browser; uploaded files are parsed on the device and are not sent to an application server.

## Snapshot feed and Creator brief

One unattended-safe command can now rebuild a Radar report from a caller-supplied local CSV, create
a claim-locked Creator Mode brief, archive both as an immutable version, and atomically advance
`current.json`, `current-creator.json`, and `index.json`:

```bash
python -m pro_meta_intelligence refresh-feed \
  --input path/to/oracles-elixir.csv \
  --source-timezone UTC \
  --feed-dir outputs/meta-radar-feed \
  --fail-on-import-issues
```

The refresh command performs no network collection and calls no AI API. The scheduler-ready wrapper
adds an exclusive local writer lock and immutable run audit:

```bash
python -m pro_meta_intelligence run-feed-job --config configs/feed-job.example.json
```

The dashboard automatically consumes `web/public/feed/current.json`, rechecks it every five
minutes, and distinguishes published, synthetic-demo, local-file, and fallback states. It contains
no ChatGPT/OpenAI login flow; any login page shown before the dashboard is hosting access control.

```bash
cd web
npm install
npm run dev
```
