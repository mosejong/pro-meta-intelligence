# Claude 작업 3 · 자동 상대 선택 이유와 대안

Base HEAD 88682258. 사용자 역할: Claude Opus 5.5 medium 구현, Codex 검증/통합. 이번에는 새로운 짧은 세션으로 이 지시와 관련 파일만 읽는다. 전체 사업계획/과거 대화 재독 금지.

## 목적
자동 상대가 실제로 선택한 이유와 대신 검토할 후보 최대 2개를 보여준다. 현재 사용자는 마지막 선택의 한 줄 설명만 본다. 선택 알고리즘/가중치/실제 선택은 이번 작업에서 바꾸지 않는다.

## 소유 파일
web/app/solo-draft.ts(기존 선택을 보존하는 추출만), web/app/draft-lab.tsx(자동 선택 설명 연결만), 신규 web/app/solo-draft-explanation.tsx/css(또는 유사 명칭 하나), 신규 web/tests/solo-draft-explanation.test.mjs, 신규 web/tests/e2e/solo-draft-explanation.spec.mjs, docs/CLAUDE_SOLO_EXPLANATION_RESULT_2026-11-18.md. package/기존 테스트/메인 문서는 Codex 소유. 그 밖의 변경 금지.

## 계약
- suggestSoloDraftTurn(input)의 반환값과 선택 결과를 기존 호출자에 대해 그대로 보존한다. 고정된 정상/잘못된 입력/현재·시즌 미확인/양 선픽/각 진영/피어리스에서 동일해야 한다.
- 새 별도 export explainSoloDraftTurn(input) 등: selected(기존 제안과 동일), alternatives(최대 2개), 필요하면 공개 범위/포지션 근거 설명. 우선순위 점수/확률을 새로 만들지 않는다.
- 대안은 같은 선택 직전 상태에서 선택 후보를 하나씩 제외한 다음 규칙이 고르는 합법 후보로 한정. 임의로 previousPicks에 fake lock을 추가해 검증을 우회하지 않는다. 안전한 방법은 private selector에 추가 excluded set을 넣어 availability만 제한하고, 원래 replay/Fearless 검증을 유지하는 것. 다른 방식이면 등가성을 검증하라.
- selected와 대안은 서로 다르고 canonical ID. 밴/픽/이전 세트 잠금 후보 금지. BAN은 상대팀 기록, PICK은 행동팀/메타/시즌 등 기존 범위를 정확히 설명. season 미수용을 사용 경험 0으로 표시하지 않는다. FALLBACK과 role_supported=false를 숨기지 않는다.
- UI: 기존 solo 영역의 compact summary 또는 접힌 상세. 메인에 긴 분석을 펼치지 말 것. 마지막 실제 자동 선택과 **그 선택 직전** 기준의 이유/대안만 보여준다. 대안을 이미 선택 후의 상태로 재계산해 거짓 설명하지 않는다. 읽기 전용이며 대안을 누른다고 자동 픽/되돌리기/저장 상태 변경 없음. 실제 대응·상성 우위·승률 예측이라고 표시하지 않는다.
- 자동 선택 취소/되돌리기/세트·팀/불러오기/방 전환 때 낡은 설명이 새 선택인 것처럼 남지 않도록 검증한다. 이전 lastAuto 초기화 경로를 재사용. state가 race로 달라졌으면 해당 선택과 이전 prefix/context가 맞는 경우만 표시.
- v4 저장/공유 링크/방/보관함 스키마는 건드리지 않는다. 설명 기록은 이번 세트 메모리만. 명시 사용자 포지션과 추론 역할은 구분.
- React 렌더/타이머마다 같은 대형 계산·저장을 반복하지 않도록 memoization. 기존 자동 상대 600ms와 다른 탭에서 멈춤 유지. 데이터 요청 추가 없음.

## 검증
새 Node 검사 + typecheck. 기존 solo tests, 3세트·집중 밴 검사는 필요한 범위에서 실행. 브라우저 spec은 작성하고 실제 실행 여부 구분. Codex가 독립 비교·전체 lint/test·PC/모바일을 수행한다.

## 금지
새 패키지/수집/모델 우회/유료 전환/다른 에이전트/번역/다른 기능/폴더삭제/git commit,push,merge,deploy 금지. 한도/모델 오류면 중단하고 남긴다. 관련 읽기·편집과 node/npm 로컬 검사만 사용.

결과 문서: 변경 파일, 실제 검사, 실패, 미지원만 간결하게. Codex 검증을 본인이 실행했다고 표시하지 않는다.
