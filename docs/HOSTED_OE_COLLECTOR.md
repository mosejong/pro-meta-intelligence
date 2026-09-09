# Hosted Oracle's Elixir collector

## Production objective

The hosted collector removes the developer workstation from the public feed's critical path while
preserving the point-in-time raw history required for later walk-forward evaluation. It runs on
GitHub Actions at `07:13` and `19:13` UTC. These two policy-gate checks bound recovery delay after a
provider outage without authorizing two provider requests per day. The source adapter enforces the
exact 24-hour interval from the most recent persisted network attempt, including an attempt that
returned quota HTML or another rejected response. An early scheduled run therefore restores state,
reuses the verified cache, and performs no provider request.

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

No hosted run can silently reset history. If no prior artifact exists, `workflow_dispatch` must name
an encrypted `bootstrap_asset_id` or explicitly set `allow_fresh_start=true`. Scheduled runs always
fail closed in that state.

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
