# Approved three-field snapshot export (2026-11-20)

## Approval and exact scope

On 2026-11-20 the user explicitly approved this transfer: "세 가지 메타데이터만 전송 승인" ("approve sending
only the three metadata fields").

- **Fields:** each per-snapshot entry contains exactly `content_hash`, `retrieved_at` and
  `byte_length`. Nothing else.
- **Destination:** only the existing GitHub Actions archive and diagnostics artifacts of
  `mosejong/pro-meta-intelligence`. No new destination, artifact name, retention period, schedule,
  permission, mode, provider, key or algorithm.
- **Never included:** raw rows, player information, secret values, provider URLs, local paths,
  request-ledger contents, or any other field from the outer report.
- An earlier automatic review rejected exporting the full report. This approval covers **only**
  the sanitized three-field array. It does **not** approve exporting a full `restore-report.json`
  or `pack-report.json` through diagnostics, and none is exported that way.

## What changed

| Part | Change |
| --- | --- |
| `src/pro_meta_intelligence/operations/private_archive.py` | The pack and restore reports get an additive `snapshots` list built from the integrity-checked inspection. Outer fields and `schema_version` `"1"` are unchanged. These reports keep using their existing, already-approved paths inside the private state artifact. |
| `ops/write_private_snapshot_manifest.py` (new) | A standard-library-only CLI: `--report <restore-report.json> --output <snapshot-manifest.json>`. It writes a standalone JSON **array** containing only the three approved fields. |
| `.github/workflows/hosted-oe-sync.yml` | Adds the step `Write the approved three-field snapshot manifest` (`id: snapshot-manifest`) right before the normal diagnostics upload. It runs only when `always() && env.HISTORY_ONLY != 'true' && steps.restore.outcome == 'success'`, and has `continue-on-error: true`. The only upload change is one exact path appended to the normal diagnostics list: `outputs/hosted-oe-state/snapshot-manifest.json`. |
| Tests | `tests/test_private_archive.py`, new `tests/test_private_snapshot_manifest.py`, and the exact four-path allowlist in `tests/test_ops_scripts.py`. |

### Exporter checks (all fail closed)

The exporter writes nothing if any check fails. It never prints report values, and an existing
output file is left unchanged.

- The report must be a JSON object containing a non-empty `snapshots` list. Duplicate JSON keys
  and the non-standard constants `NaN` and `Infinity` are rejected. Reports are limited to 16 MiB
  and 4096 entries.
- Each entry must have exactly the three approved keys.
- `content_hash` must match `sha256:` followed by 64 lowercase hexadecimal characters.
- `retrieved_at` must be a timezone-aware ISO time with offset zero.
- `byte_length` must be a non-negative `int`. Booleans and floats are rejected.
- The same retrieval receipt (time and hash) appearing twice is rejected. So is one hash listed
  with two different byte lengths.
- If `snapshot_count` or `unique_content_count` are present, they must agree with the list. They
  are cross-checked only and never exported.
- Output is sorted by UTC time and then by hash. Distinct retrievals of the same content are all
  kept.
- The file is written atomically (temporary file, then replace). An output path that resolves to
  the input report is refused.

### What stays the same in the workflow

- **History-only mode:** its steps and diagnostics upload are untouched, and the manifest step
  does not run in that mode.
- **Normal diagnostics upload:** same name (`oe-sync-diagnostics-<run_id>`), same condition,
  `continue-on-error: true` (PR #137: a diagnostics failure must never stop the backup),
  `if-no-files-found: warn` and 14-day retention. It now lists four exact paths, with no wildcard
  and no `.pmi`, zip, cache, ledger or full report.
- **Strict steps:** repacking, the encrypted-state upload (`if-no-files-found: error`), the
  keep-two-newest step, source-health handling, the Pages build, publishing and deploy gates are
  all unchanged.
- **Failure cases:**
  - An explicit fresh start has no restore report, so the generator fails visibly but does not
    block the diagnostics upload or the backup.
  - A failed restore skips the generator and stops the job as it did before.

## Verification status

- **Local:** the code and tests are written. **Claude ran no tests, lint or typecheck.** Codex is
  verifying separately.
- **Hosted: not done.** No workflow was dispatched, no artifact was downloaded or decrypted, no key
  was accessed and no provider request was made. Proof will come from a **regular scheduled run**
  after merge. That run's restore will produce a report with `snapshots` and upload the sanitized
  array in its diagnostics.
- **Raw membership not verified.** Nobody has confirmed that ee18's raw bytes are in the current
  state artifact (`14590099549`). Even after a hosted manifest exists, it will be a report from the
  run's integrity-checked inspection, not an independently re-hashed raw file.
- **Timing:** the manifest comes from the **restore** report, so it describes the state as
  restored at the start of the run. A snapshot downloaded during that same run appears in the next
  run's manifest.

## Prohibited

Do not dispatch the collector to produce the manifest, add a dispatch or cache path, export full
reports or private artifacts, read or log secrets, or treat the feed cutoff or diagnostics as a
checked raw receipt.

## Independent local verification checkpoint
- Related private archive, three-field exporter and workflow guard tests:52/52 passed.
- Entire Python suite:918/918 passed in25.58seconds, using a short native temporary path.
- Ruff check and format:136files passed; workflow YAML parsed successfully.
- Codex changed only new-test formatting/string composition to resolve two lint findings;
  Claude's production source was not modified by Codex.
- No actionlint executable is installed locally, so no actionlint result is claimed.
- Existing frontend is untouched. No newproviderrequest, keyaccess, hostedcollector dispatch,
  or realartifactgeneration was used to obtain these local results.
- CI and hosted manifest evidence are separate gates; not claimed by this checkpoint.
