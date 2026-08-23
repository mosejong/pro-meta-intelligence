# OE Walk-forward Blind Spot Benchmark

## Question answered

The benchmark asks one narrow question:

> Among champion-role signals that the Meta Radar could have produced at an archived cutoff, how
> many low-presence strategies that later reached a frozen professional-adoption threshold appeared
> inside the staff's top-K review budget?

It does not claim that a hit was strategically correct, caused later adoption, or was playable by a
specific team. It measures public-signal retrieval before a later public outcome.

## Command

```bash
python -m pro_meta_intelligence benchmark-oe-history \
  --archive-dir outputs/oracles-elixir/raw \
  --source-timezone UTC \
  --output outputs/oracles-elixir/blind-spot-benchmark.json
```

Exit code `0` means at least one audited cutoff was evaluated. Exit code `2` means history did not
pass its readiness gates or no cutoff could build a Radar report. The JSON report is written in both
cases so the blocking reasons are inspectable.

This command performs no network request and does not copy provider rows into the report.

## Point-in-time contract

Every evaluated window uses two different roles for archived content:

```text
cutoff content hash  -> import at its first archived retrieval -> build candidates
outcome content hash -> import at its first archived retrieval -> label future outcomes only
```

The pair comes from `audit-oe-history.matured_cutoffs`. The benchmark refuses to run when that audit
is not ready. A current annual file is never backdated to an earlier cutoff, and the outcome file is
never passed to the Radar candidate builder.

Rejected-game codes are retained per content state. Known incomplete-game and missing-team
exclusions remain warnings. Any other contract issue attributed to the selected patch—or lacking a
patch attribution—causes that cutoff to be skipped in both the candidate and outcome snapshots.
An invalid row from an unrelated old patch therefore cannot disable every future window, while an
issue capable of biasing the evaluated patch cannot be silently ignored.

Each cutoff report retains:

- cutoff and outcome content hashes;
- cutoff and outcome timestamps;
- Radar source versions and exact candidate evidence-event IDs;
- future outcome match and event IDs;
- Radar window counts and patch ID;
- explicit missed-adoption and false-alert records.

## Frozen default policies

Candidate selection:

- use the deterministic Meta Radar order;
- select eligible entries only;
- apply the same maximum pre-cutoff presence threshold before top-K selection;
- review at most `top_k = 10`;
- use the latest patch visible at each cutoff unless `--patch` is fixed.

Meaningful future adoption:

- same patch as the cutoff Radar report;
- pre-cutoff recent-window pick presence at most `0.10`;
- at least two future professional picks;
- picks by at least two distinct teams;
- confirm adoption at the first future event where both thresholds have been reached.

All values are CLI options for development, but any published comparison must freeze them before
viewing its holdout outcomes. Changing a threshold after inspecting outcomes invalidates that
holdout.

Champion-role keys absent from the cutoff Radar have pre-cutoff presence `0`. They may become true
future targets and therefore explicit misses, but can never become candidates retroactively.

## Metrics

Per cutoff and in aggregate, the report exposes:

- Recall@K and Precision@K;
- false-alert rate, count, and false alerts per cutoff;
- median hours from cutoff to adoption-threshold confirmation;
- review compression: observed champion-role entries divided by selected candidates;
- evidence coverage: selected candidates with at least one cutoff evidence ID;
- hit, miss, target, and selected observation counts.

Recall is `null` for a window with no future target, rather than being presented as a successful
zero. Precision is `null` when no candidate was selected. Macro recall excludes no-target windows;
micro metrics retain their explicit total denominators. Repeated champion-role outcomes across
walk-forward cutoffs are counted as observations, not mislabeled as unique strategies.

## Failure log

Every cutoff has a `failure_cases` array:

- `MISSED_ADOPTION` retains future counts, confirmation time, and outcome match IDs;
- `FALSE_ALERT` retains the cutoff Radar rank and candidate evidence IDs.

The log is part of the primary artifact, not a separate optional analysis. A system that improves
recall by sending too many false alerts has not automatically improved the staff workflow.

## Current limitation

The implementation and leakage tests are complete, but a non-fixture result is only valid after the
real daily archive passes the retrieval-count, continuity, distinct-state, and matured-cutoff gates.
Until then, the correct output is `HISTORY_NOT_READY`, not a benchmark reconstructed from today's
annual file.
