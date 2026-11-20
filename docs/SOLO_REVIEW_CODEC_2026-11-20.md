# Solo review sidecar codec: stage 1 (pure, 2026-11-20)

Task: `docs/CLAUDE_SOLO_REVIEW_CODEC_TASK_2026-11-20.md`. Design: `docs/LOCAL_REVIEW_RETENTION_DESIGN_2026-11-20.md`, with corrections applied in sections 4, 5 and 8.
Claude implemented this. Codex verifies it independently. **There is no storage or UI wiring, and app behaviour is unchanged.** Nothing imports the module yet.

## Files
- NEW `web/app/solo-review-retention.ts`: the pure codec. It has no storage, hashing, crypto, network or UI imports, and it does not rerun suggest/explain.
- NEW `web/tests/solo-review-retention.test.mjs`.
- `web/package.json`: one test path, `tests/solo-review-retention.test.mjs`, inserted with single spaces between `solo-draft-history-text` and `draft-room-persistence`.
- The design doc, amended with the listed corrections only.

## Exact API
```ts
SOLO_REVIEW_SCHEMA = "solo-review-retention"; SOLO_REVIEW_VERSION = 1;
MAX_SOLO_REVIEW_BYTES = 65536 /* UTF-8 */; MAX_SOLO_REVIEW_RECORDS = 20; MAX_SOLO_REVIEW_ALTERNATIVES = 2;

serializeSoloReview(scenarioSha: unknown, manualSide: unknown, records: unknown)
  : { ok: true; text: string }
  | { ok: false; reason: "EMPTY" | "BAD_SHA" | "BAD_SIDE" | "BAD_RECORDS" | "TOO_LARGE" }

parseSoloReview(input: unknown, session: DraftSession, scenarioSha: unknown)
  : { ok: true; manualSide: "BLUE" | "RED"; records: readonly SoloAutoRecord[] /* fresh, deep-frozen */ }
  | { ok: false; reason: "NOT_TEXT" | "TOO_LARGE" | "INVALID_JSON" | "BAD_FORMAT" | "BAD_SHA" | "SHA_MISMATCH"
      | "BAD_SESSION" | "BAD_RECORDS" | "CONTEXT_MISMATCH" | "BOARD_MISMATCH" | "EXPLANATION_MISMATCH" }
```
- Both functions are wrapped in try/catch and never throw. An unexpected exception maps to `BAD_RECORDS`.
- `EMPTY` means "no sidecar": the caller deletes the key.
- On the parse side, any failure means "drop the review only". The board parse is untouched.
- This supersedes the design doc's `(64 KiB cap → null)` shorthand in section 6.

Text format (canonical key order, built from the validated copies, never by stringifying the input):
`{"schema","version","scenario_sha256","manual_side","records":[{turn,champion_id,reason,prefix,context,explanation}]}`.
The record fields are exactly those of `SoloAutoRecord`, `SoloDraftExplanation` and `SoloDraftExplainedChoice`. Nothing is truncated or renamed.

## Rules (all-or-nothing)
- **SHA:** the supplied value and the stored value must both match `^[0-9a-f]{64}$`. They are compared as full strings for exact equality. The SHA binds board-text equality only; it says nothing about who acted.
- **Size:**
  - The UTF-8 bytes of the whole text must be ≤ 65536, measured with `TextEncoder`. A cheap pre-check rejects input whose string length is greater than 65536 (a length that large cannot fit the byte limit).
  - Serialize checks the bytes of its own output.
  - Leading and trailing JSON whitespace counts toward the limit.
- **Shape:**
  - Every level must have exactly the expected keys. Values must be own, enumerable data properties: no getters, no symbol keys, no extra or missing keys. This rejects `__proto__` and `constructor` as unknown keys.
  - The prototype must be `Object.prototype` or `null`.
  - Arrays must be dense plain arrays with no extra properties.
- **Records:**
  - 1–20 records, and `turn` must be a safe integer from 1 to 20.
  - `champion_id` must be an exact canonical ID from `SHARE_CHAMPIONS`, which is what the generator emits. Case variants and unknown IDs are rejected.
  - `prefix.length` must equal `turn - 1`, and each prefix entry must be a non-empty string of ≤ 80 characters (the same limit as the session parser). The prefix is then matched exactly against the board.
  - `reason` and `record_team` must be non-empty and contain no C0/DEL control characters.
  - `context` must be a non-empty string with **no fixed cap**: it is nested serialized JSON that grows with Fearless locks and basis. It must equal the context derived from the session exactly.
