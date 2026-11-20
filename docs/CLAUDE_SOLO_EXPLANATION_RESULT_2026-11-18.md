# Claude 작업 3 결과 · 자동 상대 선택 이유와 대안 (2026-11-18)

Base HEAD 88682258. 구현: Claude Opus 5.5. Codex 독립 검증은 아직 수행되지 않았음(본인 실행 아님).

## 변경 파일
- `web/app/solo-draft.ts` — 기존 본문을 private `soloContext(input)`로 추출. `select(excluded)`는 `available = !excluded.has(id) && legal(id)`만 바꾸며 replay/Fearless 검증(`legal`)·가중치·순서는 그대로. `suggestSoloDraftTurn(input)` = `select(∅)`. 신규 `explainSoloDraftTurn(input)`: `selected`(기존 제안 + `inferred_roles`), `alternatives`(최대 2, 앞 후보를 차례로 제외한 같은 규칙의 결과), `kind/side/turn`, `record_scope`(BAN=OPPOSING_TEAM, PICK=ACTING_TEAM), `record_team`, `season_received`. 점수/확률 신규 없음. fake lock 미사용.
- `web/app/solo-draft-explanation.tsx/.css` (신규) — `SoloDraftExplanationPanel`(기존 "마지막 상대 선택" 한 줄 + 접힌 `<details>`), `soloAutoContext`, `soloAutoRecordMatches`. 읽기 전용(버튼/입력 없음). FALLBACK·`role_supported=false` 표시, 시즌 미수신은 "사용 경험이 없다는 뜻이 아님"으로 표시, 추론 포지션은 사용자 지정 포지션이 아님을 명시. 대응·상성·승률 예측 아님 명시.
- `web/app/draft-lab.tsx` — `lastAuto`에 `prefix`(선택 직전 champion id들), `context`(팀 id·선픽·내 진영·이전 세트 잠금), `explanation` 추가. 설명은 600ms 타이머 콜백에서 자동 선택 1회당 1번, 같은 직전 입력으로 계산(렌더마다 계산 없음, 데이터 요청 없음, 저장 없음). 표시 조건은 현재 selections가 같은 prefix + 같은 turn/champion + 같은 context일 때만(race·되돌리기·세트/팀/진영 변경 시 숨김). 기존 `setLastAuto(null)` 경로 그대로. `explained.selected`가 `autoChoice`와 다르면 설명 생략.
- `web/tests/solo-draft-explanation.test.mjs` (신규), `web/tests/e2e/solo-draft-explanation.spec.mjs` (신규).
- v4 저장/공유/방/보관함 스키마, package.json, 기존 테스트 변경 없음.

## 실제 실행한 검사
- `tsc --noEmit --incremental false` (node 직접 실행): 통과.
- `node --test` 신규 + `solo-draft`, `solo-role-candidates`, `solo-fearless-series`, `solo-fearless-denial`: 22/22 통과.
  - 신규 테스트는 `git show 88682258:web/app/solo-draft.ts`를 vite 가상 모듈로 로드해 현재 `suggestSoloDraftTurn`과 deepEqual 비교(실제 피드, 양 내 진영 × 양 선픽 × 시즌 有/無 × 2세트 Fearless, 매 턴 + 잘못된 입력). git 불가 시 해당 비교는 skip으로 표시됨.
- `vite build --config vite.pages.config.ts` 후 Playwright(desktop + mobile-width): `solo-draft-explanation.spec.mjs` 4/4, 기존 `solo-practice.spec.mjs` 8/8 통과.
- npm 스크립트·git 명령은 권한 거부로 node 직접 호출로 대체. 전체 `npm test`/lint는 실행하지 않음.

## 실패/수정
- 첫 e2e 실행에서 내 spec의 "접힘 상태" 단언이 숨은 `<details>` 텍스트까지 읽어 실패 → 가시성 단언으로 수정 후 통과. 제품 코드 문제 아님.

## 후속 수정 (Codex 리뷰 반영)
Codex 리뷰: 제안 1680건 비교 일치. 근거 표시 관련 렌더 테스트 3건 실패와 추가 2건이 보고됨(`web/tests/solo-draft-explanation-review.test.mjs`, Codex 소유, 수정하지 않음).
- `solo-draft.ts`: 선택 경로(`select`)는 변경 없음. 설명 전용으로 다음을 추가.
  - 후보별 `evidence`: TEAM_PRIORITY / PLAYER_CURRENT / PLAYER_SEASON / RADAR_META / RADAR_FRAME / FALLBACK. 이미 내려진 선택을 기존 분기와 같은 집합(`priorityIds`, `metaSet`, `candidateById`)으로 분류만 함.
  - `season_received`(객체 truthiness)는 삭제. 대신 `season_evidence` = 선택기와 같은 `soloRoleCandidates` 결과에 시즌 후보가 하나 이상 있는지. 없으면 미확인으로 표시하며, 사용 0으로 표시하지 않음.
