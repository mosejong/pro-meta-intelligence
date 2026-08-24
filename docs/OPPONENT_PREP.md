# Opponent Prep Pack

## Purpose

Opponent Prep Pack turns normalized public professional drafts into a selectable, meeting-ready
team artifact. It is descriptive: it records what a team picked, banned, was banned against, and
showed in first rotation. It does not claim why the team made those choices.

The v1 workflow is:

```text
OE team rows
  -> stable team ID and display name
  -> global pick and ban sequences
  -> selected patch and point-in-time cutoff
  -> latest 10 games per team
  -> side / phase / champion tendencies
  -> staff questions and exact evidence IDs
```

## Source normalization

The validated OE contract preserves:

- `teamid` and `teamname` for Blue and Red,
- `pick1` through `pick5` joined to the resolved player role,
- `ban1` through `ban5` with `role=UNKNOWN`, because the banned role cannot be established from the
  draft alone,
- a separate global sequence from `1` through `10` for picks and bans.

An absent individual ban is not grounds to discard an otherwise complete match. The event is
omitted and every team pack containing that match receives `INCOMPLETE_BAN_EVIDENCE`.

## Output contract

`current.json.opponent_prep` contains:

- cutoff, patch, source hashes, and formulas,
- a maximum of ten newest same-patch games per team,
- Blue/Red game and win samples,
- global first-pick rate,
- frequent champion-role picks,
- bans made by the selected team,
- bans made by its opponents in those matches,
- observed phase-one pick rotations,
- allowlisted target-only player profiles, recent-game timelines, and previous-patch deltas,
- match IDs and draft-event IDs,
- sample and missing-evidence flags.

Champion rates are `distinct selected games containing the champion / selected games`. Phase one is
sequence `1-6` within picks or bans; phase two is `7-10`. No learned score is used.

## Interpretation boundary

- `received_bans` means only that the opposing side banned the champion in a game against the
  selected team. It is not proof that the ban targeted a particular player or strategy.
- Public game win rate is context, not evidence that a displayed pick caused wins.
- Team IDs can span multiple leagues or events; the pack lists every included league.
- Exact first-rotation triples frequently occur only once. The UI calls them observed rotations and
  displays their count rather than labeling every triple a repeated tendency.
- Draft intent, staff attribution, player readiness, scrim plans, and private priorities remain
  unavailable.

The web surface supports selection among every team in the published patch and downloads a bounded
JSON handoff for the chosen team.

The target-only enrichment currently allowlists exact `T1` identity matches. Player names and IDs
come from public OE player rows. The latest observed match defines the five `CURRENT` players;
additional same-patch players are retained as `OTHER_OBSERVED`. See
[`T1_TARGET_PROFILE.md`](T1_TARGET_PROFILE.md) for the roster and series boundaries.

## Current real publication

The audited 16.16 feed generated on the retained 2026 OE snapshot contains 236 accepted games and
138 team packs. Fifty-six teams have fewer than three same-patch games and are flagged
`LOW_MATCH_SAMPLE`; eight packs include at least one match with an absent ban value and are flagged
`INCOMPLETE_BAN_EVIDENCE`. These packs remain selectable so absence is visible rather than silently
filtered.
