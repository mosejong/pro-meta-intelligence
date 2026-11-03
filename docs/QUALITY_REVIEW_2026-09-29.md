# Quality review — 2026-09-29

## Verified UI work

- Chrome at 390px: restored task-card descriptions previously hidden by the old theme.
- Chrome at 930px: reproduced both navigation bars being hidden; aligned bottom navigation with the 960px top-navigation breakpoint and verified its appearance.
- Followed the mobile draft navigation link to the Draft Lab.
- Added fixture detail and an accessible `vs` separator to the home scoreboard.

## Operational findings

- Schedule run 36527287527 failed with `POLICY_REVIEW_EXPIRED`. Recheck the authoritative source policy before renewing the registry review; do not simply extend the date.
- Collector run 36499919026 failed. Its Pages test also rejected an empty `creator.topic_candidates` array. The collector's primary failure still needs its structured artifact examined; the test failure alone does not explain acquisition failure.
- Corrected the Pages candidate check to match `CreatorBriefBuilder`: an empty list is valid only when the paired Radar has no eligible entries and the brief carries `NO_ELIGIBLE_CANDIDATES`. Missing candidates when eligible entries exist, unsupported/duplicate candidates, mismatched snapshots and publication without review remain rejected. Built Pages and passed all three tests, including the new regression cases. No deployed recovery is implied by this local result.
- The checked-in collection record was updated September 21 and schedules a September 22 retry. It cannot establish current automation health on September 29.
- UI collection messages now take the observation timestamp and stop claiming normal collection or automatic retry once the status record is more than 36 hours old (three scheduled collection intervals). This does not renew or alter the underlying evidence.

## Remaining verification

### October 6 follow-up: local health retry guidance

The downloaded diagnostics for run 36499919026 show a successful sync job (exit 0)
reusing source-backoff cache, followed by a failed health check solely for source
age (97.48 hours versus the 50-hour limit). Its next attempt was September 29 at
15:23 UTC, later than the health observation, yet local health advised `RUN_SYNC_NOW`.
The local health assessor now emits `WAIT_FOR_SOURCE_RETRY_WINDOW` only for a
fresh successful job with explicit cache-backoff acquisition, no network request,
a valid future retry timestamp and no other failed checks. Health remains
`UNHEALTHY`. Due/invalid timestamps and failed/stale jobs cannot trigger this wait.
Nine regression cases were added; the health/watchdog suites pass all 33 tests.
This fixes operational guidance, not source freshness or deployed automation.

The September 29 source-policy inspection reached the official schedule, Riot
terms, developer policies and robots endpoint (which returned `User-agent: *`).
No registry review date was renewed: robots reachability alone does not establish
approval of the collection scope. Schedule policy renewal remains outstanding.

- React multiple-renderer warnings occurred during development-server navigation after hot reload. Production reproduction and root cause remain unverified; no suppression or speculative dependency change applied.
- Browser coverage is limited to the listed viewports and navigation; file import, multi-tab journal and a complete draft series still require interaction QA.
- No live source recovery, new publication, predictive superiority or human time-saving result is claimed.

### October 6: schedule policy diagnostics

fetch-schedule now returns exit code 5 and structured POLICY_BLOCKED diagnostics,
including the reason and REVIEW_SOURCE_POLICY action. Policy denial makes no
network request and preserves existing schedule and change-log files. CI retains
the diagnostic JSON for seven days on failure and reports the required review;
it does not deploy a blocked run.

Two regressions cover existing and absent publications. The interval regression
now uses the registered review time rather than the wall clock. CLI and registry
suites: 30 passed; Ruff passed. Long Windows test paths caused unrelated archive
write failures; the same suites passed under the shorter outputs/q106a directory.
Registry review dates remain unchanged. CI artifact upload needs a real workflow
run to verify; no live recovery or deployment is claimed.
