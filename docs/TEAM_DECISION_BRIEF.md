# Team Decision Brief

## Product boundary

The Team Decision Brief is not another summoner-search, tier-list, or generic esports-statistics
page. It converts the public Meta Radar into a short coaching-staff review queue:

```text
public match evidence
  -> eligible review signal
  -> evidence for / counterevidence
  -> structured practice question
  -> explicit stop condition
  -> human review decision
```

It answers **what deserves review next and how to falsify it**, not which champion is objectively
best or stage-ready.

## Version 1 artifact

The public dashboard renders at most five eligible candidates. Each card contains:

- a deterministic `우선 검토 / 추적 / 보류` label,
- the observed team-demand and pick-presence change,
- a counterevidence statement chosen from quality warnings, team concentration, regional
  divergence, or the public/private data boundary,
- a practice question,
- a stop condition,
- exact evidence-event IDs in the downloadable JSON artifact.

`우선 검토` currently means all of the following:

- the Radar sample gates passed,
- demand velocity is at least `+10 percentage points`,
- pick presence increased,
- at least two distinct teams adopted the champion-role pair.

This threshold is an operational review rule, not a trained prediction or claim of competitive
strength. It must be compared against future outcomes in Phase 3.

## Team-data boundary

Public professional-match data does not reveal player mastery, scrim results, team intent,
communication cost, or whether a pick fits the current private game plan. Version 1 states this
boundary on every decision sheet. A future authorized private adapter may fill those fields, but
they must remain visually and technically separated from the public evidence layer.

## Output and workflow

The page supports print/PDF output for meetings and a machine-readable
`team-decision-brief-<patch>.json` download. The device-local Decision Journal adds the human
workflow:

```text
INBOX -> REVIEWED -> SCRIM_REQUESTED -> ADOPTED | REJECTED | WATCH
```

Each record is pinned to the exact patch, cutoff, champion-role candidate, public evidence IDs, and
optional own-team selection. It is stored only in that browser's `localStorage` and can be exported
as `team-decision-journal-<patch>.json`. There is no server sync, account, or claim that the selected
state is a competitive outcome. Storage is capped at the 250 most recently updated records so a
stale journal cannot grow without bound.

The optional 280-character note is explicitly for non-sensitive meeting context. Scrim results,
player evaluation, private draft plans, and other authorized team information do not belong in this
device-local public prototype. A future shared team workflow still requires authenticated storage,
access control, audit history, and a separate private-data adapter.

