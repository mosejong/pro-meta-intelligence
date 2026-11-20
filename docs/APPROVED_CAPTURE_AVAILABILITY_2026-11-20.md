# Approved captured-data availability audit (2026-11-20, corrected)

Scope: a read-only check of whether the existing approved hosted capture
`sha256:ee18acfb648f9ef18c3d9851daeb5574d2559dd5e5e29c9cf1b093601eb48320` can be accessed or
inspected without a new provider request or a new key. Claude ran no commands, network calls,
downloads, decryption or secret reads for this audit. The code findings come from reading the
source. The GitHub metadata evidence below comes from Codex's independent verification and is
labelled as such.

**Correction (same day):** The first version described where the hash is recorded and the
deletion of the 2026-11-18 state artifact as inferences. Both are now settled by the evidence
below. The first version also said there was "no way, even with the key, to get a per-snapshot
manifest without a collection-capable workflow". That was wrong. An offline local restore followed
by `SnapshotArchive.inspect` already lists the snapshots (see "Paths that exist today"). The gap is
only on the hosted side. The pack and restore reports now also include an additive manifest; see
"Manifest change in this branch".

## Code paths checked

| Path | What matters here |
| --- | --- |
| `.github/workflows/hosted-oe-sync.yml:57-111` | Requires `OE_ARCHIVE_KEY`, restores the newest unexpired `oe-private-history-state-*` artifact and runs `restore-private-oe-archive`. |
| `.github/workflows/hosted-oe-sync.yml:113-127` | A `history_only` dispatch runs `ops/hosted_history_acquisition.py`, which can request one missing annual file from the provider. |
| `.github/workflows/hosted-oe-sync.yml:141-161` | Any run that isn't `history_only` runs `sync-oe-feed --year 2026`. Whether it contacts the provider depends on the 24-hour attempt gate. |
| `.github/workflows/hosted-oe-sync.yml:174-185` | Uploads plaintext `oe-sync-diagnostics-<run_id>` (`sync-report.json`, `local-health.json`, `latest.json`) on every non-`history_only` run. Kept for 14 days. |
| `.github/workflows/hosted-oe-sync.yml:186-220` | Every run repacks the state, uploads `oe-private-history-state-<run_id>` (90 days, with `pack-report.json` and `restore-report.json`), then deletes every state artifact except the two newest. |
| `src/pro_meta_intelligence/cli.py:1170-1177` | The sync operation writes `source_acquisition` (`status`, `retrieved_at`, `content_hash` of the newest archived snapshot) and `network_collection_performed`. In `sync-report.json` these sit under **`result.source_acquisition`**, not at the top level. |
| `src/pro_meta_intelligence/operations/private_archive.py` | Local `pack`/`restore`: needs the key from an environment variable, authenticates every chunk, restores into a new empty directory, integrity-checks the result, and makes no network calls. |
| `src/pro_meta_intelligence/sources/artifacts.py:171-258` | `SnapshotArchive.inspect` checks every snapshot's metadata, byte length and SHA-256 hash, offline. |

## Independently verified GitHub metadata (Codex)

Codex downloaded these through the GitHub connector. Each ZIP's SHA-256 matched GitHub's artifact
metadata.

| Diagnostics artifact | Run | `result.source_acquisition` | Network flag (historical) | Artifact expiry |
| --- | --- | --- | --- | --- |
| `14388418826` | `44216922140` (2026-11-18) | `status=DOWNLOADED`, `content_hash=sha256:ee18…8320`, `retrieved_at=2026-11-18T01:35:30.738564+00:00` | `network_collection_performed=true` | 2026-12-02T01:38:17Z |
| `14590318868` | `44652037031` (2026-11-20) | `status=REUSED_CACHE_DURING_SOURCE_BACKOFF`, same `content_hash` and `retrieved_at` | `network_collection_performed=false` | 2026-12-04T01:16:05Z |

- The network flags describe what those scheduled runs did at the time. This audit made **no**
  provider requests.
- **The 2026-11-18 encrypted state artifact is absent from that run's artifact listing.** That is
  verified now, not inferred.
- **The newest 2026-11-20 encrypted state artifact `14590099549` exists.** It was **not**
  downloaded or decrypted.

## Confirmed facts

1. Two separate hosted runs reported ee18 as their newest archived snapshot, with the same original
   retrieval time. On 2026-11-18 it was downloaded; on 2026-11-20 it was reused from the cache.
2. Those reports come from inspections the runs did on their own restored archives. They are
   hosted run reports, **not** a checked raw file. Nobody outside those runs has re-hashed the raw
   bytes.
3. The current encrypted reports in the state artifact contain only counts and the encrypted
   file's hash. Snapshot membership can't be read from them without the key. This holds until the
   manifest change below is merged and produced by a scheduled run.
