# Pro Meta Intelligence - submission package

Prepared September 15, 2026. Working evidence-review prototype; no claim of improved wins,
draft accuracy or analyst completion time. Use the dated PDF with the live app.

- App: https://pro-meta-radar.ahtpwhd95.chatgpt.site/draft
- Proof and printable walkthrough: https://pro-meta-radar.ahtpwhd95.chatgpt.site/proof
- Staff brief: [Worlds preparation PDF](../web/public/briefs/worlds-strategy-brief.pdf)
- Full scope and unfinished gates: [Release backlog](RELEASE_BACKLOG.md)

## Measured case: correcting first-pick coverage

The initial evaluator assumed Blue drafted first. The LCK/T1 source audit exposed legitimate
Red-first games excluded as nonstandard. First Selection support now mirrors the full 20-turn
sequence and preserves map side separately in previews, session files and historical replay.

The coverage correction expands the previous 28-match cohort to 39 matches / 273 immediate
opponent-pick states, all patch 16.16. It is overlapping evidence, not a new independent holdout.

| Top-three hits | Production v2 | Role experiment v1 | Team-frequency baseline |
| --- | --- | --- | --- |
| Overall | 34/273 (12.45%) | 42/273 (15.38%) | 28/273 (10.26%) |
| LCK | 4/35 (11.43%) | 4/35 (11.43%) | 3/35 (8.57%) |

Only five scored LCK games and one scored exact-T1 game are included. Same-match states are
correlated. All methods emitted zero illegal candidates; this is legality, not accuracy. Retain
production v2 because the role experiment's overall gain does not carry over to the target-league
top-three metric. The separate season audit's seven eligible LCK and two T1 games are not scored
denominators. [Frozen aggregate](benchmarks/draft-first-selection-2026-09-14.json),
[full protocol and caveats](WORLDS_PREPARATION.md).

## Three-minute draft demonstration

| Time | Action | Explanation |
| --- | --- | --- |
| 00:00-00:25 | Open Draft Lab | Staff can compare observed opponent tendencies without losing the draft state. Show source cutoff separately from Worlds patch. |
| 00:25-00:55 | Open GEN role detail, then T1 vs GEN practice | Exact team identity, bounded champion observations and cited evidence; this is a practice matchup. |
| 00:55-01:30 | Stage a champion, change it, then stage the same one again | Nothing is confirmed until the button is pressed. Identical inputs reproduce identical preview ordering. |
| 01:30-02:05 | Confirm selections; show a pre-saved completed first set and next set | Prior picks from both teams are locked, ordinary bans are released. First pick and map side are separate. |
| 02:05-02:30 | Export and re-import a scenario | Fixed report, staged choice, turn order and preceding games restore together. Use a rehearsal file; preserve any existing session first. |
| 02:30-03:00 | Show benchmark table and remaining gates | Explain target-league tie, current source delay, missing Worlds restrictions and why AI remains locked. |

The sequence is a script, not a claim that a narrated video has been recorded. A prior-game file
can be prepared with the public rehearsal UI; no real match result or private scrim is needed.

## Resume wording (draft)

Built and deployed an evidence-driven League of Legends analysis prototype with immutable source
cutoffs, leakage guards, human-confirmed Fearless draft rehearsal and deterministic opponent
previews. Corrected Blue-only replay to support First Selection and audited an overlapping
39-game / 273-state historical cohort, documenting target-league limitations and retaining the
production baseline when experimental gains did not generalize. Added runtime input validation,
automated tests, typed release checks and policy-aware source monitoring.

Do not replace this with claims of coaching impact, improved win rate, production AI accuracy or
private-team adoption without new evidence. Tailor the wording to a supplied role description.
