# Hosted Oracle's Elixir collector

## Production objective

The hosted collector removes the developer workstation from the public feed's critical path while
preserving the point-in-time raw history required for later walk-forward evaluation. It runs on
GitHub Actions at `07:13` and `19:13` UTC. These two policy-gate checks bound recovery delay after a
provider outage without authorizing two provider requests per day. The source adapter enforces the
exact 24-hour interval from the most recent persisted network attempt, including an attempt that
returned quota HTML or another rejected response. An early scheduled run therefore restores state,
reuses the verified cache, and performs no provider request.

## Analysis patch selection

The hosted workflow uses `--patch-selection-league LCK`: the patch of the latest exact `LCK`
match known at the analysis cutoff. `LAS` and `LCKC` do not select the first-team patch.
This preserves the club preparation cohort after the LCK season ends while other leagues
continue on newer patches. The selected patch still includes all mapped leagues for comparisons;
it does not relabel old games as the Worlds patch. Acquisition continues on its existing schedule.
The selected patch must pass the unchanged readiness gates, and the selection mode/league are
recorded in public `publication_readiness.patch_selection` and the job audit.

The hosted workflow opts into `--retain-inactive-league-window`. When the selected patch has
no matches in the rolling recent window, its comparison windows end at the last observed
match on that patch, across the existing comparison leagues. Both seven-day window lengths
and sample thresholds stay unchanged. `cutoff` remains the actual source availability time;
availability filtering still excludes information not available by that cutoff. The public
`analysis_window` records `LAST_ACTIVE_PATCH`, the historical window end and the independent
availability cutoff. Radar displays a Korean off-season archive notice, and Creator exports
retain the same metadata plus `INACTIVE_PATCH_HISTORICAL_WINDOW` warning.

This is a newly verified historical club-patch analysis, not current Worlds meta. Freshness
checks still fail if the source availability cutoff becomes stale. Omit the opt-in flag to
retain rolling windows and the empty-window rejection. No patch alias, source timestamp,
provider interval, or freshness threshold is changed.

The option is mutually exclusive with `--patch`. An absent league or no available league match
fails the job and preserves accepted analysis heads. Omitting both options retains the generic
CLI's latest-match behavior. Analysis cutoff, source freshness and match dates remain independent;
selecting the last LCK patch does not make a stale source current. Historical walk-forward audits
retain their existing per-cutoff patch-selection policy and are not an evaluation of this cohort.

