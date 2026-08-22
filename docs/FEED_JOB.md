# Single-writer feed job

`run-feed-job` turns the manual `refresh-feed` operation into a scheduler-ready local job without
adding network collection. It reads one JSON config, acquires an exclusive lock, refreshes the
Radar and Creator feed, and records an immutable audit result.

```bash
python -m pro_meta_intelligence run-feed-job --config configs/feed-job.example.json
```

Relative paths in the config are resolved from the config file's directory. The example expects an
approved source adapter or a human operator to place a provider-published CSV at
`data/inbox/oracles-elixir.csv`. The job does not download that file and does not call an AI API.

## Lock and audit behavior

- `feed-job.lock.json` is created exclusively before analysis starts.
- A second writer exits with code `3` and does not alter the active lock.
- Normal success, policy rejection, and unexpected failure are written to `runs/<run-id>.json`.
- `latest.json` is an atomic pointer-by-copy to the newest completed audit record.
- The owner removes its own lock in a `finally` block.
- A lock left after a process or machine crash is never deleted automatically. An operator must
  verify that no writer is alive before removing it.

Exit code `0` means published, `2` means rejected by import policy, `3` means another writer owns
the job, and `1` means an unexpected failure was audited.

Use Windows Task Scheduler, cron, or CI to invoke this command. Do not schedule `refresh-feed`
directly when concurrent starts are possible.
