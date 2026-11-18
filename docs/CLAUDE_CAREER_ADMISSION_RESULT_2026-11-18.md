# Career archive admission audit — result (2026-11-18)

Implementer: Claude Opus 5.5 (medium). Reviewer: Codex. No agents, provider requests, browsing,
git operations, deployment, package installs or UI edits. Core builder and archive code were not changed.

## Files

- `ops/audit_player_career_archive.py` (new) — offline CLI + `audit_archive()` / `audit_year()`.
- `tests/test_career_archive_admission.py` (new) — 20 tests (17 initial + 3 output-boundary tests added after review).

## CLI

```
python -m ops.audit_player_career_archive [--archive-dir DIR] [--cutoff AWARE_ISO]
    [--year Y ...] [--player-id EXACT_ID ...] [--reference-season S] [--reference-patch P]
    [--output PATH]
```

- No fetch option. Nothing writes to the archive. `--output` refuses to overwrite: it checks before the audit and opens with `"x"`. A dangling symlink at the output path is also refused.
- `--output` is rejected if it resolves to the archive root or anywhere below it (fix for the Codex review defect, see below). The check runs before the audit, again before `mkdir`, and once more after `mkdir` and before opening. It compares both the plain absolute form (`..` normalized) and the fully resolved form (symlinks and junctions followed) of the output and archive paths, case-insensitively on Windows, using `os.path.commonpath`. A sibling such as `archive-reports/` that only shares a name prefix is allowed.
- `--cutoff` defaults to the real UTC time. A naive or unparseable cutoff is rejected.
- `--year` defaults to the registered manifest years in 2014..reference season. A year that isn't registered, or is outside that range, is rejected rather than skipped.
- `--reference-season` defaults to the cutoff year. Season and patch are checked by calling `build_player_career_history([], ...)`, so the builder's own rule is reused. The CLI also requires a literal patch matching `\d{1,2}\.\d{1,2}`.
- `--player-id` values are passed through unchanged (exact source IDs; duplicates are removed and the list sorted). Names are never joined, and IDs are never made up or normalized.
- A completed audit exits with 0, whatever the year statuses are. Read the result from `status_counts` and `years[].status`.

## Per-year decision (fail closed, in this order)

| Status | Condition |
|---|---|
| BLOCKED_INTEGRITY | `SnapshotArchive.inspect` issue attributed to this year, any unattributable issue, unreadable data file, or builder `HASH_MISMATCH`/`RETRIEVED_AFTER_CUTOFF` |
| NOT_DOWNLOADED | no snapshot matching the year's reviewed file ID (`archive_for_year`) |
| NOT_AVAILABLE_AT_CUTOFF | snapshots exist but all retrieved after cutoff (no hash/time emitted) |
| BLOCKED_POLICY | `PolicyGate.evaluate(IMPORT_LOCAL_CSV)` denied at cutoff or at any eligible retrieval time |
| INVALID_ARCHIVE | builder `MISSING_CORE_COLUMNS`/`INVALID_ARCHIVE`, or validated provenance ≠ set of eligible versions (`PROVENANCE_INCOMPLETE`) |
| NO_ACCEPTED_GAMES | 0 accepted logical games (e.g. every game conflicting or malformed) |
| USABLE_WITH_REJECTIONS | accepted > 0 and some logical games rejected |
| USABLE | accepted > 0, no rejections |

How each year is audited:
- Each year gets its own builder call that receives **all** eligible versions of that year, so the existing conflict poisoning applies across them. One bad version makes the whole year INVALID_ARCHIVE; the remaining valid versions don't make it look usable.
- Rejection reasons are the builder's own codes. No game-validation rule is duplicated.
- Inspection issues are mapped to a year by reading the issue's metadata `final_url` and matching it with the existing `archive_for_year` rule. If an issue can't be mapped this way, every requested year is blocked. That covers orphan data files, malformed metadata and unknown URLs. Issues that can be mapped block only their own year.

Per-player fields (only for the requested IDs):
- `OBSERVED` comes with games and chapter counts per team_id/role.
- `NOT_OBSERVED_UNKNOWN`, `UNKNOWN_UNSUPPORTED_ID` and `UNKNOWN_YEAR_NOT_USABLE` all mean unknown. None of them is evidence of retirement or zero skill.
- No names, champion data or raw rows are emitted.

Each year entry also carries:
- exact source provenance (`content_hash` as the builder records it: bare hex)
- archived and eligible version counts
- the builder coverage block