Reviewed region additions (2026-09-20): `HC` → EMEA ([Hitpoint organizer](https://hitpoint.cz/kdo-se-predstavi-v-hitpoint-challengers/));
`LAS` → KOREA, LCK Academy Series ([KeSPA](https://school.e-sports.or.kr/notice/view/1116),
[abbreviation crosswalk](https://lol.fandom.com/wiki/LCK_Academy_Series/2026_Season));
`LJL` → PACIFIC ([Riot](https://lolesports.com/ja-JP/news/ljl2026-Summer-Championship));
`VCS` → PACIFIC ([Riot](https://lolesports.com/vi-VN/news/gioi-thieu-vcs-2026)).
These are geographic analysis buckets, not aliases of first-tier leagues. Unknown codes continue
to block publication on the selected patch. Regression imports cover all four mappings and an
unreviewed code.

Reviewed region addition (2026-11-05): `EM` → EMEA, EMEA Masters, the cross-ERL tournament
([split schedule](https://www.sheepesports.com/kr/articles/emea-masters-summer-split-2026-start-date-and-slot-distribution/en)).
Its 2026 rows are ERL teams such as Solary, Galions and Karmine Corp Blue. Hosted syncs from
November 3 were rejected with `PATCH_HAS_UNKNOWN_LEAGUES` once the Worlds patch 16.20 also carried
EM games; accepted feed heads stayed in place. `WSCI` and `DCGI` remain unreviewed on older patches.

## Private state model

Provider CSV rows are never committed, deployed to Pages, attached to a release in plaintext, or
placed in a public cache. The rolling state contains only the reviewed
`outputs/oracles-elixir/raw/oracles-elixir-match-data` archive plus a bounded request-attempt ledger
and is:

1. integrity-checked using every metadata byte length and SHA-256 hash;
2. streamed into a deterministic tar layout;
3. compressed with Zstandard level 10 and long-distance matching over a 128 MiB window;
4. encrypted in 4 MiB chunks with AES-256-GCM and a unique nonce prefix;
5. terminated by an authenticated final frame so truncation and trailing data fail closed; and
6. uploaded as a private-state Actions artifact with no plaintext intermediate archive.

The request-attempt ledger contains only source ID, operation name, and timezone-aware request start
time. It is written atomically immediately before transport, is excluded from snapshot-history
counts, and remains inside the encrypted private state. Persisting failed starts prevents manual
dispatch followed by the regular schedule from bypassing the provider's interval.

During the one-time migration from an older encrypted state without a ledger, `sync-oe-feed` may
seed the gate from a schema-checked public `collection-status.json` only when that status explicitly
records that a network request occurred. It uses the later job-finish boundary, not the earlier job
start, so migration can delay a request by seconds but cannot make it early. Once written, encrypted
private state is authoritative.

Restore also caps the Zstandard decoder window at 256 MiB, each member at 256 MiB, the archive at 2,048
files, and total restored bytes at 8 GiB. These fail-closed limits bound decompression and disk-use
abuse. Reaching the 8 GiB raw-history ceiling is an operator signal to move matured history into the
future external object-store tier, not permission to silently discard evaluation cutoffs.

Two newest encrypted artifacts are retained. Each has a 90-day expiration, but successful scheduled
runs continuously replace them, providing one current state plus one recovery generation without
unbounded Actions storage growth. If both artifacts expire or `OE_ARCHIVE_KEY` is lost, historical
state cannot be recovered; start a new explicitly approved collection or restore from an operator
backup. A future external object store can replace this adapter without changing the archive
integrity contract.

### Verified capture manifest in pack and restore reports

`pack-report.json` and `restore-report.json` (still `schema_version` `"1"`) now include an
additive `snapshots` list. It is built from the same integrity-verified inspection that already
gates packing and restoring. Each entry contains only `content_hash`, `retrieved_at` (UTC ISO 8601)
and `byte_length`. Entries are sorted by UTC retrieval time and then by hash. Each archived
retrieval keeps its own entry even when several share a content hash, so the list length equals
`snapshot_count` and its distinct hashes equal `unique_content_count`. The list never contains raw
rows, filesystem paths, provider URLs, key material or request-ledger contents. All existing fields
are unchanged, and the encrypted container format, CLI arguments and key handling are untouched.
Authentication and integrity failures still fail closed without producing a report.

Hosted verification is still pending. These reports already ride in the private
`oe-private-history-state-*` artifact, so the regular scheduled job will start exposing the
manifest once this code is merged. No hosted run has produced a manifest yet, and no dispatch was
added for this purpose.

On 2026-11-20 the user explicitly approved exporting only these three fields
(`content_hash`, `retrieved_at`, `byte_length`) to the repository's existing Actions artifacts.
In normal (not `history_only`) runs, the step `Write the approved three-field snapshot manifest`
runs `ops/write_private_snapshot_manifest.py` on the existing `restore-report.json`. It writes a
standalone, sanitized JSON array to `outputs/hosted-oe-state/snapshot-manifest.json`, which is
appended as the fourth exact path of `oe-sync-diagnostics-<run_id>`. The step is best-effort
(`continue-on-error: true`) and runs only after a successful restore, so a failure (for example an
explicit fresh start with no restore report) never blocks the diagnostics upload or the encrypted
backup. Full restore and pack reports are not added to diagnostics; they stay only in the private
state artifact. History-only mode and all strict backup, health and publication gates are
unchanged. Scope, checks and verification status are in `docs/APPROVED_THREE_FIELD_EXPORT_2026-11-20.md`.

The cryptographic implementation uses the maintained `cryptography` AES-GCM primitive. The custom
container only frames bounded authenticated chunks for streaming; it does not implement an
encryption algorithm. `zstandard` provides the production compression binding. Both dependencies
are isolated under the `hosted-ops` extra and tested in CI.

## Hosted workflow

`.github/workflows/hosted-oe-sync.yml` executes at `07:13` and `19:13` UTC. One run:

1. requires the repository secret `OE_ARCHIVE_KEY`;
2. restores and authenticates the newest `oe-private-history-state-*` artifact;
3. on the first run only, accepts an explicit encrypted draft-release bootstrap asset ID;
4. runs `sync-oe-feed` through the normal source registry and readiness gate;
5. runs the private local health check;
6. repacks and uploads the authenticated rolling history before any Git push;
7. keeps the two newest encrypted history generations;
8. builds and validates the Pages artifact;
9. permits tracked changes only to Radar, Creator, history, decision-outcome, and bounded
   collection-status public heads;
10. performs a normal non-force push and deploys the already validated Pages artifact; and
11. when source freshness fails, deploys the bounded status but still fails the workflow.

A readiness-rejected or unavailable acquisition keeps all four accepted analysis heads
(`current.json`, `current-creator.json`, `history-status.json`, `decision-outcomes.json`)
unchanged. Candidate history and outcome diagnostics remain in the job audit; only the bounded
collection status advances. This lets the Pages consistency checks continue to validate the
last accepted publication while exposing the actual collection rejection.

No hosted run can silently reset history. If no prior artifact exists, `workflow_dispatch` must name
an encrypted `bootstrap_asset_id` or explicitly set `allow_fresh_start=true`. Scheduled runs always
fail closed in that state.

## Manual history-only acquisition (implemented, not deployed or executed)

Status 2026-11-18: workflow and helper are implemented and tested offline only. No run of this
mode has been dispatched, no provider request has been made from it, and it awaits independent
review before any production use.

`workflow_dispatch` accepts `history_only` (boolean, default `false`). Scheduled runs carry no
inputs, so `HISTORY_ONLY` is `'true'` only when an operator explicitly dispatches with
`history_only=true`. The default scheduled/manual current-season path is unchanged. No automatic
historical schedule exists, and this mode does not choose between historical and current-season
refresh on the operator's behalf: each dispatch is a deliberate choice to spend the shared
provider interval on one past annual file instead of the current season.

A history-only run:

1. uses the same `pages` concurrency group, `OE_ARCHIVE_KEY` requirement and authenticated restore
   as the normal run; a missing key, missing archive or failed restore stops before any provider
   path, and `allow_fresh_start` is refused outright in this mode;
2. runs `ops/hosted_history_acquisition.py`, which first requires an authenticated restore report,
   a non-empty integrity-verified archive, a readable attempt ledger and an unexpired source policy
   review (`policy_reviewed_at` + `review_interval_days`). Any failure is `BLOCKED_PRECONDITION`
   and nothing is delegated;
3. delegates exactly once to the existing `ops/player_career_archive.py --fetch-next` path, which
   applies the shared public-record budget preflight, the persisted source-wide attempt ledger and
   the 24-hour interval, and requests **at most one** missing reviewed past annual file through
   `fetch-oe --historical-usage-only`. `sync-oe-feed` is never called first, so it cannot consume
   the budget;
4. uploads bounded diagnostics (`oe-history-diagnostics-<run_id>`, 14 days) without blocking
   later steps on upload failure;
5. repacks and uploads the encrypted rolling state, and keeps the two newest generations, after
   success, budget deferral, rejection or a failed network attempt. The attempt ledger is written
   before transport, so a failed request remains persisted and governs the next scheduled run;
6. never runs current sync/health, scouting or season-history refresh, Pages build, Pages upload,
   Git commit/push, collection-health notifications or the deploy job. Each of those steps is
   explicitly guarded with `env.HISTORY_ONLY != 'true'`; the deploy job also excludes the mode; and
7. reports the outcome in the step summary and fails the workflow after state preservation unless
   the outcome is `ACQUIRED`, `NOTHING_MISSING` or `DEFERRED`.

Outcomes are truthful: `DEFERRED` means the private ledger or published records say the interval
has not elapsed and no new request was recorded. It is not acquisition success.
`BLOCKED_PUBLIC_RECORDS` (unreadable or inconsistent published budget records), `SOURCE_UNAVAILABLE`
and `FAILED` fail the run. The helper compares the attempt ledger before and after delegation, so
an attempt recorded during an unexpected error is still reported.

Because no public status is published in this mode, a historical attempt is visible only through
the encrypted private ledger. The next scheduled run restores that ledger and its current-season
sync is deferred for up to 24 hours. Plan for that tradeoff before dispatching.

Archived is not validated history. A downloaded annual file sits in the private raw archive only.
It is not complete coverage, validated player history or a public artifact until a separately
reviewed build and publication step uses it.

Shared ownership: the persisted ledger and published-record preflight are a conservative cross-check,
not a distributed lock. While the hosted collector owns collection, stop all local provider
downloads, including scheduled tasks, manual `fetch-oe` and local `--fetch-next`. A local request
is not visible to the hosted ledger and could exceed the provider interval.

## First migration from the workstation

Review without changing GitHub:

```powershell
./ops/windows/bootstrap-hosted-oe-archive.ps1 -WhatIf
```

Create a random 256-bit archive key in memory, configure it as the GitHub Actions secret, validate
and encrypt the existing local archive, and upload only the encrypted bytes to a temporary draft
release:

```powershell
./ops/windows/bootstrap-hosted-oe-archive.ps1
```

The script prints the numeric encrypted asset ID, never the key. Dispatch the hosted workflow with
that ID. After a successful run has uploaded an `oe-private-history-state-*` artifact, delete the
temporary draft release and disable the local scheduled collector so two machines do not compete
for the provider interval. Keep the public watchdog enabled; it observes the independently served
result rather than trusting either collector.

## Recovery and incident order

- `archive authentication failed`: stop; do not allow a fresh start. Verify the secret and restore
  the previous retained artifact.
- `source archive integrity failed`: retain both encrypted generations and inspect the named
  metadata/hash issue before collecting or publishing.
- provider unavailable with a healthy restored state: keep the last good publication; the next
  scheduled run may collect only after the persisted request-attempt interval. Use manual dispatch
  only for a reviewed incident response, not as an automatic retry loop; early dispatches reuse the
  cache without contacting the provider.
- non-fast-forward feed push: do not rebase or force-push from automation. Preserve the encrypted
  artifact and let the next run recompute from current `main`.
- both encrypted generations unavailable: require an explicit bootstrap or acknowledged fresh
  start; never manufacture continuity from the current annual file.

This path removes workstation availability from current publication and history accumulation. It
does not make GitHub Actions a source of truth for Riot or Oracle's Elixir, prove predictive value,
or authorize raw redistribution.
## October 2026 publication rejection

Annual coverage readiness is necessary but does not guarantee evidence in the Radar's
recent/prior windows. An inactive selected LCK patch can pass coverage while producing
zero entries. Hosted sync now rejects that candidate as `REJECTED_READINESS` with
`EMPTY_RADAR_WINDOW` before changing any Radar/Creator/history/outcomes head or creating
an immutable snapshot. The audit retains the selected patch, cutoff, windows and counts.
Collection status is still updated and private state retained; the existing Pages tests
can publish this bounded rejection alongside the last accepted public heads.

This does not reset source timestamps, change patch selection, waive freshness checks,
or bypass the provider retry interval. Freshness recovery still requires accepted source
evidence and a publishable analysis window. A successful deployment of rejection status
is not a healthy data signal.