- **Explanation** (`null` is valid):
  - Exact keys.
  - `kind` is BAN or PICK; `side` is BLUE or RED.
  - `record_scope` must be OPPOSING_TEAM for BAN and ACTING_TEAM for PICK.
  - `season_evidence` must be a boolean.
  - `explanation.turn` must equal `turn`.
  - `selected.champion_id` must equal `champion_id`, and `selected.reason` must equal `reason`. Draft-lab takes both from the same `select(new Set())` call.
- **Choices:**
  - BAN choices have exactly `champion_id, reason, source, inferred_roles, evidence`. PICK choices have the same keys plus `role_supported` (boolean), matching `finish()`.
  - `source` must be one of the 4 enum values; `evidence` must be one of the 6.
  - Source/evidence pairs must be ones that `evidenceOf` can produce:

    | source | evidence |
    |---|---|
    | FALLBACK | FALLBACK |
    | PLAYER_SEASON (PICK only) | PLAYER_SEASON |
    | RADAR | RADAR_META or RADAR_FRAME |
    | TEAM_RECORD on a BAN | TEAM_PRIORITY |
    | TEAM_RECORD on a PICK | TEAM_PRIORITY or PLAYER_CURRENT |

  - PLAYER_SEASON evidence anywhere requires `season_evidence: true`.
  - `inferred_roles` must be `[]` for BAN. For PICK it holds unique `ROSTER_ROLES` values. `ADC` is rejected: the producer maps it to BOTTOM. The design doc's ROLE_TEXT list, which includes ADC, describes display only.
  - At most 2 alternatives, and all champion IDs across selected and alternatives must be distinct.
- **Order:** strictly increasing turns, and one context for all records. Each earlier entry must sit on every later entry's prefix (the same relation as `appendSoloAutoHistory`). Violations are rejected, not sorted.
- **Board** (parse only):
  - Teams are found by `session.blueTeamId`/`redTeamId` in `session.report.opponent_prep.teams`. If either is missing or they are the same team, the result is `BAD_SESSION`.
  - The expected context is `soloHistoryContext(soloAutoContext(blueId, redId, firstPickSide, saved manual_side, fearlessLocks(games)), basisKey(rosterBasis(session.report))`, the same derivation as `draft-lab.tsx:327,331`.
  - Each record must pass `soloAutoRecordMatches(record, session.selections, expected)`.
  - The chosen board turn's side must differ from `manual_side`.
  - When the explanation is present, its kind and side must equal the board turn's, and `record_team` must equal `target.team_name || target.team_id`. The target is the opposing team for BAN and the acting team for PICK.

## Tests (written, NOT run)
The tests use the real `public/feed/current.json`, real season history, real suggest/explain with draft-lab's record shape, real append/prune, and real `serializeDraftScenario` → `parseDraftSession`.

- **Roundtrip matrix:**
  - Season null or real × manual BLUE/RED × first pick BLUE/RED; each case is a full game with 10 records.
  - Checks: deep-equal roundtrip, deep freeze, fresh objects, no mutation of inputs or session, real `record_team`, and the TEAM_PRIORITY shape.
- **RADAR_META shape (SYNTHETIC fixture, deterministic):**
  - The current real feed has **zero** `eligible_for_review` entries, so the real matrix cannot reach this shape.
  - The fixture clones the real report and sets the existing boolean `eligible_for_review` to `true` on its existing entries. It asserts there are at least 10 distinct canonical entries.
  - It also clears both teams' `priority_picks` and `player_profiles`, so no competing team or player evidence exists.
  - The unchanged suggest/explain rules then produce `source: RADAR` with `evidence: RADAR_META`. The test checks that for manual BLUE and RED, then checks the roundtrip and deep freeze. No output or evidence is edited by hand.
  - This tests codec shape coverage only. It is **not** evidence of current meta quality or eligibility.
  - It replaces the earlier matrix-wide RADAR_META assertion and the earlier fixture that assumed the feed had eligible entries. Both failed in Codex runs.
- **Other real boards:**
  - A fallback-only report, with every choice FALLBACK.
  - A partial board of 7 turns.
  - A Fearless second game, where the locks appear in the context.
  - `null` explanations.
