# 모델 자원 흐름 (지금까지) — 2026-11-20

Task: `docs/CLAUDE_EXPERIMENT_RESOURCE_HISTORY_TASK_2026-11-20.md`. Implemented by Claude (Opus 5.5); Codex verifies (tests/lint/typecheck/browser/E2E not run by Claude).

## What it is
A collapsed `details` "지금까지의 모델 자원 흐름" under the current state cards of the assumption replay.
Two-line SVG of both teams' **model resource** (not real gold) from minute 0 to the currently shown replay
minute, plus a nested collapsed "분별 값 보기" table with exact values. Display only: it reads the fixed run.

## Files
- `web/app/experiment-resource-history.ts` — pure helper.
  - `resourceHistory(run, shownMinute)` → `{ shownMinute, teams, points, minGold, maxGold } | null`.
    Each point is `replayFrame(run, minute).states[core].gold` for minute 0..shown (≤ MAX_MINUTE+1 frames).
    No copy of the resource rule, no `simulateManager` / `buildExperimentRun` / batch call.
  - Shown-minute normalisation = replayFrame's (floor, clamp 0..endMinute, non-finite → 0); non-number → 0.
  - Refuses (null): endMinute not integer in 0..MAX_MINUTE, events not an array, missing/invalid team_a/team_b,
    any non-finite resource value.
  - Output never contains winner, reason, completion flag, endMinute or any value after the shown minute.
    Fresh objects; the run is never mutated.
  - Team labels from `run.teams` only (name at run time, core mapping by source ID). If both names are equal,
    label adds `(실행 당시 블루/레드)`; raw IDs never shown.
  - `resourceChartGeometry(history)` → finite coordinates. x spans 0..shown only (minute 0 → single point at
    the left edge); y spans shown min..max only; flat range → mid line with one tick. No division by zero.
- `web/app/experiment-resource-history-panel.tsx` — `ExperimentResourceHistoryPanel({ run, shownMinute })`.
  SVG `role="img"` with `useId` title/desc, solid (team_a, circle) vs dashed (team_b, square) + text legend,
  ko-KR number format, table in horizontal-scroll wrapper. No timer, state, storage or server.
- `web/app/experiment-replay-panel.tsx` — one import + `<ExperimentResourceHistoryPanel run={run} shownMinute={frame.minute} />`
  after the state cards. Rendered only when a page-made run exists; receives no input-field/team-selection data,
  so editing assumptions/seed or comparison/link actions cannot change it. Play/step/seek/rewind/new run update it
  through the existing `frame.minute`.
- `web/app/experiment-replay-panel.css` — minimal `.experiment-resource-history*` rules.
- `web/tests/experiment-resource-history.test.mjs` (+ `web/package.json` test list).

## Tests (written, not run)
replayFrame gold equality at 0/middle/end/rewind on a real `buildExperimentRun` run and pure fixtures; future
event/winner/end/state probes leave earlier output and SSR identical; normalisation and refusal; input/return
isolation; same-name labels; side-reversed real run keeps core↔team mapping; geometry finite at 0 / equal / flat;
SSR collapsed, role/title/desc IDs, model-scope wording, no minute label > shown, no future values, no outcome text.

## Remaining risks / for Codex
- Not executed: unit tests, typecheck, lint, browser, mobile overflow. Codex adds PC/mobile seek/rewind,
  input-change invariance and new-run replacement E2E.
- Table wrapper scrolls horizontally but is not keyboard-focusable (no `tabIndex`, avoiding jsx-a11y
  noninteractive-tabindex); check axe `scrollable-region-focusable` if long team names make it scroll.
- Line colours (#8fb8e8 / #f0d6ae) on the studio dark background are assumed readable; verify contrast.
- `useId` IDs are assumed stable between SSR renders (the probe test compares two separate renders).

## Codex 독립 검증 완료 — 2026-11-20

Claude구현과같은세션621abd0c-e1d3-4baa-b5c6-355742f23438의CSS수정두건모두 completed/is_error=false.
Codex는제품소스수정없이별도 tests/e2e/experiment-resource-history-review.spec.mjs를작성했다.

- 신규/기존프레임/사건이동 관련23개통과. TypeScript·변경lint·Pages계약5개통과.
- 첫PC/모바일검사는summary 실제높이40px(요구44px)에서실패했다. 기존details기본규칙의
  specificity충돌이원인이었고Claude가이기능의두summary선택자만강화해수정했다. 기준을낮추지않았다.
- 수정후PC/모바일각1개통과:0·1·2·3·종료·되감기의행수와현재gold값, 가정/시드입력편집에도기존그래프불변,
  새실행0분으로교체·기준A실행1유지·페이지가로넘침없음·미래결과숨김을확인했다.
- 그시점 npm test **507/507 통과**(82.38초), outputs/web-resource-history-integration-20261120.log.
- 실제캡처에서범례도같은CSS충돌로의도한flex대신grid가적용된것을찾아Claude가범례두규칙만고쳤다.
  JavaScript/TS/엔진은바뀌지않았다. 최종Pages빌드·lint·PC/모바일각1개를다시확인해총2개최종통과,
  computed display:flex와44px도검사했다. 단순CSS후전체507을반복실행하지는않았다.
- 최종모바일캡처 outputs/model-resource-history-mobile-20261120.png를확인했다.
  첫범례캡처와최종이미지구분, 최종값은같고범례만정상가로배치되었다.

이자료는실제골드/실전승률/선수효과가아닌가정모델의내부자원이다. 이미계산된run의replayFrame을
읽어그린것이며모델을추가실행한것이아니다. x/y축/표/접근성설명모두현재재생시각까지만사용한다.
실제휴대폰·스크린리더·색대비정량감사와길게스크롤되는표의키보드조작전체는검증하지않았다.
신규chart라이브러리/데이터수집/원본변경/API/계정/서버/학습/제품push/merge/deploy 없음.
