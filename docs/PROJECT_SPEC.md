# Project Spec

## 1. Problem

League of Legends professional teams face a recurring information problem: there are more patches, regions, teams, players, solo-queue experiments, OTP innovations, draft patterns, and external evaluations than a coaching staff can manually inspect in depth.

The product problem is therefore not "predict the best champion." It is:

> **How can we reduce the chance that a strategically relevant option is never reviewed, while minimizing the practice time spent on low-value candidates?**

## 2. Users

Primary users:

- Esports data / strategy analysts
- Coaches and strategic staff
- Performance staff

Secondary users:

- Players receiving filtered test candidates
- Management reviewing analytical process quality

## 3. Core Decisions Supported

- Which non-obvious picks deserve review this patch?
- Which region or team is interpreting the patch differently?
- Is a pick a real emerging signal or noise?
- Which candidates are cheap enough to test under limited practice time?
- What changed after a series loss or across a staff era?
- What did high-Elo / OTP specialists discover before pro adoption?
- What is known, uncertain, contradicted, or unsupported?

## 4. Product Modules

### 4.1 Global Meta Radar
Patch-normalized region/team/role/draft-position analysis.

### 4.2 Blind Spot / Joker Detector
Finds strategically unusual candidates using multiple weak signals rather than raw win rate alone.

### 4.3 Demand & Demand Velocity
Tracks adoption level and speed across tiers, regions, OTPs, and pro play.

### 4.4 Expert / OTP Intelligence
Stores source-level statements, translated summaries, patch context, rank/context metadata, and agreement with quantitative evidence.

### 4.5 Player Fit / Estimated Test Cost
Uses public history only to estimate familiarity and candidate test cost. It does **not** claim to know private scrim mastery or stage readiness.

### 4.6 Staff-era Draft Fingerprint
Measures recurring patterns over defined staff/roster periods, controlling for patch, side, opponent, and player context where feasible.

### 4.7 Historical Similarity
Retrieves comparable prior patches, draft environments, champion archetypes, and strategic states.

### 4.8 Strategy Agent
Natural-language interface over structured evidence. The LLM should never be the primary analytical source.

### 4.9 Emergency Brief
A compressed 3-minute operational view for patch drops, match day, joker alerts, and opponent changes.

### 4.10 Private Team Layer
Adapter interface for authorized scrim/test/internal evaluation data. Public prototype uses synthetic data only.

## 5. AI Role

AI is a research and synthesis layer, not the decision-maker.

Allowed roles:

- translate external analysis into Korean while preserving source meaning,
- summarize evidence already retrieved,
- compare agent disagreement,
- explain why a metric changed,
- generate concise briefs from verified data.

Disallowed product claims:

- "AI found the objectively best pick"
- "AI knows player mastery from solo queue"
- "AI can infer a coach's private intent"

## 6. Multi-Agent Analysis Harness

Independent specialist agents may inspect separate evidence sets:

- Meta Agent
- SoloQ / OTP Agent
- Draft Agent
- Player Fit Agent
- Skeptic / Counterevidence Agent
- Judge / Aggregator

Agents should not see one another's initial conclusions. The system stores evidence, claims, confidence, counterarguments, final aggregation, human analyst decision, and later outcome.

## 7. Success Criteria

A feature survives only if it improves one of these:

- candidate recall,
- lead time,
- false-alert control,
- analyst review time,
- evidence quality,
- decision traceability.

A complex ML or multi-agent approach that does not beat a simple baseline should be removed or demoted.

## 8. Submission Standard

Target quality: suitable for submission as an esports data/strategy portfolio prototype, not a course-demo artifact.

Required proof:

- reproducible data pipeline,
- time-locked backtests,
- baseline comparisons,
- documented failure cases,
- evidence trace UI,
- synthetic private-team demo,
- live service / demo,
- strategy brief PDF,
- 3–5 minute product demo.
