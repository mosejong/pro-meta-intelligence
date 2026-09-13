# Observed-role holdout experiment

`observed-role-feasibility-v1` is an offline comparison, not the deployed Draft Lab model.
The public preview remains `fearless-preview-v2`, including its fixed session version.
The experiment is frozen before examining outcomes beyond the original pilot.

## Rule

Take the same legal candidate pool and scores as the existing preview. For the target team,
collect every observed role from its priority picks and recent games, plus eligible Radar
entries from the same frozen report. These are observed possibilities, not a maintained
exhaustive champion-role registry. Unknown roles remain unrestricted.

For each candidate, attempt an assignment of that team's confirmed picks plus the candidate
to distinct TOP, JUNGLE, MID, BOTTOM and SUPPORT slots. Keep all observed alternatives for
flex picks. Rank feasible assignments before conflicts, preserving the existing score order
inside each group. A conflict lowers rank; it does not make the champion illegal. Return
three candidates. Previous-set and current-game locks still come from the production engine.

This tests one bounded hypothesis: existing role evidence can reduce redundant-role options.
It does not infer lane counters, synergy, intended positions or hidden opponent decisions.
Sparse evidence can falsely suggest a conflict, and unknown roles can hide one. No model
promotion follows automatically from a higher aggregate metric.

## New holdout

`.github/workflows/draft-holdout.yml` is manually dispatched with a pinned existing encrypted
history artifact ID. It restores that archive inside GitHub Actions using the existing secret,
verifies integrity, and makes no provider request. No keys, raw rows, normalized reports or
case-level results are uploaded. Only `result.summary.json` becomes an Actions artifact.

Target matches must occur strictly after **2026-08-25T06:39:37.755251+00:00**, the original
pilot's latest outcome capture. This excludes all four already examined pilot matches.
Each target still requires a strictly earlier source capture and a complete first-set draft.
Predictions get confirmed/staged champion IDs, never the target match's eventual role labels.
Future/target recent-game role evidence is explicitly rejected.

The report compares production, same-report frequency baseline and role experiment on the
same cases. It includes experimental/production results by league and patch and the archive
preparation audit. Correlated draft states do not count as independent matches.

Local equivalent, when the verified archive is available:

```powershell
python -m pro_meta_intelligence.backtest.draft_dataset --archive outputs/oracles-elixir/raw --observed-after 2026-08-25T06:39:37.755251+00:00 --output outputs/draft-holdout/dataset.json
npm --prefix web run benchmark:draft -- ../outputs/draft-holdout/dataset.json ../outputs/draft-holdout/result.json --role-experiment
```

Results must distinguish a new retrospective holdout from a prospective trial. The source
captures predate model development; future unseen matches are still needed before a broad
performance claim. The original pilot remains unchanged in its committed aggregate file.

## Executed result — 2026-09-13 KST

The [hosted evaluation](https://github.com/mosejong/pro-meta-intelligence/actions/runs/34701262868)
completed successfully on revision `2108d4ad01d5bf0f4523bdd073a450950ca5aeb3`, using encrypted
archive artifact `10296214595`. The implementation was frozen in
[PR #76](https://github.com/mosejong/pro-meta-intelligence/pull/76) before these results were read.
The [unaltered aggregate JSON](benchmarks/draft-role-holdout-2026-09-13.json) has SHA-256
`e7e53b61f905515c4fbc1ee3b060e626ea45c1feb67a6a147c3538d61b852592`.

The five verified captures span August 23–31. The new holdout contains **28 distinct first-set
matches / 196 immediate-response states**, all on patch 16.16, with no overlap with the
previous four-match pilot. The outcome capture is August 31, not the September execution date.

| Metric | Production v2 | Role experiment v1 | Team-frequency baseline |
| --- | ---: | ---: | ---: |
| Top-three hits | 23/196 (11.73%) | 30/196 (15.31%) | 18/196 (9.18%) |
| Top-one hits | 5/196 (2.55%) | 9/196 (4.59%) | 9/196 (4.59%) |
| MRR at three | 0.062075 | 0.087585 | 0.065476 |
| Candidate coverage | 196/196 | 196/196 | 196/196 |
| Illegal candidates / emitted | 0/588 | 0/588 | 0/533 |

The experiment gains 7 top-three hits over production (+3.57 percentage points) and 12 over
the frequency baseline (+6.12 points). Production and experiment return three candidates in
every state; the truncated frequency pool sometimes returns fewer. Top-one experiment
accuracy equals the baseline. These are descriptive paired results, not a significance claim.

| League | Matches | Production top-three hits | Experiment top-three hits |
| --- | ---: | ---: | ---: |
| AL | 1 | 2 | 2 |
| CD | 1 | 0 | 0 |
| EBL | 2 | 2 | 4 |
| HM | 3 | 4 | 4 |
| LCP | 1 | 1 | 1 |
| LFL | 2 | 1 | 3 |
| NACL | 3 | 2 | 3 |
| NL | 1 | 1 | 1 |
| NLC | 2 | 3 | 3 |
| PRM | 1 | 0 | 1 |
| RL | 6 | 7 | 7 |
| ROL | 4 | 0 | 1 |
| TCL | 1 | 0 | 0 |

There are no LCK, LPL or LEC matches in this holdout. Same-match states are correlated,
teams can recur, and all cases share one patch and only two source pairs. Role observations
are incomplete. This is promising evidence for the specific experiment on this sample;
it does not establish reliability for T1, another patch, or multi-set Fearless.

The outcome importer accepted 7,677 matches and rejected 461 source games. Sequential filters
excluded 7,449 at/before the holdout boundary, 154 without consistent game-one labels,
27 incomplete/nonstandard drafts, 1 without same-patch training and 18 without both teams'
prior evidence. The remaining 28 were all scored, including empty predictions if any.

Decision: retain production v2 as the default. Keep this role experiment fixed for a new
prospective evaluation and prioritize additional patches plus LCK/T1 coverage. New results
must exclude matches already measured here. A trusted series identifier and earlier-set
drafts remain prerequisites for evaluating multi-set Fearless. Do not retune this rule on
these 28 outcomes and label the same matches an unseen test.
