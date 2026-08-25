# Production operations

The unattended production path has seven separate responsibilities:

1. `sync-oe-feed` performs policy-gated acquisition, archive audit, publication readiness, Radar and
   Creator publication, and walk-forward readiness maintenance under one writer lock.
2. `check-oe-feed-health` turns the latest local artifacts into a scheduler-friendly pass/fail
   signal.
3. An operating-system scheduler invokes both through a reviewed wrapper. It does not bypass source
   intervals, commit raw provider data, or push repository changes.
4. The same wrapper makes one policy-gated request for the official LoL Esports schedule after the
   core sync and writes a T1 change log. Schedule failure preserves the last good companion feeds
   and does not mislabel the independently healthy match-data Radar as an outage.
5. A dedicated GitHub workflow can refresh only the official schedule and T1 change log every eight
   hours. It respects the six-hour registry interval, validates the static publication, and pushes
   only those two normalized artifacts.
6. An independent GitHub watchdog downloads the actually served public artifacts every six hours,
   fails on availability, pairing, freshness, or boundary violations, and maintains one incident.
7. The hosted OE workflow restores an authenticated encrypted history state, runs the same policy
   and readiness gates, keeps two rolling recovery generations, and publishes only safe feed heads.

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
is a non-fixture publication that passed readiness, and the paired compact history and decision-
outcome artifacts are valid. Exit code `2` means at least one operational gate failed.

`HISTORY_NOT_READY` is not an outage. During the initial collection period, the health report remains
`HEALTHY` with phase `COLLECTING_HISTORY`; the four history gates continue to describe progress. This
prevents monitoring from paging merely because the leakage-safe benchmark correctly refuses to run
before future outcomes exist.

The public history panel also exposes collection continuity and an earliest-possible readiness date.
Treat `ON_TRACK` as “no audited gap above the configured 48-hour ceiling,” not proof that the next
download will contain a distinct state. `GAP_DETECTED` requires operator review. The date forecast is
not guaranteed and assumes uninterrupted daily retrievals plus every distinct state needed to mature
the future-outcome cutoffs.

Default health limits are intentionally wider than the 24-hour provider interval:

- latest completed job: at most 30 hours old;
- latest verified source snapshot: at most 50 hours old.

The extra margin tolerates a sleeping workstation or a short provider outage without hiding a truly
stalled collector.

## Independently hosted publication watchdog

`.github/workflows/production-watchdog.yml` checks the independently served GitHub Pages artifacts
every six hours. It does not trust the repository checkout as proof of production health. The job
downloads the live Radar, Creator, history, decision-outcome, official-schedule, and AI-validation heads with bounded response sizes,
retries transient HTTP failures, and runs `check-publication-watchdog` against those downloaded
bytes.

The public watchdog fails closed when:

- the Radar or Creator contract is invalid;
- the Radar and Creator patch/cutoff pair differs;
- the history status does not belong to the current Radar cutoff;
- the decision-outcome contract is invalid or does not match the history `as_of` and readiness;
- the AI validation status is missing, malformed, or enables AI before every paired-human gate passes;
- Radar data is older than 50 hours or schedule data is older than 30 hours;
- a public artifact contains a local path, provider CSV reference, or product-login branding; or
- any required public endpoint cannot be downloaded.

One labeled GitHub issue represents the incident lifecycle. A repeated failure updates that issue
instead of opening duplicates, while the first healthy run closes it automatically. The final step
still fails the workflow so repository notification settings and external Actions monitoring can
observe the outage. This watchdog proves endpoint availability, pairing, and freshness only. It
cannot prove that the private collector job ran correctly or that Radar rankings are predictive.

Reproduce the contract locally against already downloaded artifacts:

```bash
python -m pro_meta_intelligence check-publication-watchdog \
  --feed-dir path/to/downloaded/feed \
  --maximum-radar-age-hours 50 \
  --maximum-schedule-age-hours 30 \
  --output outputs/publication-watchdog/health.json
```

## Windows runner

The Windows runner is the bootstrap and emergency fallback after hosted collection is verified. Do
not leave it enabled alongside the hosted collector: two independent schedulers would compete for
the same reviewed 24-hour source interval and split the historical availability ledger. The hosted
architecture and first migration procedure are documented in
[`HOSTED_OE_COLLECTOR.md`](HOSTED_OE_COLLECTOR.md).

Run one complete sync and health check from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\run-oe-sync.ps1
```

The wrapper prefers `.venv\Scripts\python.exe`, otherwise it uses `python` from `PATH`. It writes only
ignored operational files under `outputs/oe-feed-jobs/` and immutable raw source archives plus the
reviewed public feed artifacts. Its exit code is nonzero when the core sync or health check fails,
which lets Task Scheduler record failure. The schedule command has a separate logged exit code and
retains the previous schedule on failure.

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
copies exactly seven allowlisted artifacts:

- `web/public/feed/current.json`
- `web/public/feed/current-creator.json`
- `web/public/feed/history-status.json`
- `web/public/feed/decision-outcomes.json`
- `web/public/feed/schedule.json`
- `web/public/feed/schedule-changes.json`
- `web/public/feed/ai-validation.json`

It stages those exact paths, rejects any unexpected staged file, creates no commit when bytes are
unchanged, and performs a normal fast-forward push. It never force-pushes and never copies the raw
archive, local audit files, source CSV, Creator working files, or unrelated developer changes.
Whether a run downloaded the provider file or reused the daily cache remains in the local job audit,
not `current.json`. The same source snapshot therefore produces byte-identical public evidence and
does not create a timestamp-only or cache-status-only publication commit.

## GitHub schedule watch

`.github/workflows/schedule-refresh.yml` runs at minute 17 every eight hours and can also be invoked
manually. The `fetch-schedule` command reads the published snapshot time before making a request, so
an early manual run fails closed at the registry interval even when the CI runner has no persisted
raw archive. On success it:

1. archives raw HTML only in the ephemeral ignored job workspace,
2. writes `schedule.json` and `schedule-changes.json`,
3. runs the GitHub Pages artifact tests,
4. commits only those two public normalized files, and
5. performs a normal non-force push to `main`, and
6. deploys the already validated static artifact directly to GitHub Pages.

The direct deploy is required because GitHub suppresses new workflow events from repository-token
pushes. The schedule workflow therefore does not rely on its own bot commit to trigger the normal
Pages workflow.

A concurrent main update can reject the push; the workflow does not rebase or overwrite it. The next
scheduled run can safely recompute the diff from the still-published snapshot.

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
