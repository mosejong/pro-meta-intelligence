# Snapshot feed publication

## Purpose

`refresh-feed` converts one validated local Oracle's Elixir CSV into a versioned Meta Radar report,
a Creator brief, and stable feed heads that a dashboard or scheduler can consume.

This command performs no network collection. Source acquisition remains a separate policy-gated
adapter responsibility; a scheduler must supply a provider-published local file.

## Layout

```text
feed/
  current.json
  current-creator.json
  index.json
  snapshots/
    patch-16.14--20260815120000--<content-hash>/
      radar.json
      creator-brief.json
      manifest.json
```

- Snapshot directories are immutable and content-addressed.
- `current.json` is the newest Radar report by cutoff.
- `current-creator.json` is the matching Creator brief.
- `index.json` lists recent versions and their hashes and relative paths.
- Limiting index entries never deletes immutable snapshot directories.

## Safe publication order

The publisher writes and verifies the immutable Radar/Creator pair first. It then replaces each
mutable head with an atomic file operation, writing the Creator head, Radar head, and index commit
marker in that order. A failure before the immutable pair is complete cannot expose that snapshot as
current; retrying the same publication safely reconciles mutable heads after an interrupted update.

Publishing identical content is idempotent. Existing bytes are verified rather than overwritten.
If immutable content has been modified, publication fails before moving a feed head. A historical
backfill enters the index but cannot move `current.json` behind a newer cutoff.
When two different snapshots share a cutoff, the later publication is treated as the current
correction. Publication timestamps earlier than the Radar cutoff are rejected.

The current implementation assumes one feed writer at a time. A production scheduler must prevent
overlapping runs or add a distributed single-writer lease before multiple workers are enabled.

## CLI

```bash
python -m pro_meta_intelligence refresh-feed \
  --input path/to/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --feed-dir outputs/meta-radar-feed \
  --creator-top-k 3 \
  --max-index-entries 50
```

The command can be invoked by Windows Task Scheduler, cron, or a CI runner after an approved source
adapter has placed a local input file. Use `--fail-on-import-issues` in unattended jobs so a rejected
game prevents the current feed from advancing.

For reproducible replays and tests, pass explicit `--retrieved-at`, `--cutoff`, and `--published-at`
timestamps. Without them, current UTC is used where applicable.

## Deliberate limits

- No site is crawled or downloaded by `refresh-feed`.
- No external AI provider is called.
- The local file remains caller-supplied and its authenticity is explicitly unverified.
- Multi-writer locking, hosted object storage, and signed feed manifests are future production gates.
