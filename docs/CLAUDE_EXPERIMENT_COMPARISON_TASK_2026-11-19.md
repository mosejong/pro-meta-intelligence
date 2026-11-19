# 가정 실험 A/B 비교 · Claude 구현

Opus 5.5 medium. Codex 독립 검토. 기존 제품/파일 재사용. 추가 에이전트/웹조회/수집/패키지/번역/커밋·푸시·배포 금지. 이 작업은 실제 경기 예측이나 선수/챔피언 효과 모델을 만들지 않는다.

## 기존 작업 대조 및 목표

기존 draft-comparison A/B는 밴픽·선수 관측 근거 비교다. 이번은 기존 `experiment-replay`의 **사용자 가정 실험** 두 실행을 비교한다. 기존 A/B를 재구현하지 말고 실험 패널의 접힌 보조 기능으로 추가한다. 기본 재생 흐름과 시뮬레이션 준비 gate를 유지한다.

현재 명시적으로 완료한 실행을 '이 실행을 비교 기준 A로 보관'해 메모리에 동결하고, 가정/재현 번호를 수정해 **명시 실행한 B**와 대조한다. 준비된 밴픽/로스터/역할/자료·ruleset·원본 팀 ID 쌍이 정확히 같고 **재현 번호도 같을 때만** 가정 차이를 비교한다. 재현 번호가 다르면 같은 조건이 아니라고 비교를 거부한다. B가 현재 입력과 달라진 기존 실행일 때는 기존 실행끼리 비교임을 표시한다. 저장된 A를 현재 입력·슬라이더·자료갱신으로 덮어쓰지 않는다.

가정 diff를 실제 source team ID + lane/tempo/teamfight별로 명시한다. 단일 변경/복수 변경/변경 없음으로 구분하고, '가정에 따른 모델 내부 차이'로만 표현한다. 동일 가정·seed는 차이0이어야 한다. 실전 승률, 선수 기여도, 인과 효과, 승리 추천이나 다회 seed win-rate를 만들지 않는다. 여러 seed 반복은 이번 범위가 아니다.

**미래 결과 비노출:** A 기준 지정/결과 비교는 현재 재생이 끝난 상태에서만 활성화한다. 재생이 끝나기 전에는 전체 결과/최종 승자/완료 시각 등을 비교표로 미리 보여주지 않는다. A 고정 후 새 B의 중간 재생/되감기/처음 상태에서 비교 결과를 숨기고, 끝난 B에서만 보여준다. 기준 내용 및 명시적 input diff는 결과를 노출하지 않는 범위에서 보여도 된다.

## 소유 파일/연결

읽기: experiment-replay.ts/panel/css/tests, simulation-scenario.ts sameSimulationInput, draft-comparison의 역할/근거 경계. engine/result 입력을 재사용한다.
쓰기: NEW `web/app/experiment-comparison.ts`, NEW `web/app/experiment-comparison-panel.tsx`/css, `web/app/experiment-replay-panel.tsx` 최소 연결, web/package.json 테스트목록만, NEW web/tests/experiment-comparison.test.mjs 및 NEW web/tests/e2e/experiment-comparison.spec.mjs, NEW docs/CLAUDE_EXPERIMENT_COMPARISON_RESULT_2026-11-19.md. 다른 core/scenario/recommendation/draft A/B/save schema/README/master docs 변경 금지.

순수 비교기는 동결 실행을 복사·검증하고 반환 참조를 입력과 분리한다. source ID를 기준으로 팀을 맞춰 진영표시 교환으로 잘못 비교하지 않는다. 비교 불가 조건과 이유를 명시하고 기존 실행/원본을 수정하지 않는다. 결과는 각 팀의 가상 자원/모델 킬/추상오브젝트/기지/종료 시각·종료 종류 정도로 제한하고 순위나 단일 가치 점수를 추가하지 않는다. 같은 사용자 입력이라고 판정하려고 이름/객체 순서만 비교하거나 팀 ID를 정규식으로 새롭게 제한하지 않는다. `sameSimulationInput`의 의미를 보존하며 가능한 계약을 재사용한다.

기준A 취소/바꾸기 명시 버튼, 기본 접힘. 메모리 전용, 새 파일/DB/공유/로그인 만들지 않는다. 일반인 한국어, 기존 톤·PC/모바일 가로넘침/키보드/focus 지원. 기준 해제는 현재 밴픽/실행/재생을 바꾸지 않는다.

## 검사/실행 제한

단위: 동일 실행 차이0, 한 가정만/여러 가정 diff, seed/ruleset/자료/로스터/역할/밴픽/팀 mismatch 거부, 동명이인/동일이름 팀 ID 처리, snapshot/반환값 불변, source ID 순서·진영 표시 안전성, inherited/malformed 입력 거부, 미완료 결과 비노출. 기존 raw number parser를 재구현하지 않는다.
신규 E2E **PC/모바일 합계 최대4개**: A 완료 후 고정→B 가정만 수정·실행→중간 비교 숨김→끝 비교→되감기 숨김→A 해제. native invalid decimal 회귀를 해치지 않는다. 기존 광범위 브라우저 반복 금지. 관련 단위/core/replay/타입/lint/Pages 및 신규 spec만 실행하고 실제 실행 보고서를 작성한다. Codex가 별도 검증한다.