- **Serialize:**
  - EMPTY, BAD_SHA and BAD_SIDE.
  - Hostile values: getter, Proxy traps, sparse array, extra array property, foreign prototype, symbol, `constructor` and extra keys, 21 records.
  - Unsorted, duplicate and mixed-context records.
- **Bounds:**
  - 20 structural records serialize, but parse rejects them with BOARD_MISMATCH because they include manual turns. 21 records are rejected.
  - Serialize returns TOO_LARGE above the limit.
  - Text of exactly 65536 bytes is accepted, and 65537 bytes is rejected even when the string length is ≤ 65536.
- **Envelope:** NOT_TEXT, INVALID_JSON, exact keys, raw-text `__proto__`/`constructor`, schema/version/side, SHA format, SHA mismatch and a one-character SHA difference.
- **Records and choices:** about 40 rejecting mutations (keys, enums, IDs, roles, booleans, scope, source/evidence, alternatives, prototype keys), plus 5 real-shaped variants that must be accepted.
- **Context:** first pick, swapped teams, games/locks, patch, cutoff, fixture_only, source_versions, flipped saved manual side and a forged context each give CONTEXT_MISMATCH. Missing teams, null session and missing prep give BAD_SESSION. A throwing session getter returns a failure instead of throwing.
- **Board:**
  - A shorter board, prefix, selected champion, turn and a manual-side turn each give BOARD_MISMATCH.
  - Kind, side and team each give EXPLANATION_MISMATCH.
  - Unsorted, duplicate and inconsistent prefixes give BAD_RECORDS.
- **Source guard:** no storage, crypto, fetch or suggest/explain usage, and `DraftSession` is imported as a type only.

## Unrun checks (for Codex)
- `node --test tests/solo-review-retention.test.mjs`, using the repo runner with vite SSR.
- `npm run typecheck`, the manifest-regression test (`unit-test-runner.test.mjs`) and lint.
- Assumptions that could fail at runtime:
  - The real report has at least 10 distinct canonical entries, which the test asserts. Before the first opponent pick at most 7 champions are used, so a legal synthetic-eligible meta champion remains.
  - `parseDraftSession` accepts the fallback report (empty `entries`, `priority_picks` and `player_profiles`).

## Risks and limits
- **Old-build aliasing:** the SHA binds board equality, not who acted. An old-build tab that writes a byte-identical board after a manual re-selection can still alias the sidecar, and stage 1 cannot solve this. No universal no-resurrection claim is made across old builds. Storage integration must scope its claims to same-version code and clear the sidecar on **every** legacy writer of `current` in that code.
- **Storage fallback:** "board save no less reliable" is not proven or tested. See the corrected design section 5.
- **Size in long series:** the context is repeated in every record. A very long Fearless series with many locks could exceed 64 KiB at 10 records. Serialize then returns `TOO_LARGE`, and the review is simply not retained, while the board is unaffected. The size has been estimated, not measured.
- **Coupling to generator invariants:** if the generator changes (new source, evidence mapping, role set, or reason source), old sidecars fail closed and are dropped. Any generator change must update this codec in the same change.
- **Trust:** a valid parse is the user's own local practice notes, forgeable by anyone with device access. It is never authentic AI output or observed evidence.
- **Stale comment:** the `solo-draft-explanation.tsx:7` comment ("only an explicit plain-text copy…") is still stale. It is not owned here and is left for the integration task.

## Codex independent verification (actual execution)
Related33/33 passed, including one independent real automatic-turn test binding source side, board prefix and exact supplied SHA, checking fresh frozen nested records and unchanged original scenario serialization.
The first fixture assumed real feed review eligibility; actual feed has none. Same Claude corrected this to a clearly SYNTHETIC eligible input passed through unchanged real selector/explainer, not fabricated output. It proves format coverage, not current meta quality.
A lint failure (control-regex) was returned to same Claude and replaced with equivalent character-code checks without rule suppression. Final affected18/18 + typecheck + changed-file lint pass after that edit.
Two earlier error_max_turns stops were local turn caps, not service quota errors. Final same-session lint-fix result completed successfully.
No UI/storage wiring, so no browser rebuild/full-suite rerun is claimed. Prior fullweb526 remains earlier evidence. No source collection/release.
