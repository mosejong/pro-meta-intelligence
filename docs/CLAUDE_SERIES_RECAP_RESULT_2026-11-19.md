# 피어리스 여러 세트 복기 · Claude 구현 결과 (2026-11-19)

상태: 구현과 로컬 검사를 마쳤고 Codex 독립 검토를 기다리는 중. 완료, 배포, 예측 효용은 주장하지 않는다. 커밋·푸시는 하지 않았다.

## 변경 파일

- NEW `web/app/draft-series-recap.ts`: 순수 집계 함수 `buildSeriesRecap({ report, games, current })`.
  - 완료 `games`를 순서대로 처리한다. 각 세트의 팀은 그 세트에 저장된 `blue_team_id`/`red_team_id`를 고정 report의 `opponent_prep.teams`에서 ID로 찾는다(정확히 1개). 이름이나 현재 보드로 다시 연결하지 않는다.
  - 선픽 진영은 `selections[0].side`로 정한다. 잠금은 앞에서 검증된 세트의 PICK만 쓴다(`fearlessLocks`). 밴은 잠금에 넣지 않는다.
  - 합법성과 근거는 기존 `buildDraftResultReport`에 맡긴다(재생, 피어리스, 챔피언 목록, 요약 검증). 표시하는 항목은 그 결과에 있는 `contested_claims`(양 팀 기록에 겹친 픽)와 `target_bans`(상대 기록에 있는 밴), 그리고 회수뿐이다.
  - 미지원으로 표시하는 사유: `INVALID_GAME`, `INCOMPLETE_GAME`, `UNKNOWN_TEAM`(없거나 중복된 팀), `PAIR_MISMATCH`(첫 세트와 다른 팀 조합). 한 세트가 실패하면 뒤 세트는 모두 `DEPENDS_ON_UNVERIFIED`가 되고 `total_locks`는 `null`(미확인)이 된다. 추정해서 채우지 않는다.
  - 진행 중인 `current`(20턴 미만)는 넣지 않는다. 20턴을 마친 `current`는 `current: true`로 한 번만 붙인다. 이미 완료된 세트와 같은 현재 세트는 픽 재사용이 되므로 불법으로 거부되고 두 번 세지 않는다.
  - 입력을 수정하지 않는다. 출력은 새로 만든 배열이라 입력과 참조를 공유하지 않는다.
- NEW `web/app/draft-series-recap-panel.tsx` + `web/app/draft-series-recap.css`: `<details>` 패널. 기본 접힘, 한국어, 읽기 전용(버튼·입력 없음). 세트마다 선픽 진영, 그 세트 전 잠금 수, 양 팀 픽·밴, 겹친 픽, 상대 기록에 있는 밴, 다음 세트부터 잠기는 픽을 보여준다. 자료가 없으면 "확인된 기록 없음" 또는 "미확인"으로 적는다. 승자, 승률, 가치 점수, 효과 예측, 자동 상대가 고른 이유는 표시하지 않는다.
- `web/app/draft-lab.tsx`: import 1줄, `recapCurrent` memo(20턴일 때만 당시 보드의 팀 ID와 selections를 묶음), 렌더 1줄을 추가했다. 패널은 `!room.active && (games.length > 0 || selections.length === 20)`일 때만 나온다. 저장 schema, 링크, 방, 명시 포지션, 추천 경로는 건드리지 않았다.
- NEW `web/tests/draft-series-recap.test.mjs`, NEW `web/tests/e2e/draft-series-recap.spec.mjs`. `web/package.json`의 `test` 목록에 단위 테스트를 추가했다. 기존 테스트와 CSS 룰은 바꾸지 않았다.

## 실제로 수행한 검사

| 검사 | 결과 |
|---|---|
| `node --test tests/draft-series-recap.test.mjs` | 8/8 통과 |
| `npm test` (build + 전체 단위 테스트) | 292/292 통과 |
| `npm run typecheck` | 오류 없음 |
| `npx eslint` (변경 파일 5개) | 경고·오류 없음 |
| `npm run build:pages` → `playwright test tests/e2e/draft-series-recap.spec.mjs` | desktop, mobile-width 2/2 통과 |
| 관련 기존 E2E: solo-practice, draft-studio, draft-practice-library, draft-share, studio-layout-review, draft-position-persistence | 41/41 통과 (desktop + mobile-width) |

