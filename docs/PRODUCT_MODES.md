# Product Modes and Long-term Survival

## One core, multiple useful surfaces

The project should remain useful whether it becomes a professional-team tool, a public analysis
service, or an independent League of Legends analysis channel. These are not separate data engines.
They share the same point-in-time records, provenance, features, backtests, and failure logs.

### Team Mode

For analysts, coaches, and players. Outputs stay compressed and operational:

- what changed,
- what deserves review or testing,
- strongest evidence and counterevidence,
- estimated review/test cost without pretending to know private mastery,
- uncertainty and sample limitations.

The implemented Team Decision Brief v1 turns the five highest eligible public signals into a
meeting-ready queue. Every card pairs evidence with counterevidence, a structured practice
question, and a stop condition. It supports print/PDF and a JSON handoff while explicitly marking
player familiarity, scrim results, and team intent as unavailable until an authorized private
adapter is connected. See [`TEAM_DECISION_BRIEF.md`](TEAM_DECISION_BRIEF.md).

Opponent Prep Pack v1 adds a second operational artifact: staff can select any team in the current
published patch and inspect side samples, phase-one/phase-two picks and bans, observed first
rotations, quality warnings, and exact source match IDs. The output keeps observed behavior
separate from inferred intent. See [`OPPONENT_PREP.md`](OPPONENT_PREP.md).

### Competitive boundary

The product does not compete for summoner lookup, builds, runes, generic champion tiers, schedules,
standings, or static tournament tables. Those are discovery/statistics surfaces. Pro Meta
Intelligence owns the narrower workflow from an auditable early signal to a review decision,
practice question, rejection condition, and later backtested outcome.

### Creator Mode / Analyst Studio

For evidence-backed public analysis. A future Creator adapter may transform an approved analysis
snapshot into:

- video-topic and title candidates,
- a hook and chapter outline,
- claims, counterclaims, and falsifiers,
- data-card and chart specifications,
- a five-to-ten-minute script,
- a source list,
- a 30-to-60-second short-form summary,
- a follow-up template for reviewing misses after outcomes are known.

Creator Mode must not invent new analytical facts. It consumes approved claims and evidence from the
core, preserves source links and time scope, and requires human approval before publication. The
product goal is an Analyst Studio, not unattended bulk content generation.

Current foundation: eligible Meta Radar entries can be transformed without an LLM into versioned
Creator briefs containing claim IDs, exact values, counterpoints, falsifiers, data-card specs,
evidence event IDs, and an explicit human-review gate. Optional AI drafting remains a later adapter.

## User-defined Intelligence Sources

A future user may save a narrow interest such as a team, region, champion-role, or specialist scene.
The system resolves that interest only through registered sources.

```text
Saved interest
  -> Source Registry
  -> supported/official API when available
  -> explicitly permitted public-web adapter
  -> policy and rate-limit gate
  -> immutable raw snapshot
  -> normalized evidence
  -> optional AI translation/summary/tagging
  -> quantitative cross-check
  -> Team or Creator output
```

### Source Registry contract

Each source should declare at least:

- source owner, type, canonical URL, and adapter version,
- supported API or permitted collection method,
- terms/robots policy references and last review time,
- authentication class and whether public deployment is permitted,
- rate limits, retry policy, and retention/redaction policy,
- license/redistribution status,
- expected availability lag and correction behavior,
- enabled/disabled status with a recorded reason.

An adapter is disabled by default until its policy and data contract are reviewed. The system must
not bypass login, access controls, robots restrictions, or platform limits, and must not infer hidden
player accounts or collect private data.

## Bring-your-own AI API credentials

Users may eventually provide a supported AI provider credential for translation, classification, or
script drafting at their own cost. The security boundary should require:

- secrets stored in an approved secret manager or encrypted credential store,
- no plaintext database field, source-control entry, analytics event, error payload, or application
  log containing the key,
- provider and model selection recorded without recording the credential,
- explicit data-routing disclosure before source text is sent to a provider,
- revocation and deletion controls,
- a local/no-external-model path where sensitive authorized data is involved.

AI-derived artifacts are versioned derivatives. They never replace the raw source and must retain
source IDs, model/provider metadata, prompt/template version, creation time, and human review state.

## Agent and creator boundary

Future specialist agents may independently inspect meta, SoloQ/specialist, draft, player-fit, and
counterevidence views. A creator component may structure the approved result into a narrative only
after fact and evidence checks. Agent agreement is not ground truth, and extra agents must earn their
cost through measured improvements over the non-LLM baseline.

## Delivery order

1. Complete the Phase 1 leakage-safe evaluation spine.
2. Validate real structured data adapters and availability policies.
3. Add the source registry and narrowly allowlisted collection jobs.
4. Measure whether expert/creator inputs add value.
5. Add AI-derived translation and synthesis with BYO-key controls.
6. Extend the implemented Team Mode and Creator Mode presentations without splitting their shared
   evidence snapshot.

This sequence keeps public-product and content-creation options open without weakening the current
no-LLM, no-crawler Phase 1 acceptance criteria.
