# Draft opponent-pick pilot — 2026-09-12

The production `fearless-preview-v2` preview matched 3 of 28 observed next picks in its top
three candidates (10.7%), equal to the team-frequency baseline. Top-one accuracy was 0/28
versus 1/28 for the baseline. This pilot provides no evidence of improved prediction.

## Scope and inputs

The local archive contains three verified Oracle's Elixir captures, collected on August 23,
24 and 25, 2026. Each candidate report is built only from the latest capture strictly before
the target match; availability is the actual retrieval timestamp. Outcomes come from the
distinct August 25 capture. Reports use the same patch and default Radar/opponent-prep
configuration as production. The evaluator calls `previewOpponentPick` directly.

Only provider-confirmed first sets with a complete standard 20-action draft and prior evidence
for both teams qualify. OE sequences picks and bans separately; the preparer maps those to
the standard total turn order. It does not infer series IDs or prior-set Fearless locks.
The evaluated states are the seven actions immediately before an opposing pick: target turns
7, 8, 10, 12, 17, 18 and 20. The observed preceding action is staged; intervening choices are
never supplied to a prediction. Earlier bans and picks are legitimate observed context.

The baseline uses the **same report's truncated team priority-pick pool**, ordered by observed
game rate, then canonical champion ID. Both models remove already selected and staged
champions. This is not a comparison with a full-history frequency model or analyst choices.

## Results

| Metric | Production preview | Team-frequency baseline |
| --- | ---: | ---: |
| Evaluated matches / states | 4 / 28 | 4 / 28 |
| At least one candidate | 28/28 (100%) | 25/28 (89.3%) |
| Top-one hits | 0/28 (0%) | 1/28 (3.6%) |
| Top-three hits | 3/28 (10.7%) | 3/28 (10.7%) |
| Mean reciprocal rank, capped at three | 0.047619 | 0.065476 |
| Illegal candidates / emitted candidates | 0/84 | 0/69 |

All eligible states, including empty candidate lists, remain in the denominator. Missing
predictions score zero. The four matches comprise LCKC: 1, LCS: 1, LEC: 2; there are no LCK
first-team cases. Cases within each match are correlated, so these are not 28 independent
matches. This small, availability-selected sample cannot establish general performance,
calibrated probabilities, counter-pick value, or multi-set Fearless quality. The ranking was
not tuned on these outcomes. `PILOT_COMPLETE` means execution completed, not a quality gate.

Of 7,429 imported outcome matches, the sequential filters excluded 3,919 without consistent
game-one labels, 3,495 without an earlier capture, 9 with incomplete/nonstandard drafts and
2 without both teams' same-patch history. Another 455 source games were rejected by the
importer before evaluation. These categories are sequential, not independent defect counts.

## Reproduce locally

Run from the repository root with Python dependencies and `web/node_modules` installed:

```powershell
python -m pro_meta_intelligence.backtest.draft_dataset --archive outputs/oracles-elixir/raw --output outputs/draft-benchmark/dataset.json
npm --prefix web run benchmark:draft -- ../outputs/draft-benchmark/dataset.json ../outputs/draft-benchmark/result.json
```

Required capture hashes (archive metadata supplies actual retrieval timestamps):

```text
sha256:7161aaf29c8bfc30aac58b0bb49922115b91923f33c4496683aba16c8650a3be
sha256:c672fa3a6dc16ca8d6b99571642525fd95d1471c12a97da8a93ccf2240d96b5f
sha256:13013bc4d423768e2cc758cf8ebe3d4ff7490458ad9971714b18c20334cd9bf0
```

The preparer verifies archived bytes before importing and rejects ambiguous capture times.
The evaluator rejects future/same-time cutoffs, target matches in candidate evidence,
duplicate outcomes, invalid action order, mismatched provenance and reused champions.
Repeated runs with identical inputs/model produce identical results. Tests also cover rank
accounting, abstentions and explicit fixture-only output. Synthetic tests are not performance evidence.

Normalized reports, raw source files and per-match results stay under ignored `outputs/`.
The committed [aggregate result](benchmarks/draft-pilot-2026-09-12.json) excludes case records.
Reproduction requires the local source archive; downloading today's file cannot reconstruct
these historical availability boundaries.

## Next priority

1. Expand verified time-separated captures and report independent match counts by league and
   patch before judging ranking improvements. Preserve this pilot as the existing baseline.
2. Add maintained role/flex evidence and evaluate any changed model on new held-out matches;
   do not tune and report performance on these same four matches.
3. Evaluate later-set Fearless only when trustworthy series membership and preceding drafts
   exist. Composition/counter claims and analyst time savings require separate evidence.
