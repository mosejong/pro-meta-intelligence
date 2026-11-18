# Hosted history-only acquisition: Claude implementation result (2026-11-18)

Model: Claude Opus 5.5 (`claude-opus-5-5`). Implementation only. No commit, push, workflow
dispatch, deployment, provider request or secret access. Not executed in production. Needs
independent Codex review before any use.

## Changed files

- `.github/workflows/hosted-oe-sync.yml`: `history_only` boolean input (default false); job env
  `HISTORY_ONLY` (`workflow_dispatch && inputs.history_only == true`); history step after restore
  and before current sync/repack; history diagnostics upload; `env.HISTORY_ONLY != 'true'` guards
  on current sync, scouting/season-history refresh and restore-on-failure steps, Pages
  build/configure/upload, publish/push and the failure-notification step; deploy job excludes the
  mode; a final step propagates history failure after repack, upload and retention; restore
  refuses `allow_fresh_start` in history mode.
- NEW `ops/hosted_history_acquisition.py`: offline preconditions (authenticated restore report,
  including the JSON `null` case; existing, non-empty, integrity-clean archive; readable ledger;
  unexpired source policy review). It then delegates once to `player_career_archive.main
  --fetch-next` and classifies the result: `ACQUIRED`, `NOTHING_MISSING`, `DEFERRED`,
  `BLOCKED_PUBLIC_RECORDS`, `SOURCE_UNAVAILABLE`, `FAILED` or `BLOCKED_PRECONDITION`. It compares
  the ledger before and after delegation. The report is bounded and omits local raw paths.
- NEW `tests/test_hosted_history_acquisition.py`: 34 offline tests covering workflow routing
  and defaults, public-step exclusion, a condition simulator for both modes, the
  repack-after-failure order, preconditions, classification, and real delegation through
  `fetch-oe` with in-memory transports (failed attempt persisted, one-year acquisition,
  ledger/public deferral with zero fetches).
- `docs/HOSTED_OE_COLLECTOR.md`: new manual history-only section.
- `tests/test_ops_scripts.py`: one assertion updated semantically (see review round 2).

## Review round 2 (Codex): current-only diagnostics guard

Defect: `Preserve public-safe sync diagnostics on success or rejection` used `if: ${{ always() }}`
without `continue-on-error`, and it ran before the encrypted repack in history mode too. If the
artifact service failed there, the job failed and the implicit-success repack, archive upload and
retention steps were skipped, so the new attempt ledger was lost.

Fix: the step is now `if: ${{ always() && env.HISTORY_ONLY != 'true' }}`. Default behavior is
identical: it still runs on success and on sync rejection.

- `tests/test_ops_scripts.py`: the exact-string assertion `"if: ${{ always() }}" in workflow` is
  replaced by an assertion scoped to that step's block requiring the new current-only condition.
  This keeps the always-on-rejection intent and adds the history exclusion.
- The simulator in `tests/test_hosted_history_acquisition.py` now models implicit `success()`,
  `always()`, `continue-on-error` and one injected step failure. Two new tests:
  - `test_no_history_mode_step_failure_before_repack_can_lose_the_attempt_ledger`: for every step
    that runs in history mode between the history step and the repack, it injects a failure and
    requires that repack, archive upload, retention and the final outcome report still run. It also
    asserts the current-only diagnostics step does not run in that window.
  - `test_current_diagnostics_step_is_current_only_and_default_still_uploads_on_rejection`: it
    checks the exact guard. On a default run with sync rejected, it confirms that diagnostics,
    repack, archive upload and failed-health preservation still run.
- Mutation check: restoring the old `${{ always() }}` condition in memory and failing that step
  makes the simulator skip the repack, so the new tests detect the original defect.
- `tests/test_hosted_history_review.py` is unchanged.

## Checks (local, Windows, Python 3.12)

- `python -m pytest -q` (round 2): 456 passed. Focused run of
  `tests/test_hosted_history_acquisition.py`, `tests/test_ops_scripts.py` and
  `tests/test_hosted_history_review.py`: 47 passed.
- Round 1: 453 passed, including the reviewer-added `tests/test_hosted_history_review.py`. Two of
  its tests initially failed: a JSON `null` restore report was accepted, and an empty archive was
  not refused. Both were fixed in the helper.
- `python -m ruff check` / `ruff format --check` on the new files: clean. Repo-wide `ruff check
  src ops tests` reports one pre-existing E731 in `ops/evaluate_t1_kc_20261107.py`, which is
  unrelated and outside scope.
- The workflow YAML parses with PyYAML. GitHub expression semantics were not exercised on
  Actions. In particular, the job-level `inputs` usage and `env` in step `if:` are not verified
  on Actions.

## Limitations and open points for review

- A history attempt is not published to `collection-status.json`, so the public watchdog and
  public budget records do not see it. Only the encrypted ledger does. The next scheduled
  current-season sync is deferred by up to 24 hours. That tradeoff is documented, not automated.
- `DEFERRED` exits 0, so a green run can mean "nothing requested". The step summary and report
  outcome state this explicitly.
- No distributed lock exists. Local provider downloads must stop while the server owns collection.
- The simulator is a test-local model of GitHub step conditions, not GitHub's evaluator. It
  handles only the condition shapes used in this workflow.
- Planning constructs a transport object without fetching. The tests assert zero `fetch` calls
  rather than zero constructions.