단위 테스트(테스트 대역: `sampleReport`와 `SHARE_CHAMPIONS`로 만든 합성 세트, 실제 브라우저 아님)가 다루는 것: 3세트 잠금 누적(0/10/20, 합계 30), 밴 재사용 허용, 블루/레드 선픽 모두, 세트 사이 진영 교환 후에도 맞는 세트별 팀 ID와 이름, 19턴·0턴 현재 세트 제외, 완료된 현재 세트는 한 번만 포함, 중복된 현재 세트 거부, 앞 세트 픽 재사용 거부와 뒤 세트 의존 미확인, 손상 입력(null 세트, selections가 배열 아님, null 선택, 알 수 없는 챔피언, 진영 변조, 잘못된 선픽 값, 19턴), 알 수 없는 팀·빈 팀 ID·같은 팀·중복 팀 항목, 다른 팀 조합, `opponent_prep`이나 `priority_picks` 누락 시 미지원, 빈 요약은 0이 아닌 기록 없음, 입력 불변, 출력 분리, 예측 필드 없음.

실제 브라우저 E2E(Chrome, pages build preview, 수동 밴픽)가 다루는 것: 시작 시 패널 없음 → 1세트 완료 후 접힌 상태로 표시("방금 완료") → 피어리스 다음 세트 후에도 1세트 유지 → 진영 교환 뒤 1세트 팀이 바뀌지 않음 → 2세트 진행 중에는 1세트만 표시 → 2세트 완료 후 팀이 반대로 기록됨 → IndexedDB 저장을 확인한 뒤 새로고침해도 같은 기록 → 이전 세트 수정 후 2세트가 현재 완료로 한 번만 표시되고 팀 유지 → 펼친 뒤 조작 요소 0개, 금지 문구 없음, 미지원 상태 없음, 페이지와 패널 모두 가로 넘침 없음(1440px, 390px).

## Codex 독립 검토 반영 (2026-11-19)

- Codex가 `web/tests/draft-series-recap-review.test.mjs`를 추가했다. 이 파일은 수정하지 않았다. 실제 `public/feed/current.json` 기준 7개 상대 × 양 선픽 × 세트마다 진영을 바꾼 3세트는 통과했다. 그러나 report 팀 목록에 `null` 행이 추가되면 `buildDraftResultReport`에서 TypeError가 나고 UNSUPPORTED가 되지 않았다.
- 수정: `draft-series-recap.ts`는 결과 빌더를 부르기 전에 `opponent_prep.teams`의 모든 행을 검사한다. 행은 배열이 아닌 객체이고 `team_id`가 문자열이어야 한다. 하나라도 어긋나면 첫 세트를 새 사유 `INVALID_REPORT`로 미지원 처리하고, 뒤 세트는 `DEPENDS_ON_UNVERIFIED`, `total_locks`는 `null`이 된다. `draft-result-report.ts`와 선택·추천 알고리즘은 바꾸지 않았다. 패널에는 새 사유를 위한 한국어 문구 한 줄만 추가했다(사유 표가 모든 사유를 다뤄야 typecheck를 통과한다).
- 내 단위 테스트에 `null`, 숫자, 문자열, 배열, `{}`, 숫자 `team_id` 행 사례를 추가했다. 검토 파일은 `npm test` 목록에 추가했다.
- E2E에 펼친 패널 캡처(`series-recap-open.png`, desktop, mobile-width)를 추가했다. `web/test-results/` 아래에 있다. 모바일 캡처 중간에 studio 탭 막대가 보이는 것은 요소 캡처 중 고정 헤더가 함께 찍힌 것이다. 가로 넘침 검사는 통과했다.

재검사 (이번 수정 후 실제로 실행한 것만):

| 검사 | 결과 |
|---|---|
| `node --test tests/draft-series-recap.test.mjs tests/draft-series-recap-review.test.mjs` | 11/11 통과 (검토 파일 2개 포함) |
| `npm run typecheck` | 오류 없음 |
| `npx eslint` (recap 관련 파일 5개) | 경고·오류 없음 |
| `npm run build:pages` → `playwright test tests/e2e/draft-series-recap.spec.mjs` | desktop, mobile-width 2/2 통과 |

이번에는 전체 `npm test`와 기존 41개 E2E를 다시 돌리지 않았다. 위 표의 292/292와 41/41은 이 수정 전 결과다. 이번 수정은 recap 파일 안에서만 이루어졌다.

## 한계

- 방 모드에서는 패널을 숨긴다. 방 E2E(`test:room:e2e`)는 실행하지 않았다.
- 보관함 열기와 공유 링크 수락은 `restoreSession`을 통해 `games`를 그대로 넣는다. 새로고침과 같은 경로라서 E2E로 따로 확인하지 않았다.
- 표시하는 근거는 현재 고정 report의 우선 픽 요약 범위까지다. 세트별 당시 report를 따로 보관하지 않으므로, 모든 세트를 같은 `seriesReport`로 다시 평가한다(기존 세트 흐름과 같다).
- 자동 상대의 실제 선택 이유나 이력은 다루지 않는다. 승패·승률 예측이 아니다.
- Codex 독립 검토 전이다.
