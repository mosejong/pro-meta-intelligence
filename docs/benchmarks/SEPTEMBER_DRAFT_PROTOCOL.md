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
