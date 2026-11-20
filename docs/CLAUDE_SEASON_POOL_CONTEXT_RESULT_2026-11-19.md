# Season pool context — result (2026-11-19, Claude Opus 5.5)

Read-only link between a selected past-season card's observed champions and the live draft (bans / picks / earlier-game picks). No recommendation score, win rate, AI choice logic, assumption engine or click-to-pick changes.

## Implemented

### `web/app/season-pool-context.ts` (new)
- `seasonPoolContext(card, selections, previousPicks, focusChampionId?)` → `{ top, remaining, focus }`.
  - Reuses `poolChampionState`, `championKey`, `PoolSelection`, `PoolChampionState` from `player-pool-evidence.ts` (unchanged).
  - Alias rows (same `championKey`) are collapsed to the single largest row (tie → smaller champion ID); counts are **never summed**.
  - `top`: up to 5, games desc, champion ID ascending (code-point compare, locale-independent) on ties.
  - `remaining`: up to 3 `AVAILABLE` rows from the whole card in the same order (refills past the top 5).
  - `focus`: `null` when no focus champion; otherwise `OBSERVED` + the row, or `NOT_OBSERVED` + `row: null`.
  - Earlier-game bans are not in `previousPicks` and are not added as locks.
  - Inputs are not mutated; all returned rows are fresh copies.
- `seasonPoolStateLabel`: 이번 판 밴 / 이번 판 픽 / 이전 세트 잠금 / 이번 밴픽 미사용.

### `web/app/season-lineup-panel.tsx`
- New optional props `selections`, `previousPicks`, `focusChampionId` (stable empty defaults).
- Selected-player card: each top-5 entry now reads `챔프 N회(상태)`; an extra small line `이번 밴픽 미사용 관측 기록: … | 없음`; when a focus champion is set, `챔프: 이 선수·역할·YYYY 시즌에서 X회 관측` or `… 시즌 관측 기록 없음`.
- A one-time note in the catalog-basis paragraph: 밴픽 상태 표시는 챔피언 리워크·현재 메타 차이를 보정한 추천이 아닙니다.
- No catalog / unresolved ref: existing 미확인 messages unchanged (context is computed only when `selected` resolves). The current-player evidence panel (`PlayerPoolPanel`) is untouched and not mixed.

### `web/app/roster-workshop.tsx`
- Only passes the already-received `selections` / `previousPicks` / `focusChampionId` to `SeasonLineupPanel`.

### `web/tests/season-pool-context.test.mjs` (new)
Covers: sort determinism (incl. input order independence), ban / pick / fearless states, remaining refill past top 5, remaining empty → `[]`, earlier bans not locking, alias max-row (no summation; Wukong/MonkeyKing, Kai'Sa/Kaisa), focus null vs `""` vs not-observed vs observed (case-insensitive), input immutability and fresh rows, label wording.

## Not verified
- **The new test file was not run**: the `node --test tests/season-pool-context.test.mjs` command was denied approval (Bash and PowerShell); per instructions it was not retried.
- No typecheck, lint, full test, build or browser check was run (out of scope / not permitted).
- UI rendering of the new lines was not visually checked.


## 과거 선수 밴픽 관측 연결 확인

Codex 관련16개·타입·변경lint·실제PC1개통과. 현재판마오카이밴후2015MaRin을선택하면마오카이30회(이번판밴),럼블28회(이번밴픽미사용)표시및남은관측에서마오카이제외를확인했다. 읽기전용이며AI점수/선택/승률/가정엔진입력불변. 캡처outputs/marin-2015-pool-20261119.png보존. 팀preset모바일폭1개도통과.
