# 완성된 단일 A/B 비교 요약 복사 — 구현 기록 (2026-11-19)

구현: Claude Opus 5.5 · 검증/테스트 실행: Codex (미실행 상태로 인계)

## 범위
- 신규 `web/app/experiment-comparison-text.ts`: 순수 builder `buildExperimentComparisonText(baseline: unknown, candidate: unknown, shownMinute)`.
- 신규 `web/app/experiment-comparison-share-panel.tsx`: 'A/B 비교 요약 복사' 버튼.
- `web/app/experiment-comparison-panel.tsx`: 기준 A가 있을 때 details 안(비교 결과 아래, 배치 패널 위)에 share panel 한 줄 wiring.
- `web/app/experiment-comparison-panel.css`: `.experiment-comparison-share` (결과 요약 복사 스타일과 동일 톤).
- 신규 `web/tests/experiment-comparison-text.test.mjs`, `web/package.json` test 목록에 추가.
- 엔진·검증·저장·비교 규칙(`experiment-comparison.ts`, `experiment-replay.ts`, `simulation-*`) 변경 없음.

## Builder 규칙
- `trustedRun`으로 A/B 모두 검증 → 아니면 `UNTRUSTED` (구조 복사·JSON 왕복·상속 객체 포함).
- 같은 객체 또는 같은 runId(보관 clone vs 원본) → `SAME_RUN`.
- shownMinute가 유한수가 아니거나 B 종료 전 → `NOT_COMPLETE`.
- 숫자는 기존 `compareExperimentRuns(a, b, shownMinute)` 결과만 사용. 거부 시 `NOT_COMPARABLE` + 기존 refusal code 목록.
- 정합성 재확인(실패 시 전체 `INVALID_RESULT`, 0 대체 없음): 팀 2개·sourceId 순서 일치, 가정 −1~1 유한수, changed 플래그/changes/changeKind 일치, 상태 비음수 정수·기지 ≤100, delta = B−A, 종료 분·사유 유효, 종료 분 = 각 run.endMinute, NONE이면 모든 차이 0.
- 텍스트: `cleanField` 재사용(제어/양방향 문자 제거, 공백 정리, 40자 제한), 실패 시 `INVALID_TEXT`. cutoff ISO 검사. 총 2400자 초과 → `TOO_LONG`.
- 팀 대응은 source ID. 표시명은 B 이름, 같은 이름이면 `이름 (팀1)`/`이름 (팀2)`(source 순서). A 당시 이름이 다르면 '팀 이름 대응' 줄에 표시. raw 팀/선수 ID·evidence key·JSON 미출력.
- 포함 내용: '보관된 두 실행의 비교' 명시, 패치·자료 기준 시각·고정 시드·규칙(A·B 동일), 팀별 가정 A→B, 변경 없음/단일/다중 의미(다중은 한 가정 기여로 나누지 않음), 종료 A→B와 분 차이, 팀별 네 outcome 원값 A→B와 (B−A), 실제 승률·선수·챔피언·룬·아이템 효과 아님 경계 문구.
- 현재 입력(readyInput)을 받지 않으므로 입력이 바뀌어도 이미 유효한 A/B 요약은 같다.

## UI
- 기준 A가 있을 때만 버튼 표시. 유효·완료된 서로 다른 실행일 때만 활성, 아니면 짧은 거부 이유(`aria-describedby`, `useId`).
- 자동 복사 불가/실패 시 읽기전용 textarea(포커스 시 전체 선택). 클립보드 외 저장 없음.
- 비동기 무효화: copy state는 (A, B, B 종료) 묶음에 속함. A 교체/해제·새 B·종료 전 되감기·unmount 시 token 증가 → 늦게 끝난 promise 결과 무시. 종료를 떠났다 돌아와도 complete 변화로 token이 바뀌어 이전 promise 무효.

