# Match-day Emergency Brief v1

## Purpose

The Match-day Emergency Brief compresses the current Team Decision Brief and a selected Opponent
Prep Pack into a three-minute staff review. It is designed for the question immediately before a
meeting or match: **what must we verify now, and what do we still not know?**

The implementation is deterministic and does not call an AI provider. Given the same published
Radar snapshot and selected team, it produces the same JSON artifact and the same visible brief.

## Input and output

Inputs are already validated objects in the same point-in-time publication snapshot:

- one `RadarReport`, including the exact cutoff, formulas, entries, and source versions;
- one `OpponentTeam` from that report's `opponent_prep` artifact.

The output contract is `schema_version: "1"` and
`artifact_type: "match-day-emergency-brief"`. Staff can read it in the dashboard, print or save it
as PDF, and export the evidence-bearing JSON for a later handoff.

## Reading order

1. **Immediate draft signals** — the most frequent observed pick, the distinction between bans made
   and bans received, and the most repeated first rotation.
2. **Opponent preference × global meta** — exact champion-role intersections between the selected
   opponent's priority picks and the current Radar entries.
3. **Four staff questions** — prompts that require a human answer about response order, exchanges,
   ban budget, and plan-switch timing.
4. **Separate patch test queue** — three globally eligible Team Brief candidates. These are visibly
   separated because they are patch review candidates, not opponent-specific answers.
5. **Unknowns** — private readiness and causal intent that public match records cannot establish.

## Cross-validation rules

An overlap exists only when champion ID and role both match. It is ordered by Radar rank, then by
the opponent's game rate, and limited to three entries:

- `HIGH_REVIEW`: Radar eligible and ranked 10 or better;
- `REVIEW`: Radar eligible outside the top 10;
- `CONTEXT_ONLY`: present in Radar but below its public review guard.

No overlap is also a valid result. The UI explicitly says that unrelated signals will not be joined
into a narrative. The brief never converts an overlap into a pick, ban, or draft recommendation.

## Evidence quality

The opponent sample carries one of three operational labels:

- `USABLE_WITH_LIMITS`: public evidence is internally complete enough to review, but still cannot
  reveal private intent or readiness;
- `LOW_SAMPLE`: fewer than the configured minimum number of same-patch matches;
- `INCOMPLETE_EVIDENCE`: one or more selected matches lack complete ban evidence.

`INCOMPLETE_EVIDENCE` takes priority when both warnings exist. Match IDs, draft-event IDs, source
versions, content hashes, cutoff, and every item-level evidence ID remain attached to the JSON.

## Non-claims and private-data boundary

The brief does not claim:

- that an observed rotation will repeat in the next game;
- why a team made or received a ban;
- that global adoption makes a pick correct against this opponent;
- our players' champion familiarity, scrim results, or current plan;
- an opposing coach's or player's private intent.

Those questions require an authorized private adapter or a staff decision. The public prototype
keeps them in the `unknowns` section instead of filling the gap with inference.

## Implementation

- generator: `web/app/emergency-brief.ts`
- presentation, print/PDF, and JSON download: `web/app/radar-dashboard.tsx`
- responsive and print layout: `web/app/globals.css`
- real-feed contract test: `web/tests/rendered-html.test.mjs`
