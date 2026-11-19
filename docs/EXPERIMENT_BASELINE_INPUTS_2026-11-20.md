# 기준 A의 가정값을 입력란에 불러오기 (2026-11-20, Claude 구현 / Codex 독립 검증 완료)

과제: docs/CLAUDE_EXPERIMENT_BASELINE_INPUTS_TASK_2026-11-20.md

## 무엇
기준 A가 있을 때 비교 패널에 명시 버튼 '기준 A의 가정값 불러오기'. A의 시드와 두 팀 3가정값 **텍스트만** 입력란에 채운다.
실행·재생 위치·기준 A·밴픽·로스터·역할·저장·URL 불변, 자동 실행 없음.

## 파일
- `web/app/experiment-baseline-inputs.ts` (신규, 순수) `planBaselineInputs(baseline, readyInput, blocked)`
  - 순서: `trustedRun` 아님 → UNTRUSTED, `blocked !== false` → BLOCKED, ready 없음 → NO_READY_INPUT,
    `sameSimulationInput(A.snapshot, ready)` false(예외 포함) 또는 source 순서 불일치 → CONTEXT_MISMATCH.
  - seedText=`String(A.seed)`, 각 값은 `plainDecimal`(입력 링크와 동일, -0→"0", 지수 표기 없음).
    `validateRunInputs`로 재판독해 seed·6값이 정확히 같지 않으면 BAD_VALUE.
  - 반환 `{ok, seedText, drafts}`(source ID 키)만 / 거부는 `{ok:false, reason, message}`만. 현재 입력란 값은 받지 않음.
- `web/app/experiment-comparison-panel.tsx`: optional props `blocked`(기본 true), `onLoadBaselineInputs`(없으면 비활성+사유).
  버튼은 baseline 있을 때만, 현재 실행이 A여도 허용. 클릭 시 현재 props로 재계획 후 callback, 기존 status 영역에 안내·포커스.
  비활성 사유는 `aria-describedby`로 연결된 짧은 hint.
- `web/app/experiment-replay-panel.tsx`: `applyLink` → `applyAssumptionInputs`로 이름만 변경(동작 동일: seedText 설정 + drafts 병합으로 다른 팀 entry 보존). 링크 패널과 비교 패널에 같은 setter, 비교 패널에 현재 `blocked` 전달.
- `web/app/experiment-comparison-panel.css`: `.experiment-replay .experiment-comparison-actions button.experiment-comparison-load` 44px.
- `web/tests/experiment-baseline-inputs.test.mjs` (신규), `web/package.json` 목록 추가.

## 미실행
명령/테스트/typecheck/브라우저 미실행(과제 규칙).

## 리스크
- 버튼 클릭 경로(state 안의 baseline)는 SSR로 재현 불가 → 클릭·포커스·필드 반영·cursor 불변은 Codex E2E 필요.
- `useId` 1개를 비교 패널에 추가(마크업 영향 없음).
- 패치만 다른 입력도 canonical key 차이로 CONTEXT_MISMATCH(의도: 링크 관문보다 엄격).

## Codex 독립 검증 결과
- 관련 단위 검사 30/30, typecheck 및 변경 파일 lint 통과.
- Pages 빌드와 계약 검사 5/5 통과. 기존 번들 크기 경고는 남아 있다.
- 실제 PC/모바일 조작 4/4 통과: A1 → B2 → A 입력만 불러오기 → 명시 실행3에서 A와 같은 결과.
- B 재생 중 불러와도 재생이 계속되며 기존 B 결과·기준 A·주소·로스터·localStorage·IndexedDB 연습 기록이 그대로임을 확인.
- 준비된 입력이라도 역할 배정이 A와 다르면 거부하고, 원상 복구 후에만 허용한다.
- 새 버튼 44px 이상과 모바일 가로 넘침 없음을 확인하고 모바일 캡처를 육안 검토했다.
- 최신 전체 웹 검사는 직전 6ccf9f01의 517/517이다. 이번 작은 변경에는 위 범위 검사를 했으며 전수 재실행으로 표시하지 않는다.
- Codex 제품 소스 수정 없음. 원격 게시·배포 없음.
- 캡처: outputs/baseline-inputs-loaded-mobile-20261120.png

## 추가 교차검토
다음 작업을 검토하던 동일 Claude 세션이 package.json 검사 목록에서 두 경로가 붙어 있는 결함을 발견했다.
직접 지정한 관련30개와 브라우저 검사는 영향을 받지 않는다. 동일 Claude가 누락된 공백만 수정했다.
Codex는 기존 unit-test-runner.test.mjs에 목록의 파일 존재·유일성·형식과 두 해당 파일 등록을 확인하는 독립 회귀 검사를 추가했다.
이 새 발견 때문에 앞서 생략한 전체 웹 검사를 다시 실행한다. 완료 결과는 아래에 기록한다.
독립 검토 에이전트의 정적 검토에서는 A 불러오기 맥락/상태 변경의 추가 결함을 찾지 못했다.

최종 npm test 전체 **526/526 통과**, 99.22초. 로그 outputs/web-baseline-inputs-integration-20261120.log. 독립 추가 검사 lint 통과.
