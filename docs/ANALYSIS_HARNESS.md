# Analysis Harness

## 1. Goal

The harness exists to make analytical reasoning inspectable, comparable, and evaluable. It is not a decorative multi-agent demo.

## 2. Independent Specialist Passes

Initial specialist roles:

- **Meta Agent** — global / regional professional meta signals
- **SoloQ-OTP Agent** — high-Elo, role migration, build shifts, specialist signals
- **Draft Agent** — side, phase, pick order, composition, opponent context
- **Player Fit Agent** — public player history and estimated familiarity
- **Skeptic Agent** — sample-size issues, confounders, contradictory evidence, reasons not to test

Initial passes should be isolated from one another's conclusions to reduce convergence bias.

## 3. Evidence Contract

Each claim must return a structured record containing:

- claim
- stance: support / oppose / conditional
- confidence
- evidence IDs
- patch / time cutoff
- sample size where relevant
- caveats
- falsifier: what evidence would change the conclusion?

## 4. Judge / Aggregator

The judge does not simply average scores.

Responsibilities:

- detect unsupported claims,
- compare agreement and disagreement,
- down-weight duplicate evidence,
- distinguish independent evidence from copied interpretation,
- surface the strongest counterargument,
- return a provisional action class.

Example actions:

- `IGNORE`
- `WATCH`
- `TEST_CANDIDATE`
- `CONDITIONAL_TEST`
- `PRIORITY_TEST`

## 5. Human Analyst Node

The analyst records:

- accept / reject / modify
- reasoning
- evidence added manually
- questions for coach/player
- suggested test design

Human disagreement with the ensemble is valuable evaluation data and must not be hidden.

## 6. Outcome Loop

When later evidence becomes available, record:

- pro adoption or non-adoption
- patch persistence
- public player uptake
- synthetic/private test outcome where authorized
- whether the initial recommendation was useful

The objective is to learn which evidence and which agent behavior actually helped.

## 7. Comparative Harness

Run comparable historical snapshots through:

- simple baseline
- single analytical agent
- multi-agent without skeptic
- multi-agent with skeptic
- ensemble + human analyst

Compare:

- Recall@K
- false alerts
- lead time
- evidence coverage
- latency / cost

## 8. Trace UX

Default staff view should remain concise:

- recommendation
- why now
- strongest evidence
- strongest counterevidence
- confidence / sample warning

Analyst mode may expand:

- agent-by-agent claims
- raw evidence
- disagreement graph
- translations / originals
- historical analogues
- judge rationale
- human decision

## 9. Anti-patterns

- agents debating without new evidence
- five agents repeating the same source
- confidence scores without calibration
- judge hallucinating facts not in the evidence board
- hiding disagreement to make the output look clean
- assuming multi-agent is better than a simple heuristic
