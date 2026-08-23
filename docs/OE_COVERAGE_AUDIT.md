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

The version 2 JSON contains annual discovered/imported/rejected game counts and observed date
bounds. Every patch lists match, pick-event, league, known-region, and distinct-team counts;
observed date bounds; and any leagues missing from the reviewed league-to-region map. The latest
patch is selected by the most recently observed match, matching Meta Radar behavior. `--patch` can
select one explicitly.

Import issues are aggregated by patch, league, and code before publication. The selected patch also
exposes `imported_game_count`, `discovered_game_count`, known exclusions, blocking contract issues,
and the exact aggregate issue context in `selected_patch_import_quality`. This makes a partial but
usable patch distinguishable from a silently clean one.

There is deliberately no composite quality score. Default publication gates are:

- at least 20 validated matches on the selected patch,
- at least 8 distinct teams,
- at least 2 mapped regions,
- zero blocking import-contract issues on the selected patch,
- zero unattributed blocking import-contract issues,
- zero unknown leagues on the selected patch.

`INCOMPLETE_GAME` and `MISSING_TEAM_ID` are reviewed known exclusions. They may be excluded when the
remaining validated sample still passes every breadth gate, but they produce visible warnings and
counts. Every other current or future issue code defaults to blocking. Issues attributed only to an
older patch produce annual warnings rather than blocking the current patch; the stricter historical
audit still evaluates every archived state independently.

The numeric thresholds can be changed with `--readiness-minimum-matches`,
`--readiness-minimum-teams`, and `--readiness-minimum-regions`. Every failure remains visible in
`blocking_reasons`; lowering a threshold does not hide the measured counts.

## Unattended publication behavior

`sync-oe-feed` runs this audit after source acquisition and normalization, under the same exclusive
writer lock. A failed gate writes `REJECTED_READINESS` to the immutable job audit, but no
Radar/Creator snapshot is published and the existing `current.json` remains unchanged. A successful
snapshot embeds the complete readiness audit, including any allowed exclusion warnings, so the web
client does not need to infer publication quality.

The standalone `refresh-feed` command remains a caller-controlled local path and does not apply the
annual readiness gate automatically.

This audit is only the current-publication gate. Historical backtest input requires multiple dated
snapshots and is evaluated separately by [`OE_HISTORY_READINESS.md`](OE_HISTORY_READINESS.md).
