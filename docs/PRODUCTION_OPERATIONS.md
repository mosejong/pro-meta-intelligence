# Production operations

The unattended Oracle's Elixir path has three separate responsibilities:

1. `sync-oe-feed` performs policy-gated acquisition, archive audit, publication readiness, Radar and
   Creator publication, and walk-forward readiness maintenance under one writer lock.
2. `check-oe-feed-health` turns the latest local artifacts into a scheduler-friendly pass/fail
   signal.
3. An operating-system scheduler invokes both through a reviewed wrapper. It does not bypass source
   intervals, commit raw provider data, or push repository changes.

## Health command

```bash
python -m pro_meta_intelligence check-oe-feed-health \
  --run-dir outputs/oe-feed-jobs \
  --feed-dir web/public/feed \
  --maximum-job-age-hours 30 \
  --maximum-source-age-hours 50 \
  --output outputs/oe-feed-jobs/health.json
```

Exit code `0` means the latest job succeeded, the job and source snapshot are fresh, the public feed
is a non-fixture publication that passed readiness, and the compact history artifact is valid. Exit
code `2` means at least one operational gate failed.

`HISTORY_NOT_READY` is not an outage. During the initial collection period, the health report remains
`HEALTHY` with phase `COLLECTING_HISTORY`; the four history gates continue to describe progress. This
prevents monitoring from paging merely because the leakage-safe benchmark correctly refuses to run
before future outcomes exist.

Default health limits are intentionally wider than the 24-hour provider interval:

- latest completed job: at most 30 hours old;
- latest verified source snapshot: at most 50 hours old.

The extra margin tolerates a sleeping workstation or a short provider outage without hiding a truly
stalled collector.

## Windows runner

Run one complete sync and health check from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\run-oe-sync.ps1
```

The wrapper prefers `.venv\Scripts\python.exe`, otherwise it uses `python` from `PATH`. It writes only
ignored operational files under `outputs/oe-feed-jobs/` plus the reviewed public feed artifacts. Its
exit code is nonzero when the sync or health check fails, which lets Task Scheduler record failure.

To register a task, review the action without changing the machine first:

```powershell
.\ops\windows\register-oe-sync-task.ps1 -WhatIf
```

Then register it explicitly:

```powershell
.\ops\windows\register-oe-sync-task.ps1
```

The default trigger starts five minutes after registration and repeats every 25 hours. An early first
run safely reuses the verified cache; the source adapter still performs at most one network download
per reviewed daily interval. The 25-hour repetition avoids a daily trigger repeatedly arriving a few
seconds before the provider's exact 24-hour gate. `StartWhenAvailable` catches up after sleep or
downtime, overlapping runs are ignored, and the application-level writer lock remains the final
concurrency guard.

By default this local task collects and validates data but does not commit or push. That keeps the
first operational rollout observable and reversible.

## Isolated publication

`publish-oe-feed.ps1` uses a locked, detached Git worktree outside the developer checkout. It first
runs the health gate, fetches the remote publication branch, refuses a dirty publisher worktree, and
copies exactly two allowlisted artifacts:

- `web/public/feed/current.json`
- `web/public/feed/history-status.json`

It stages those exact paths, rejects any unexpected staged file, creates no commit when bytes are
unchanged, and performs a normal fast-forward push. It never force-pushes and never copies the raw
archive, local audit files, source CSV, Creator working files, or unrelated developer changes.
Whether a run downloaded the provider file or reused the daily cache remains in the local job audit,
not `current.json`. The same source snapshot therefore produces byte-identical public evidence and
does not create a timestamp-only or cache-status-only publication commit.

Review the operation without creating a worktree or pushing:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\publish-oe-feed.ps1 -WhatIf
```

After this feature is merged into the publication branch, run one manual publication. Only then
enable unattended publication on the scheduled task:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\register-oe-sync-task.ps1 -EnablePublish
```

The registration script passes `-Publish` to the normal sync wrapper. A failed sync, failed health
gate, dirty publisher worktree, unexpected path, non-fast-forward remote update, or push rejection
returns nonzero and leaves the developer checkout untouched.

This design follows Git's documented linked-worktree isolation and locking model. It intentionally
does not use GitHub Actions cache as the historical source archive: GitHub documents a seven-day
default cache retention for public repositories, shorter than this project's minimum 14-day history
gate. See the official [Git worktree documentation](https://git-scm.com/docs/git-worktree.html) and
[GitHub cache settings documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

## Incident order

Use `health.json` and its `next_action` field before reading large audits:

- `INSPECT_LAST_JOB`: inspect `outputs/oe-feed-jobs/latest.json` and its named immutable run record;
- `RUN_SYNC_NOW`: run the Windows wrapper once and verify source availability;
- `RESTORE_PUBLIC_FEED`: keep the last good public feed and inspect the readiness rejection;
- `REBUILD_HISTORY_STATUS`: rerun sync so the compact status is recreated from the private archive;
- `KEEP_DAILY_COLLECTION`: no incident; continue accumulating point-in-time history.
