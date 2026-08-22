# Oracle's Elixir Coverage Readiness

The annual coverage audit answers a narrow question before publication: does the selected patch
contain enough validated professional-match breadth to run the public Meta Radar? It does not claim
that a sample is representative of every team or that a pick is stage-ready.

## Command

```bash
python -m pro_meta_intelligence audit-oe-coverage \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --retrieved-at 2026-08-22T03:00:00Z \
  --output outputs/oracles-elixir/coverage.json
```

The command imports the file through the same policy and validation adapter used by Meta Radar. It
returns exit code `0` when all gates pass and `2` when one or more gates fail.

## Measured output

The JSON contains annual discovered/imported/rejected game counts and observed date bounds. Every
patch lists match, pick-event, league, known-region, and distinct-team counts; observed date bounds;
and any leagues missing from the reviewed league-to-region map. The latest patch is selected by the
most recently observed match, matching Meta Radar behavior. `--patch` can select one explicitly.

There is deliberately no composite quality score. Default publication gates are:

- at least 20 validated matches on the selected patch,
- at least 8 distinct teams,
- at least 2 mapped regions,
- zero rejected games,
- zero unknown leagues on the selected patch.

The numeric thresholds can be changed with `--readiness-minimum-matches`,
`--readiness-minimum-teams`, and `--readiness-minimum-regions`. Every failure remains visible in
`blocking_reasons`; lowering a threshold does not hide the measured counts.

## Unattended publication behavior

`sync-oe-feed` runs this audit after source acquisition and normalization, under the same exclusive
writer lock. `REJECTED_IMPORT_ISSUES` or `REJECTED_READINESS` is written to the immutable job audit,
but no Radar/Creator snapshot is published and the existing `current.json` remains unchanged.

The standalone `refresh-feed` command remains a caller-controlled local path and does not apply the
annual readiness gate automatically.

This audit is only the current-publication gate. Historical backtest input requires multiple dated
snapshots and is evaluated separately by [`OE_HISTORY_READINESS.md`](OE_HISTORY_READINESS.md).