Top-level flags:
- `local_diagnostic: true`
- `publication_permitted: false`
- `complete_coverage_claimed: false`
- `network_collection_performed: false`
- `archive_modified: false`
- a `boundaries` list

This report is not a new public artifact or schema.

## Verification (actual results)

- `pytest tests/test_career_archive_admission.py tests/test_player_career_archive.py tests/test_player_career.py` → **44 passed** (initial run; see the review-fix section for the current 48).
- `ruff check` and `ruff format` on the two new files → clean (format was applied).
- The tests cover:
  - empty archive
  - future-only snapshot (no leak)
  - valid fixture with exact provenance
  - missing core, alone and next to a valid version
  - content-hash tamper that blocks only its year
  - orphan file that blocks all years
  - conflicting versions
  - partial rejections
  - policy expiry at a 2026-12-10 cutoff
  - multiple years with mixed validity, ordered and deterministic
  - invalid years, patch, season and naive cutoff
  - CLI overwrite refusal
  - sockets patched to raise
- Fixture clock: 2026-11-18, inside the 2026-11-03 + 30-day policy window.

Offline smoke run against the local archive (`--cutoff 2026-11-18T12:00:00+00:00`), with inspection issues = 0:

| Year | Status | Eligible versions | Accepted games | Rejected logical games | Rejections |
|---|---|---|---|---|---|
| 2022 | USABLE_WITH_REJECTIONS | 1 | 11804 | 715 | MISSING_STABLE_ID 355, SEASON_MISMATCH 346, INCONSISTENT_GAME 9, INVALID_CHAMPIONS 5 |
| 2026 | USABLE_WITH_REJECTIONS | 5 | 8581 | 1386 | MISSING_STABLE_ID 727, CONFLICTING_GAME 495, SEASON_MISMATCH 164 |

All other years are NOT_DOWNLOADED.

## Review fix: output inside the archive (Codex independent review)

Defect: `--output` pointing inside `--archive-dir` wrote a new file into the source archive, while the report claimed `archive_modified: false`. My own CLI test had this mistake too: it used `tmp_path` as both the archive and the output parent.

Fix: added `output_inside_archive()`, and the CLI now calls `parser.error` before creating any directory or file.

New tests in `tests/test_career_archive_admission.py`. Each one compares a byte-level snapshot of the archive tree before and after:
- inside the root
- inside the source directory
- a nested directory that doesn't exist yet (`mkdir` must not happen)
- an `other/../archive/...` spelling
- the root itself
- an upper-case path variant on Windows
- an `--archive-dir` spelled with `..`
- a link pointing into the archive, in both directions: output through the link, and archive-dir given as the link. This uses a symlink, or a directory junction on unprivileged Windows. It ran here as a junction.
- a sibling directory with a shared name prefix, which is allowed

The original CLI test now uses separate archive and report directories.

Results:
- `pytest tests/test_career_archive_admission.py tests/test_career_archive_admission_review.py tests/test_player_career_archive.py tests/test_player_career.py` → **48 passed**, 0 skipped. This includes the untouched independent review test.
- `ruff check` and `ruff format --check` → clean on the touched files and the review test.

Remaining boundary: there is still a gap between the final check and `open("x")` (a check-then-use race). If another local process swaps a parent directory for a link in that gap, the check can't catch it. Closing it fully would need `O_NOFOLLOW`/handle-relative opens, which Windows does not support portably. Hard links can't be created to files that don't exist yet, so they are not a way in.

## Limitations / notes for review

- Policy is evaluated at the cutoff as well as at each retrieval time; the existing wrapper only checks retrieval time. This is stricter. When the review window expires, any cutoff after 2026-12-03 makes every archived year BLOCKED_POLICY until the registry review is renewed.
- Blocking every year on an unattributable issue (such as an orphan file) is deliberately conservative.
- To map issues to years, the audit builds a stub `ArchivedSnapshot` so it can reuse `archive_for_year`. This is read-only, but it does re-parse issue metadata JSON outside `SnapshotArchive`.
- Memory use is bounded per year: one year's versions are read at a time, but every version of that year is held in memory together.
- 2026 shows 495 CONFLICTING_GAME across its 5 versions. That is the expected result of in-season revisions and poisoning, and it is not corruption. It does mean that across the current-season versions, revised games are excluded instead of taking the newest version.
- USABLE means admissible input only. It does not mean whole-year completeness or permission to publish.
