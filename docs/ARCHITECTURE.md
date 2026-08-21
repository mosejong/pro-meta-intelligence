# Architecture

## 1. High-level Flow

```text
Patch Notes / Pro Matches / SoloQ / High-Elo / OTP / Expert Sources
                              │
                              ▼
                     Ingestion + Normalization
                              │
                              ▼
                      Patch Feature Store
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       Meta Engine      Signal Engine     Retrieval Layer
              │               │               │
              ├───── Blind Spot / Joker ─────┤
              │               │               │
              ▼               ▼               ▼
         Player Fit      Draft Fingerprint  Historical Search
              └───────────────┬───────────────┘
                              ▼
                    Analysis Harness / Judge
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
             Strategy Workspace    Emergency Brief
                    │
                    ▼
                 Human Analyst
                    │
                    ▼
              Coach / Player Decision
```

## 2. Data Layers

### Public Evidence Layer
Contains only legally/publicly obtainable sources and derived features.

Typical entities:

- patch
- league / region
- tournament / series / game
- team / player
- champion / role
- draft position / side
- build / rune / item sequence where available
- source document / clip / post metadata
- translated summary

### Private Team Layer
Strictly isolated adapter contract for authorized internal data.

Example interface only:

- scrim result
- internal test note
- player feedback
- coach evaluation
- internal tier status
- candidate lifecycle state

The public repository must never contain real private team data unless explicitly authorized.

## 3. Candidate Lifecycle

```text
DISCOVERED
   ↓
WATCH
   ↓
TEST_CANDIDATE
   ↓
CONDITIONAL_TEST / PRIORITY_TEST
   ↓
TEAM_TESTED
   ↓
ADOPTED / PARKED / REJECTED
```

Each transition must have evidence and timestamped reasoning.

## 4. Core Services

### Ingestion Service
- source connectors
- rate-limit handling
- schema normalization
- raw snapshot retention
- provenance metadata

### Patch Context Service
- patch boundaries
- champion changes
- item / rune / system changes
- temporal cutoff support

### Signal Engine
Derived features may include:

- regional divergence
- team concentration
- player concentration
- demand index
- demand velocity
- first-pick / ban priority
- draft-position specificity
- adoption lead time
- source agreement

### Blind Spot Engine
Ranks review candidates while exposing uncertainty and counterevidence.

### Player Fit Service
Public-data proxy only. Outputs familiarity/transferability estimates, not claims of stage readiness.

### Historical Backtest Service
Enforces information cutoffs. Future data leakage is a test failure.

### Evidence Retrieval Service
Every generated statement should be traceable to source-level evidence or computed metrics.

### Strategy Agent
Tool-using conversational layer that can query structured metrics and evidence.

### Emergency Brief Service
Produces compressed operational summaries from already verified facts.

## 5. Storage Direction

Initial target stack:

- PostgreSQL for normalized relational data
- optional pgvector for semantic retrieval over source notes / expert commentary
- object storage or immutable local archive for raw snapshots
- Redis only if caching / job coordination is proven necessary

Do not introduce infrastructure for résumé optics alone.

## 6. Backend Direction

Likely stack:

- Python
- FastAPI
- SQLAlchemy / SQLModel or equivalent
- Pandas / Polars for research pipelines
- scikit-learn / statistical methods first
- ML only where backtests justify complexity
- pytest
- GitHub Actions

## 7. Security Boundary

Private team data should be capable of operating in a mode where:

- no external LLM receives private records,
- private prompts are processed locally or with an explicitly approved provider,
- public and private retrieval indexes are separated,
- audit logs show which evidence crossed which boundary.

## 8. UX Principle

Two modes:

### Analyst Mode
Deep evidence, traces, disagreements, historical comparisons, metrics, source inspection.

### Staff Mode
Fast decision support:

- why this matters,
- what changed,
- what to test,
- what not to overclaim,
- confidence / sample limitations.
