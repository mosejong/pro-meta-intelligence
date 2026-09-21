# September draft replay protocol — 2026-09-21

Freeze this protocol before executing or inspecting the new benchmark result. This is a
retrospective replay of a disjoint calendar period, not a prospective or analyst-blinded trial.

- Model: unchanged `fearless-preview-v2`; compare the existing frozen role experiment and
  team-frequency baseline without tuning, changing weights or promoting either variant.
- Target boundary: match time strictly after `2026-09-01T00:00:00+00:00`. Previous published
  replay outcomes end in the August 31 capture, so these target games cannot overlap that cohort.
- Source: pin one authenticated encrypted archive artifact from the normal hosted collector.
  No fresh source fetch, raw-row upload or artificial historical capture is part of evaluation.
- Candidate information: latest genuinely earlier archived capture; both teams need observed
  same-patch evidence. Targets must be absent from that earlier capture. Outcome labels come
  from the pinned archive's latest capture; report its actual acquisition time.
- Eligibility: confirmed first sets with the complete validated 20-action order, including
  Red-first drafts. Existing integrity, time and patch gates stay unchanged. No hand selection
  of teams or matches after observing scores.
- Measures: all eligible matches/states, coverage, top-1, top-3, MRR and illegal candidates for
  the production model and baseline; existing role-experiment results; separate LCK denominators
  and all exclusion counts. Seven immediate-opponent pick states per eligible first set.
- Interpretation: do not treat seven correlated states from one match as seven independent games.
  Zero eligible cases means unavailable evidence, not zero accuracy. State data age and sample
  limits. No later-set Fearless accuracy, national-team accuracy or Worlds-patch claim follows.
- Publication: preserve prior aggregate files unchanged. Save the new aggregate with the exact
  workflow run, source-code revision and archive ID; per-match inputs stay private on the runner.

The workflow's date input is passed through an environment variable and quoted argument, then
validated by the existing timezone-aware dataset parser. The legacy default remains available
for reproducing the previous experiment; this evaluation supplies the September boundary explicitly.

## Execution and interpretation

- Protocol and evaluation code frozen in commit `6b85748a9fa479a188fb3071a9c7ce90802fafc3`.
- [Successful run 35601430445](https://github.com/mosejong/pro-meta-intelligence/actions/runs/35601430445),
  encrypted archive artifact `10638637239` from collector run `35601091585`.
- Public result artifact: `draft-holdout-summary-35601430445`. The
  [benchmark aggregate](draft-september-disjoint-2026-09-21.json) and
  [unfiltered season coverage](draft-season-coverage-2026-09-21.json) preserve the downloaded JSON results.
- Six verified captures, August 23 through September 15; one distinct source pair supports
  32 eligible matches and 224 correlated states. Exact T1 appears in three eligible matches;
  no separate T1 accuracy metric was computed.
- Production top-three: 26/224 (11.61%); baseline 24/224 (10.71%); role experiment 31/224
  (13.84%). Production top-one: 5/224 (2.23%), below baseline 7/224 (3.13%);
  role experiment 10/224 (4.46%). MRR@3: 0.063988 / 0.063244 / 0.086310 respectively.
- LCK: eight matches / 56 states on 16.16; production top-three 11/56 (19.64%), baseline
  9/56 (16.07%), role experiment 13/56 (23.21%). Production/role covered all states;
  baseline covered 219/224 overall and 51/56 LCK. Abstentions stay in every denominator.
  All three methods emitted zero illegal candidates.
- Sequential exclusions: 7,660 before/at boundary, 402 not confirmed first sets, 138 without
  prior same-patch team evidence, one incomplete/nonstandard draft. These plus 32 eligible
  equal 8,233 imported matches; another 516 source matches were rejected during import.
- The unfiltered coverage audit has 15 eligible LCK and five T1 matches; those counts are
  **not** September scored denominators and must not replace eight and three respectively.
- Decision: retain production v2 and keep the role variant offline. Small correlated samples,
  one source pair, retrospective evaluation and mixed league performance do not establish
  superiority or reliable professional predictions. This cohort is now consumed evidence;
  any tuning must be evaluated on another frozen, unseen cohort.