## 테스트 (작성만, 미실행)
- 실제 `buildExperimentRun` fixture로 SINGLE/NONE/MULTIPLE, 같은 표시명(팀1/팀2), 이름 변경 대응, 위험 문자·긴 이름, 거부(UNTRUSTED/SAME_RUN/NOT_COMPLETE·NaN·Infinity·문자열, SEED/EVIDENCE/TEAMS), 원본·비교 불변, SSR 활성/비활성/거부 문구, raw ID 미노출.
- 숫자는 `compareExperimentRuns` 결과와 대조(하드코딩 없음).
- Codex 몫: 실제 실행, typecheck/lint, 브라우저 async/race 검증.

## 미확인/주의
- `hostile`/`renamed` fixture는 snapshot의 팀 이름을 직접 바꾼다. `buildExperimentRun` 입력 검증이 이름을 거부하면 해당 테스트가 실패할 수 있음(기존 테스트가 patch/evidenceIdentity를 같은 방식으로 바꾸므로 통과 예상).
- 빈 이름 → `INVALID_TEXT` 경로와 `TOO_LONG` 경로는 이름 40자 제한 때문에 fixture로 도달하기 어려워 테스트하지 않음.
- 패널 SSR은 내부 state 때문에 기준 A를 둘 수 없어, 활성 상태는 share panel 직접 렌더로 확인.

## Codex 독립 검증 기록

Claude 세션 8cf22339-793e-4d2e-a0c5-8132d3adaa6d는 completed/is_error=false로 종료했다.
Codex는 제품 소스를 수정하지 않았고 독립 E2E 파일만 추가했다.

- 신규/기존 비교/단일 결과 요약 관련28개 통과.
- TypeScript, 변경 TSX/TS/단위/E2E lint 통과.
- Pages 빌드 및 계약5개 통과. 기존 500kB 번들 권고는 남는다.
- 실제 Chrome desktop2/mobile-width2, 총4개 통과. 예시로20개 밴픽/10명/역할 입력을 준비한 뒤
  명시 실행 A와 B를 만들어, 결과값 보존·복사 실패 대체글·입력란 수정에도 요약 불변·되감기 초기화·
  다른 시드 거부·새 실행 초기화·늦은 응답의 되감기/기준 교체 후 무효화를 확인했다.
- 모바일 캡처 outputs/ab-comparison-plain-summary-mobile-20261119.png 확인. 가로 넘침 없음.
  캡처 중간의 고정 탭은 긴 요소 캡처에 포함된 sticky 영역이며 실제 모바일 장치 검증은 아니다.
- 별도 Codex 검토 에이전트는 기존 다중 시드 결과 보관·copy 상태 범위를 읽고 결함을 찾지 못했다.
  별도 실행 증거가 아닌 코드 검토이며 기존 다중 시드 동작은 수정하지 않았다.

첫 전체 npm test는484중483통과/1실패. 기존 tests/draft-room-restart-review.test.mjs 파일 프로세스가
구체 오류 스택 없이 실패했다. 단독 재실행1개는 통과했고 원인은 미확인이다. 첫 실패를 삭제하거나
통과로 재분류하지 않는다. 변경 없이 전체 재실행 중이며 결과는 아래 후속 기록한다.
로그: outputs/web-ab-comparison-summary-integration-20261119.log.

fixture 이름 변경/긴 이름 경로는 실제 단위 검사로 통과했다. 빈 이름·2400자 초과 거부 분기는
독립 분기 도달 검증을 하지 않았으므로 해당 범위 전체를 입증한 것으로 쓰지 않는다.
실제 사람 효용·실전 승률 검증이 아니며 새 소스/원격 전송/배포는 없다.

### 전체 재실행 결과

변경 없이 실행한 두 번째 npm test는 **484/484 통과**(82.1초)했다.
로그 outputs/web-ab-comparison-summary-integration-repeat-20261119.log.
첫 단발 방 프로세스 실패의 원인은 미확인으로 남기며, 재실행 통과를 원인 수정으로 주장하지 않는다.
제품 코드의 추가 수정 없이 관련/실제 브라우저/전체 통합 확인을 마쳤다.