- 패널:
  - 줄 분리: "확인 대상"은 규칙이 조회하는 대상(팀·메타·시즌), "근거 범위"는 표시 후보를 실제로 만든 근거만. FALLBACK만 있으면 "사용할 수 있는 기록 없음".
  - 시즌 미확인 시 문구: "미수신·기준 불일치·선수 미일치 포함 … 사용 경험이 없다는 뜻이 아닙니다".
  - 추론 포지션은 기존 `champion-roles.ts`의 `roleLabel`(탑/정글/미드/바텀/서포터)로 표시.
- 내 테스트: `season_evidence`를 `soloRoleCandidates`의 시즌 후보 유무와 비교. 다음을 검증.
  - stale cutoff, 빈 players의 렌더
  - 호환 시즌일 때 근거 범위에 시즌이 표시되는지
  - FALLBACK일 때 근거 범위가 "사용할 수 있는 기록 없음"인지
  - 한글 포지션 표시

### 후속 실제 검사 (파이프 없이, 종료 상태로 확인)
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: 출력 없이 종료(통과).
- `node --test --test-reporter=spec`로 review(Codex) 5건 + 신규 + solo-draft, solo-role-candidates, solo-fearless-series, solo-fearless-denial을 실행: 27/27 통과, fail 0, skip 0.
  - 기준 커밋 88682258 대비 `suggestSoloDraftTurn` deepEqual 비교도 통과.
- 이번 후속에서는 빌드와 브라우저 테스트를 실행하지 않음(Codex 소유). 위 Playwright 결과는 최초 작업 당시의 것이며, 후속 문구 변경 후에는 다시 실행하지 않음. 기존 e2e spec이 확인하는 문구("N번째 차례(밴) 선택 직전 상태 기준", "상대 팀(")는 유지됨.

## 2차 후속 (접힌 요약 근거)
- 변경 파일: `web/app/solo-draft-explanation.tsx`만. `solo-draft.ts` 선택 경로와 `suggestSoloDraftTurn` 반환값·reason은 변경 없음.
- 접힌 `.solo-draft-last` 요약:
  - 설명이 있으면 `selected.evidence`에서 유도한 문구로 표시. 형식: "연습 픽/밴 · 근거: …. 실제 선택을 예측하지 않습니다."
  - 예: 현재 선수 기록만 있으면 "행동 팀(X) 현재 관측 선수의 공개 기록". 우선 픽 기록이라고 표시하지 않음.
  - FALLBACK은 대체 규칙 문구 그대로 표시.
  - PICK에서 `role_supported=false`이면 요약에도 "포지션 근거 부족: 조합 구성을 보장하지 않음"을 표시.
  - PLAYER_SEASON이면 "현재 패치의 강함을 뜻하지 않음"을 덧붙임.
  - 설명이 없을 때만 기존 reason을 표시.
- "확인 대상" 줄에서 "순서"를 삭제하고 "(조회 범위이며 선택 순서가 아님)"을 명시. 현재 관측 선수 기록도 조회 대상으로 표기. 첫 문장의 "규칙 순서 설명"은 "규칙 설명"으로 변경.
- 실제 검사:
  - `node node_modules/typescript/bin/tsc --noEmit --incremental false`: 출력 없이 종료(통과).
  - `node --test --test-reporter=spec tests/solo-draft-explanation-review.test.mjs`: 7/7 통과(Codex 파일에 7번째 테스트 포함).
  - 지시에 따라 그 외 Node 테스트, 빌드, 브라우저 테스트는 이번에 실행하지 않음.

## 미지원/한계
- 대안은 "같은 규칙의 다음 합법 후보"일 뿐 실제 팀의 차선책이 아님. BAN 단계엔 포지션 표시 없음.
- 설명은 이번 세트 메모리에만 있고 새로고침/불러오기 후 복원되지 않음(의도).
- `.tmp` 테스트 산출물(`test-results/`, pages 빌드 결과)이 생성되었을 수 있음 — 정리하지 않음.
