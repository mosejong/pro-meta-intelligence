# Oracle's Elixir Historical Readiness

One current annual CSV can support a current Meta Radar after coverage checks. It cannot truthfully
recreate what was knowable weeks earlier: every row in that file receives the local retrieval time
as `available_at`. Historical backtesting therefore requires a sequence of immutable daily raw
snapshots collected over time.

`audit-oe-history` answers whether that sequence is intact, semantically importable, continuous,
and old enough to contain observable outcome windows.

## Command

```bash
python -m pro_meta_intelligence audit-oe-history \
  --archive-dir outputs/oracles-elixir/raw \
  --source-timezone UTC \
  --output outputs/oracles-elixir/history-readiness.json
```

The command performs no network request. It reads the content-addressed archive created by
`fetch-oe` or `sync-oe-feed`, verifies every metadata record and referenced byte file, and imports
each distinct content hash through the full Oracle's Elixir adapter at its earliest archived
retrieval time.

Exit code `0` means all configured gates passed. Exit code `2` means the JSON audit was written but
history is not ready.

## Integrity checks

The archive inspection fails closed on:

- malformed or unsupported metadata,
- source-ID mismatch,
- unsafe or missing data-file references,
- invalid retrieval timestamps, URLs, hashes, or byte lengths,
- actual byte-length or SHA-256 mismatch,
- orphaned raw files.

Operational `latest()` lookups now use the same inspection. A corrupt archive cannot silently become
the source for a public feed. New raw and metadata files are durably written to a temporary file and
atomically linked into their immutable final names, so a partially written CSV is never published as
a completed content hash.

Byte integrity is necessary but insufficient. A correctly hashed file with the wrong CSV schema is
reported separately as `IMPORT_VALIDATION_FAILED`. Unknown game-level contract violations are
blocking; reviewed incomplete-game and missing-team exclusions are counted warnings.

## Default history gates

There is no composite readiness score. The starting operational defaults require:

- 14 archived retrieval records,
- 3 distinct, fully validated normalized match states,
- 14 days between first and last retrieval,
- no collection gap longer than 48 hours,
- a 7-day future-outcome horizon,
- 2 cutoff snapshots with a later distinct normalized state at least 7 days away,
- zero archive-integrity or file-level import failures.

Known `INCOMPLETE_GAME` and `MISSING_TEAM_ID` exclusions are counted and warned but do not invalidate
an otherwise usable normalized state. Other rejected-game contract codes are also retained as an
audit warning rather than invalidating an entire annual state. `benchmark-oe-history` then blocks
only a cutoff whose selected patch (or unattributed input) contains those contract issues. This
matches current publication policy and prevents an old unrelated invalid row from disabling every
later patch, while excluded games never enter features or outcomes.

These are collection-operability defaults, not proof of statistical power. They can be overridden
with the matching CLI options, while measured counts, gaps, and blocking reason codes remain visible.

## Retrievals, content versions, and matured cutoffs

A daily retrieval whose bytes are unchanged still proves that collection ran, so it increases
`retrieval_count`. It does not add a new historical state and therefore does not increase
`unique_normalized_state_count`. Raw content hashes and normalized-state hashes are both retained in
the audit so cosmetic source changes cannot masquerade as new historical evidence.

A cutoff is called matured only when another distinct, validated normalized state was retrieved
after the configured outcome horizon and contains matches observed after that cutoff. A cosmetic
change or retroactive correction to old rows cannot mature an outcome window. This prevents the
harness from calling the newest snapshot evaluable before future outcomes exist. Once the audit is
ready, `benchmark-oe-history` consumes only these named cutoff/outcome hash pairs; see
[`BLIND_SPOT_BENCHMARK.md`](BLIND_SPOT_BENCHMARK.md).

Consecutive normalized states also produce a revision ledger with added, removed, revised, and
unchanged match counts. Additions are expected for an annual append-oriented file. Removals and
revisions are surfaced as warnings so later backtests can pin the exact state that was available at
each cutoff instead of silently accepting retroactive corrections.

## Recommended operation

Run `sync-oe-feed` at most once per provider-published daily interval. Run the history audit after a
successful sync or on a separate weekly schedule. Keep the raw archive private; the command emits
hashes and aggregate validation reports, not provider CSV contents.
