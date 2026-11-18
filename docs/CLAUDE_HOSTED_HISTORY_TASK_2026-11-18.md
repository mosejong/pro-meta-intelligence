# Hosted historical acquisition · Claude implementation task

Use Opus 5.5 medium. Implement only; Codex independently reviews. No other agents, external browsing, provider requests, workflow dispatch, git commits/push, deployment or secrets access.

## Objective

Extend the existing hosted collector with an explicit manual **history-only** mode that reuses its authenticated restore, SAME archive/attempt ledger, existing `pages` concurrency group, encrypted repack and redundant archive retention. Default scheduled/current-season behavior must remain unchanged. History mode must never build/push/publish/deploy public feed or Pages.

Read `.github/workflows/hosted-oe-sync.yml`, `ops/player_career_archive.py`, source download/ledger code, `tests/test_ops_scripts.py`, and source policy before edits. Historical annual IDs and source-wide 24h policy already exist; do not expand source scope, frequency or reset history. Do not invent distributed locking across local machines: document local provider downloads must stop while server owns collection.

## Scope / requirements

- Add a default-false boolean workflow_dispatch history-only input. Historical path runs after authenticated restore and before encrypted repack, delegating at most one next missing annual file to the existing policy-gated `ops/player_career_archive.py --fetch-next` path. Do not call current sync first or it consumes the budget.
- Ensure histories and attempts are repacked after historical success, rejection or failed network attempt; failure cannot erase the persisted attempt. Preserve diagnostics and propagate history failure after private state preservation. Missing archive/key/restore errors must never allow a provider request.
- Explicitly guard every public sync/build/push/upload/deploy path against history-only mode. Default cron/manual path unchanged. Do not add automatic historical schedules or choose a current-season refresh tradeoff silently.
- Use shared public-budget preflight already implemented. A budget rejection is a truthful deferred outcome, never fetch success. If helper needed, keep it minimal and testable offline.
- Add focused tests for actual workflow routing/defaults/history publication exclusion/failure persistence, plus helper behavior if any. No tests may make provider requests. Existing tests must still pass.
- Update `docs/HOSTED_OE_COLLECTOR.md` with manual opt-in, shared ownership, cooldown/review expiry, at-most-one-year, failure preservation, archive vs validated history distinction. State not deployed or executed.

Write scope: `.github/workflows/hosted-oe-sync.yml`, optional NEW `ops/hosted_history_acquisition.py`, NEW `tests/test_hosted_history_acquisition.py`, `tests/test_ops_scripts.py` only if necessary, `docs/HOSTED_OE_COLLECTOR.md`, `docs/CLAUDE_HOSTED_HISTORY_RESULT_2026-11-18.md`. Do not alter other product code. Never weaken existing tests. If existing fetch path prevents safe operation, report exact reason before expanding scope.

Run relevant pytest and ruff. Report real model/checks/limitations. No production execution; independent review first.
