# Annual career archive admission · Claude task

Implement with Opus 5.5 medium; Codex reviews. No agents, provider requests, browsing, git operations, deployment, package install or current UI edits.

Goal: prepare the next annual data acceptance step while the source-wide cooldown is active. Reuse existing verified archive and `build_player_career_history`, never duplicate game validation rules.

Read `ops/player_career_archive.py`, `src/pro_meta_intelligence/opponent/player_career.py`, existing annual archive tests. Add a small offline CLI `ops/audit_player_career_archive.py` and NEW `tests/test_career_archive_admission.py`. Write result doc `docs/CLAUDE_CAREER_ADMISSION_RESULT_2026-11-18.md`.

CLI: `--archive-dir`, aware `--cutoff` (default real UTC), repeatable `--year` (default registered 2014..current reference season), repeatable `--player-id` (optional exact source ID only), `--reference-season`/`--reference-patch`, `--output` refuses overwrite. No fetch option. Read manifest via existing adapter/registry. Reject unsupported years, naive cutoff, invalid season/patch; never silently invent IDs or join names.

For each requested year distinguish NOT_DOWNLOADED, NOT_AVAILABLE_AT_CUTOFF, BLOCKED_POLICY/INTEGRITY, INVALID_ARCHIVE (no validated provenance/core), NO_ACCEPTED_GAMES, USABLE_WITH_REJECTIONS, USABLE. Reuse archive inspection and ALL eligible versions with existing conflict poisoning, hash/season/date/player validation. Include exact source provenance, accepted/rejected coverage, explicit unknown vs observed for requested player IDs, and counts/boundaries. Unsupported/missing IDs never become proof of retirement or zero skill. A successful audit is not whole-year complete coverage or public publication permission. Do not emit raw rows.

Do not label a file usable solely because it exists or because builder silently excluded bad input. Year-level policy/availability/integrity checks fail closed. Keep unrelated valid annual files independently auditable where possible. Output aggregate report is a local diagnostic, not new public artifact/schema. Deterministic ordering; do not overwrite reports or modify archives. No changes to core builder unless exact blocker is reported first.

Tests: empty archive, future-only snapshots, valid fixture, missing core, source/hash/integrity failure, conflicting versions, known/unseen player, multiple years with mixed validity, refusal overwrite, zero network. Use fixed fixture clocks inside existing policy window. Run focused pytest/ruff and report actual results/limitations. Avoid full raw CSV dumps or full repo scans.
