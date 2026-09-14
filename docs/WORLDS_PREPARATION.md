# Worlds 2026 preparation

## Official snapshot reviewed September 14

The [official season schedule](https://lolesports.com/en-GB) lists Worlds for October 15–November 14.
These are the dates displayed by the source, not inferred match start times in Korea.
The [official tournament overview](https://lolesports.com/ko-KR/tournament/115660540725177488/overview)
lists T1, GEN, HLE, CFO, MVK, TSW and BLG as qualified at review time; other slots remain TBD.
The preparation panel deliberately presents a dated partial qualification snapshot. It does not
infer seeds, fixtures, opponents or qualification from a power ranking or a team's feed presence.
The competition patch and event-specific draft rules remain unverified in the reviewed sources.
Do not equate feed patch 16.16 with the Worlds patch.

## First Selection correction

Riot's [2026 season announcement](https://lolesports.com/en-AU/news/season-start-2026-lol-esports)
separates choice of map side from choice of first/second pick. Red can draft first.
The previous engine and evaluator incorrectly restricted the supported order to Blue-first.
An eligibility audit exposed this limitation; valid Red-first drafts were being excluded under
`INCOMPLETE_OR_NONSTANDARD_DRAFT`. That aggregate reason did not establish missing source data.

The engine now mirrors all 20 turns when Red drafts first, retaining physical map-side labels.
The user chooses first-pick side before the first action of each set; it is locked once a champion
is staged or confirmed. Previews, turn hints, replay and prior-game Fearless locks use the same order.
The ranking formula remains v2. Exports use schema 3 to preserve first-pick side even for an empty
set; schema-2 files import with their original Blue-first interpretation. Older clients reject
schema 3 instead of silently replaying a Red-first session as Blue-first.

The archive preparer reads the first-pick side from OE pick sequence 1 and validates the entire
pick/ban sequence against it. New datasets declare `first_pick_side`; old datasets retain their
Blue-first default. Previously published Blue-first pilot results remain unchanged as artifacts;
they must not be described as representative of all 2026 drafts.

## Preparation flow

Open Draft Lab's Worlds preparation panel, inspect the dated official qualification list and
current source cutoff, then choose a confirmed participant as T1's practice opponent. Only exact
main-team names in the appropriate league are matched. Ambiguous identities and missing samples
disable the shortcut; academy teams are never substituted. Shortcuts only work in an empty series
and cannot erase ongoing work. They prepare a rehearsal, not an official fixture.

Pick priorities remain from the captured public season report. The panel discloses its patch and
cutoff, so season history is not presented as Worlds meta. The role experiment stays offline.

## LCK/T1 evidence audit

The preparer now emits aggregate imported/eligible counts, observation ranges and sequential
exclusion counts for each league and exact T1. The hosted holdout workflow additionally audits
the whole archived season without the previous pilot's date filter, publishing only bounded
LCK/T1 coverage alongside aggregate benchmark results. Source files and per-match inputs stay
on the ephemeral runner. Collection gaps and later-set restrictions remain visible rather than
being removed to manufacture a larger score.

Next priorities are to verify Worlds event rules and patch when available, maintain the confirmed
participant snapshot, expand same-patch opponent role evidence, and evaluate the frozen role
experiment on disjoint data. First Selection support does not establish every Worlds rule or
turn rehearsal into a validated counter-pick recommendation.