4. No `workflow_dispatch` mode is restore-only. Every dispatch either attempts collection (the
   default mode runs `sync-oe-feed`; `history_only` may fetch an annual file) or repacks and
   rotates state artifacts. Default-mode runs may also push feed heads and deploy Pages.
5. The `SOURCE_DELAYED` status (`operator_action_required=false`, cached reuse) means the source
   is late. It does not mean the deployment failed and does not show that the server archive is
   missing.

## Unconfirmed facts

- **Whether ee18's raw bytes are in the latest state artifact `14590099549`: unverified.** The
  2026-11-20 report is strong evidence that the archive held it at that point. Nothing has checked
  the artifact's contents.
- **Key availability: unknown.** The repository secret is configured, because scheduled runs pass
  the required-key step. Whether an operator holds a usable copy outside GitHub is not confirmed.
  No secret was read. Nothing here claims the key is lost.
- **Whether ee18 is a checked raw receipt: no.** The feed cutoff `2026-11-18T01:35:30.738564+00:00`
  and the diagnostics reports refer to a source. Neither proves a raw receipt. Per
  `outputs/local-capture-inventory-20261120.json`, ee18 is not among the six local receipts. The
  newest local 2026 research outcome is still fcd2 (retrieved Nov 11). 76b7 is a 2022 file.
- **Season mapping: unconfirmed until checked row by row.** Calendar season and source year are
  separate fields. The fcd2 first row (`year=2025`, date in 2026) shows that the first row cannot
  classify a whole file.

## Paths that exist today

- **Read-only, no key (done by Codex):** listing artifacts and downloading the plaintext
  diagnostics. Both reports should be preserved before they expire (2026-12-02 and 2026-12-04).
- **Offline local restore with existing tools.** With an authorized copy of the existing key, an
  operator can download `14590099549` and run
  `restore-private-oe-archive --input <pmi> --archive-dir <new empty dir> --report <path>`, then
  inspect the restored directory with `SnapshotArchive.inspect`. That needs no network beyond the
  artifact download, no provider request and no new key. It writes provider rows in plaintext to
  local disk, so the existing private-data rules apply. Download outside the 07:13/19:13 UTC
  windows, because rotation can delete older generations. This is an existing authorized tool and
  needs no new approval process. However, **this audit did not authorize running it, and no
  production key has been confirmed available.**

## Manifest change in this branch (implemented, not hosted-verified)

`pack_private_oe_archive` and `restore_private_oe_archive` now add a `snapshots` list to their
reports. Each entry holds only `content_hash`, the UTC `retrieved_at` and `byte_length`, taken from
the integrity-checked inspection. Each retrieval keeps its own entry, the order is deterministic,
and the schema version is still `"1"`. Failures still fail closed. Once merged, the regular
scheduled job will put this manifest into the private state artifact's `pack-report.json` and
`restore-report.json`. That would show ee18 membership without anyone decrypting by hand. **No hosted run has
produced it yet.** See `docs/HOSTED_OE_COLLECTOR.md`.

### Approved three-field diagnostics export (added later on 2026-11-20)

After this audit, the user explicitly approved exporting only `content_hash`, `retrieved_at` and
`byte_length` to the existing Actions artifacts. Normal runs now write a sanitized standalone array
(`snapshot-manifest.json`) from the restore report. It is added as one exact path to the existing
diagnostics upload, best-effort. Full restore and pack reports are **not** newly exported to
diagnostics. No regular scheduled run has produced this yet. No dispatch, download, decryption,
key access or provider request was made. See `docs/APPROVED_THREE_FIELD_EXPORT_2026-11-20.md`.

## Remaining missing capability (hosted only, not implemented)

There is no dispatchable hosted workflow that restores the newest state and uploads only its
report, without syncing, acquiring, repacking, rotating, pushing or deploying. It isn't needed for
now: after merge, the regular scheduled job will expose the manifest. If it is ever built, it must
be `workflow_dispatch` only, use read-only permissions and the same `pages` concurrency group, and
have tests showing it cannot reach any provider fetch path and leaves the artifact count unchanged.

## Prohibited actions

- Dispatching `hosted-oe-sync.yml` in any mode (default, `history_only`, `allow_fresh_start`,
  `bootstrap_asset_id`) to "inspect" the state.
- Setting `allow_fresh_start=true`, or creating or rotating `OE_ARCHIVE_KEY`. Running
  `ops/windows/bootstrap-hosted-oe-archive.ps1` without `-WhatIf` creates a new key and replaces
  the secret.
- Reading, printing or logging any secret, or claiming that the key is lost.
- Deleting artifacts by hand, or relying on an artifact surviving a scheduled rotation.
- Calling the source delay a failed deployment, or concluding that no server archive exists.
- Treating the feed cutoff or the diagnostics reports as proof of a checked raw receipt, or
  classifying any file's season from its first row.
- Calling evaluation on the already-seen current feed an untouched holdout. A new evaluation design
  is a separate task.
