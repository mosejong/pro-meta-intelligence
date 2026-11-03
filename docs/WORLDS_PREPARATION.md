# Worlds 2026 preparation

## Knockout draw reviewed November 3

The Swiss stage ended October 31. The press-reported draw ([Strafe, Nov 1](https://www.strafe.com/news/read/worlds-2026-playoffs-bracket-schedule-start-times-and-format/))
lists eight best-of-five quarterfinals at 16:00 CST (22:00 UTC, 07:00 KST next day):
TES vs IG (Nov 3), GEN vs LYON (Nov 4), DK vs BLG (Nov 5) and **T1 vs KC (Nov 6 CST / Nov 7
KST)**. Semifinals are Nov 7–8 and the final Nov 14 (US dates). The official bracket page was not
directly retrievable, so this is a dated press snapshot; semifinal pairings were not verified.

The preparation panel now leads with T1's quarterfinal and KC, lists all four pairings, adds IG
and LYON with exact main-team matches (samples 3 each in the September report) and labels other
named qualifiers as out of the knockouts for reference only. No match result is stored or
inferred; update `WORLDS_2026.quarterfinals` and the review date as rounds complete.

## International events in the Radar — November 3

OE international events (`WLDs`, `MSI`, `FST`, `EWC`) now map to a separate `INTERNATIONAL`
comparison group instead of being flagged `UNMAPPED_LEAGUE_EVIDENCE`; they are not merged into
any home region. Re-auditing the archived August 23 CSV places FST (16.05), EWC (16.07–16.13)
and MSI (16.13) in that group. The 2026 file predates Worlds, so the `WLDs` code is taken from
OE's prior-year convention and must be confirmed on the first Worlds-era download.

The hosted sync now passes `--patch-selection-league` for LCK, WLDs, MSI and FST. The patch of
the most recent available match among them is selected, so the Radar follows the Worlds patch
while LCK is idle and returns to LCK afterwards. Publication records the selected league and the
candidate list. This changes no readiness threshold and does not restore source freshness: the
expired source-policy reviews still block collection until they are rechecked.

## Disjoint September draft replay — September 21

The frozen [protocol and run provenance](benchmarks/SEPTEMBER_DRAFT_PROTOCOL.md) and
[aggregate](benchmarks/draft-september-disjoint-2026-09-21.json) record a separate calendar
cohort after September 1, without changing either prediction formula. There are 32 first-set
matches / 224 correlated states, including eight LCK matches / 56 states and three matches
involving exact T1. This is retrospective replay, not prospective or analyst-blinded validation.

| Top-three hits | Production v2 | Role experiment v1 | Team-frequency baseline |
| --- | ---: | ---: | ---: |
| Overall | 26/224 (11.61%) | 31/224 (13.84%) | 24/224 (10.71%) |
| LCK | 11/56 (19.64%) | 13/56 (23.21%) | 9/56 (16.07%) |

Production top-one accuracy is 5/224 (2.23%), below baseline 7/224 (3.13%). All methods emitted
zero illegal candidates. Baseline abstained on five LCK states, which remain in all denominators.
One source pair and small correlated samples do not establish superiority. Keep production v2
and the role experiment offline. This does not validate later-set Fearless, national-team games
or Worlds patch 26.20. Earlier dated results below remain preserved and must not be pooled with
this result to manufacture a new independent test. Current proof page exposes the new metrics.

## Qualification snapshot reviewed September 21

The [official English tournament overview](https://lolesports.com/en-US/tournament/115660540725177488/overview)
now lists 13 named qualifiers: T1, GEN, HLE, DK (LCK); CFO, MVK, TSW (LCP);
BLG, TES, AL (LPL); G2, KC, MKOI (LEC). The Korean page's retrieved representation lacks MKOI,
so the preparation panel links to the newer English list and records its own qualification review
date. Six unnamed slots remain on that page; this is a partial official-page snapshot, not a claim
that every other team is unqualified. No seed or actual matchup is inferred from the display order.

All six additions map to exact main-team names in the current September 15 / 16.16 report.
Their samples are DK 10, TES 4, AL 3, G2 7, KC 5 and MKOI 4. Academy/secondary teams do not substitute
when a main-team row is missing. The 13 cards retain the same evidence and empty-series controls.

Qualification and rules review dates are separate. Updating participants does not recertify the
September 15 rules review or make season observations into Worlds-patch evidence. The common
rules library is reachable on September 21 but the retrieved document list still does not expose
the International Events v1.1 PDF; its indexed title alone remains insufficient.

## Schedule and event rules reviewed September 15

The [official season schedule](https://lolesports.com/en-GB) lists Worlds for October 15–November 14.
These are the dates displayed by the source, not inferred match start times in Korea.
The preparation panel deliberately presents a dated partial qualification snapshot. It does not
infer seeds, fixtures, opponents or qualification from a power ranking or a team's feed presence.
The [event ruleset v1.01](https://cdn.sanity.io/files/dsfx7636/news_live/faa5ce974e58615911fbee931c6123e2785a8b46.pdf)
section 5.1 specifies **26.20**, subject to organizer changes. Section 4.1.4 confirms separate
map-side and pick-order choices; the previous game's loser receives first selection in subsequent
games. Play-In Round 4 gives the upper-bracket team both choices for Game 1. Practice remains
manual and does not award selection rights or infer results. The common international rules and
event restriction list still need verification before certifying the full Fearless ruleset.
Do not equate feed patch 16.16 with the Worlds patch; the engine does not relabel old evidence.

### Restriction verification boundary — September 15

Event ruleset section 5.1 says restricted champions, items, runes and exploits will be communicated
to teams before the event, and permits restrictions during the event. The document itself does
not enumerate restricted champions. No public named list was verified in this review; this is
**unknown, not a verified empty list**. The preparation panel now prominently states that the
practice engine has no event-specific restriction list applied.

The [Competitive Operations library](https://competitiveops.riotgames.com/en-US/library)
search index lists the 2026 International Events Competition Ruleset v1.1 dated July 27, but
direct access returned HTTP 404 during this review. Its existence is not evidence of the text of
its Fearless clauses. Keep the common-rule verification pending; regional rules or prior-year
international rules cannot substitute for it. Recheck when the official document is accessible.

### Five-set rehearsal validation

A synthetic five-set regression exercises all 100 draft actions with map-side swaps and changing
first-pick sides. It checks 0/10/20/30/40 prior-pick locks, reuse of ordinary bans, both teams'
locked picks, deterministic legal previews, and staged JSON restoration at every action. Forged
serialized lock lists cannot remove the locks reconstructed from completed games. This verifies
the practice implementation only; it adds no historical prediction-accuracy evidence and does
not certify the still-unverified event rules.

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

### Role detail and Fearless preparation

Each role now expands into its observed champions, contributing report sections and distinct
cited event counts. Champion asset aliases are merged, overlapping citations are deduplicated,
and ordering is stable when source rows are reordered. Evidence counts are not game counts or
proficiency scores. Historical player profiles are not presented as confirmed Worlds rosters.
The active series supplies its prior picks to mark Fearless locks, including champion aliases.
Remaining counts subtract only previous-set picks, not current-set selections or event-specific
restrictions. No candidate ranking or frozen prediction experiment is changed.

The September 15 follow-up still finds seven named qualifiers in the official overview. The
public collection status reports source backoff, last verified August 31, and a next eligible
attempt at September 15 13:59 UTC. Collection policy is preserved; no new observation is claimed
and the existing season snapshot remains the preparation input.

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

## Opponent draft scouting — November 3

The Draft Lab now opens with a season-wide ban/pick scouting pack for T1's next knockout
opponent (`web/app/scouting/t1-vs-kc.json`). It is built from the archived public OE season file
with the new CLI command and is regenerated, never hand-edited:

```bash
python -m pro_meta_intelligence scout-opponent-draft \
  --input <archived OE CSV> --source-timezone UTC \
  --retrieved-at 2026-08-23T12:00:00+00:00 \
  --target-team "Karmine Corp" --own-team T1 \
  --output web/app/scouting/t1-vs-kc.json
```

The pack covers the newest 40 games per team across leagues and international events, the full
season head-to-head (MSI T1 3-0, EWC KC 2-1), phase-one/phase-two bans given and received,
first-rotation picks, last-pick roles, per-player pools for fearless pressure, and a league
presence comparison (opponent home league, LCK, international events). Levers (deny comfort,
contested priority, protect own, fearless pressure, counterpick role) are deterministic counting
rules for staff review, not win probabilities. The current pack stops at August 23 and contains
no Worlds Swiss games because the source-policy reviews have expired; regenerate it once a
reviewed snapshot with `WLDs` games is available.

Packs exist for every other quarterfinalist (TES, IG, GEN, LYON, DK, BLG) so a semifinal or
final opponent can be scouted the moment a result is known; the panel defaults to T1's next
opponent and offers the rest as candidates. Head-to-head games are grouped into series when
the same league's games fall within 12 hours of each other.
