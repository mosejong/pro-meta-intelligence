# Oracle's Elixir Real-file Benchmark

## Purpose

This benchmark closes the Phase 2 performance-validation gap with a provider-published annual
file while keeping the raw dataset outside Git. It measures local CSV validation, normalization,
Meta Radar construction, JSON serialization, and optional output writing. It does not claim model
quality or historical predictive performance.

## Reproduction

First obtain the reviewed annual file through `fetch-oe` or the provider's official download page.
Then run:

```bash
python -m pro_meta_intelligence benchmark-oe \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --retrieved-at 2026-08-23T03:37:47.491921+00:00 \
  --radar-output outputs/oracles-elixir/radar-2026.json \
  --output outputs/oracles-elixir/benchmark-2026.json
```

The benchmark summary contains only hashes, counts, timings, and bounded quality evidence. It never
embeds the provider's raw rows. `--fail-on-import-issues` is available when a caller wants a nonzero
exit after still receiving the benchmark evidence.

## Measured run

Run date: 2026-08-23. Environment: Python 3.12.10 on Windows 11. Timings are specific to this
workstation and should not be compared across unlike hosts.

| Measurement | Result |
| --- | ---: |
| Input size | 62,893,908 bytes |
| Input rows | 93,948 |
| Discovered games | 7,829 |
| Imported games | 7,382 |
| Rejected games | 447 |
| Import time | 3.149408 s |
| Radar build time | 0.120196 s |
| JSON serialization time | 0.013309 s |
| Radar output write time | 0.001278 s |
| Total measured time | 3.284246 s |
| Import throughput | 29,830.364 rows/s |
| Selected patch | 16.16 |
| Recent / prior matches | 219 / 17 |
| Radar entries | 179 |
| Review-eligible entries | 132 |
| Radar JSON size | 509,617 bytes |

Input source version:
`sha256:7161aaf29c8bfc30aac58b0bb49922115b91923f33c4496683aba16c8650a3be`.

## Compatibility finding

The real file exposed 1,276 games whose `split` column was consistently blank. `split` is used only
to enrich the display tournament name; it is not required for match identity, patch windows, teams,
roles, or picks. The importer now accepts a consistently blank `split` while still rejecting mixed
or inconsistent values within a game. This increased imported games from 6,229 to 7,382. Some of
the newly examined games then failed later, more substantive checks, so the net recovery is 1,153.

Remaining rejections are preserved rather than silently repaired:

- `MISSING_TEAM_ID`: 323
- `INCOMPLETE_GAME`: 109
- `INVALID_FIRST_PICK`: 15

## Publication follow-up

The next quality increment resolved the blockers found by this benchmark. The reviewed region map
now covers every league on patch 16.16, and import issues are attributed by patch, league, and code.
For 16.16 the importer discovered 260 games, imported 236, and disclosed 24 known exclusions: 14
incomplete games and 10 games with missing team IDs. It found zero selected-patch contract issues
and zero unknown leagues, so the real feed passed the version 2 readiness gate.

The 15 `INVALID_FIRST_PICK` issues remain visible in the annual audit but occur outside the selected
patch. They warn on current publication and remain blocking evidence when an affected historical
state is evaluated. This distinction makes current publication usable without weakening the
point-in-time historical contract.
