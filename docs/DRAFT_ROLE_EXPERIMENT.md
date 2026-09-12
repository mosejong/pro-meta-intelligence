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
