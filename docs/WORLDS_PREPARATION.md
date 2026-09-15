# Worlds 2026 preparation

## Official snapshot reviewed September 15

The [official season schedule](https://lolesports.com/en-GB) lists Worlds for October 15–November 14.
These are the dates displayed by the source, not inferred match start times in Korea.
The [official tournament overview](https://lolesports.com/ko-KR/tournament/115660540725177488/overview)
lists T1, GEN, HLE, CFO, MVK, TSW and BLG as qualified at review time; other slots remain TBD.
The preparation panel deliberately presents a dated partial qualification snapshot. It does not
infer seeds, fixtures, opponents or qualification from a power ranking or a team's feed presence.
The [event ruleset v1.01](https://cdn.sanity.io/files/dsfx7636/news_live/faa5ce974e58615911fbee931c6123e2785a8b46.pdf)
section 5.1 specifies **26.20**, subject to organizer changes. Section 4.1.4 confirms separate
map-side and pick-order choices; the previous game's loser receives first selection in subsequent
games. Play-In Round 4 gives the upper-bracket team both choices for Game 1. Practice remains
manual and does not award selection rights or infer results. The common international rules and
event restriction list still need verification before certifying the full Fearless ruleset.
Do not equate feed patch 16.16 with the Worlds patch; the engine does not relabel old evidence.
The official participant overview still displays the same seven named teams and unresolved slots.

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

Each opponent card now exposes role-specific distinct observed champion counts. Counts combine
that exact team's public player profiles, priority picks and available recent-game picks, requiring
positive game evidence and a cited event. The same champion is deduplicated within a role and can
appear in multiple roles. Missing roles remain empty; global radar entries and another team's
profiles are never substituted. These are bounded report observations, not a complete champion
pool, player proficiency estimate, or confirmed Worlds roster. In particular, absent recent-game
detail does not imply absent role evidence: the feed contains player profiles beyond its top-five
priority list. This display does not change the frozen role experiment or its published scores.
The report truncates per-player champion lists; these counts are lower bounds on the source
sample, not comparable estimates of complete team pool size. T1 has additional recent-game
detail that other participants do not currently receive. The August 31 report has 6 games for
GEN, 4 for HLE, 10 each for CFO/MVK/TSW and 2 for BLG. BLG's two-game sample remains the
smallest opponent sample; no new matches or new-patch evidence were manufactured by this view.

## LCK/T1 evidence audit

The preparer now emits aggregate imported/eligible counts, observation ranges and sequential
exclusion counts for each league and exact T1. The hosted holdout workflow additionally audits
the whole archived season without the previous pilot's date filter, publishing only bounded
LCK/T1 coverage alongside aggregate benchmark results. Source files and per-match inputs stay
on the ephemeral runner. Collection gaps and later-set restrictions remain visible rather than
being removed to manufacture a larger score.

### Executed audit and expanded replay — September 14

The [hosted run](https://github.com/mosejong/pro-meta-intelligence/actions/runs/34795406755)
completed on the First Selection implementation in PR #78. The unchanged
[comparison aggregate](benchmarks/draft-first-selection-2026-09-14.json) and
[season coverage aggregate](benchmarks/draft-lck-t1-coverage-2026-09-14.json) preserve its results.
Five verified captures span August 23–31; this is archived season evidence, not September or
Worlds match coverage. The original holdout boundary remains August 25 at 06:39:37.755251 UTC.

The expanded replay contains **39 first-set matches / 273 states** on patch 16.16. It includes
the previously evaluated 28 Blue-first matches plus 11 newly supported Red-first matches.
It is an overlapping coverage correction, not 39 new independent holdout matches. Ranking
formulas were not retuned, and the previous aggregate remains unchanged.

| Metric | Production v2 | Role experiment v1 | Team-frequency baseline |
| --- | ---: | ---: | ---: |
| Overall top-three hits | 34/273 (12.45%) | 42/273 (15.38%) | 28/273 (10.26%) |
| Overall top-one hits | 8/273 (2.93%) | 13/273 (4.76%) | 11/273 (4.03%) |
| Overall MRR at three | 0.066545 | 0.089744 | 0.065324 |
| LCK top-three hits | 4/35 (11.43%) | 4/35 (11.43%) | 3/35 (8.57%) |

All methods covered every state and emitted zero illegal candidates. The scored LCK subset
contains five matches; only one scored match involves exact T1. Same-match states are correlated,
and this small single-patch sample cannot establish target-team reliability. The experiment's
overall gain does not carry over to LCK top-three recall: **keep production v2 as the default**.

Removing the holdout date filter for the separate season eligibility audit yields seven eligible
LCK matches from 469 imported, and two exact-T1 matches from 152 imported across competitions.
These are coverage counts, not additional scored denominators. LCK exclusions are 290 matches
without confirmed first-set labels and 172 without an earlier capture; T1 exclusions are 93 and
57 respectively. Eligibility is limited by archived evidence and the first-set evaluation scope,
not by waiting for another LCK fixture. Later-set Fearless remains unevaluated.

Next priorities are to verify the remaining common Fearless rules and event restrictions, maintain
the confirmed participant snapshot, expand evidence on patch 26.20 when available, and evaluate the frozen role
experiment on disjoint data. First Selection support does not establish every Worlds rule or
turn rehearsal into a validated counter-pick recommendation.
