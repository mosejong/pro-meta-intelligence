# Diagnostics upload failure must not skip the encrypted ledger repack (2026-11-20)

## Scope

One property and one comment line in `.github/workflows/hosted-oe-sync.yml`: the existing
step **Preserve public-safe sync diagnostics on success or rejection** now has
`continue-on-error: true`. Nothing else in the workflow changes.

This is independent of the pending metadata-export proposal. It changes no outgoing data
and no destination: the step's `if:` condition, artifact name
(`oe-sync-diagnostics-${{ github.run_id }}`), the three uploaded paths, `if-no-files-found: warn`,
`retention-days: 14`, the action version and the job permissions are byte-for-byte unchanged.
No restore report or snapshot metadata is added to any upload.

## Trigger (derived from the workflow source, not an observed incident)

No failed run of this step has been observed. The risk follows from the step ordering in
`hosted-oe-sync.yml`:

1. `sync-health` runs `sync-oe-feed`, which records the new provider attempt in the private
   archive's attempt ledger. It is `continue-on-error: true` precisely so that the later
   steps still run after a provider or health rejection.
2. The normal diagnostics upload runs next with `if: always() && HISTORY_ONLY != 'true'`.
3. **Repack authenticated private history without publishing raw rows** has no `if:`, so it
   uses the implicit `success()` condition.

Hypothetically, if step 2 fails (for example an artifact-service error during
`actions/upload-artifact`), the job status becomes failed and step 3, the encrypted-state
upload and the two-newest retention step are all skipped. The next scheduled run would
then restore the previous rolling state, which does not contain the attempt recorded in
step 1, so the rolling 24-hour provider-attempt ledger would lose that attempt.

The history-only diagnostics upload already carries `continue-on-error: true` for this exact
reason ("A diagnostics upload failure must never prevent the attempt ledger from being
repacked."). The normal diagnostics step now uses the same rationale and comment.

## What stays strict

- The repack, the encrypted-state upload (`if-no-files-found: error`) and the retention
  step keep no `continue-on-error` and no `if:`; their failures still fail the job.
- `sync-health` failures are still surfaced by **Preserve failed collection health after
  publishing its public status**, which exits 1 unless the failure is source delay only.
- Scouting/history refresh gates (`steps.sync-health.outcome == 'success'`), the Pages
  build, the publish allowlist and `pages_ready` are unchanged.
- A failed diagnostics upload is still visible as a failed (continued) step in the run log;
  it only no longer blocks ledger preservation.

## Checks

Static guard: `tests/test_ops_scripts.py::test_normal_diagnostics_failure_cannot_skip_the_encrypted_ledger_repack`
asserts the exact diagnostics step text (including the unchanged three-path allowlist,
name, condition and retention), that the backup steps stay strict, and that the
source-health and publication gates are unchanged.

Independent verification: all 10 operations-script tests passed; Ruff check and format passed.
The workflow parsed successfully with the installed YAML parser. Codex split two long
expected-text literals in the regression test without changing their resulting strings.
The production edit remains Claude's two added lines only.

Actionlint is not installed locally, so no actionlint result is claimed. No provider
request, collector workflow dispatch, or runtime artifact-service failure injection was
performed for this change. The regression is a static step-order and gate check.
