# C3a — 로스터를 A/B 비교에 연결

2026-11-17 사용자: 완성도를 높이며 자동 진행. 구현 Opus 5.5 Medium, Codex 검토. 토큰 한도 발생 시 중단·상태 기록. 유료 설정/크레딧 변경 금지.

## 범위

현재 로스터는 편집/연간 자료 표시에만 사용되고 A/B 비교에는 들어가지 않는다. **배정 명단과 출처를 A/B에 고정·비교·내보내기·읽기 전용 재현**하도록 연결한다. 승패/가중치/추천 효과는 이번에 추가하지 않는다.

읽기: web/app/roster-workshop.tsx, roster-scenario.ts, draft-comparison.ts, draft-comparison-panel.tsx, draft-lab.tsx, tests/roster-scenario.test.mjs, draft-comparison.test.mjs, tests/e2e/roster-workshop.spec.mjs.

소유: 위 5개 app 파일 + 관련 단위/E2E 검사, 필요하면 새 roster-comparison.ts. package.json 변경은 테스트 목록 한정. Codex는 별도 simulation-* 파일만 작업하므로 건드리지 않는다.

## 요구

1. 실제 편집·파일가져오기·기기복원된 roster state를 부모에 전달해 A/B 스냅샷에 detached 고정한다. 단순 기본 명단 재계산은 금지. 팀 쌍/자료 기준 전환과 진영 교체에 안전하게 연결하고 렌더 루프/이전 쌍 상태 누출을 막는다.
2. 선수는 source_team_id+player_id로 식별. 이름/가상 소속/역할은 구분. 빈 슬롯 허용(미배정), 전체 중복·불명 ID 거부. 새 배정은 같은 report index로 검증한다. 원자료 객체 참조/수정 금지.
3. A는 freeze 당시 명단, B는 현재 명단. 픽·밴 동일해도 로스터 변경은 양 진영/역할별 표시. 팀ID로 저장해 side swap 의미 보존. 수정이 frozen A를 바꾸지 않는다.
4. 비교 파일 새 schema v2: 명단/근거 기준 포함, 파싱/재계산/변조 감지. 기존 v1 파일은 읽기 전용 호환하고 명단은 '기록 없음'으로 처리(현재 명단으로 채우지 않음). 기존 draft-session v2/v3 파일을 바꾸지 않는다. 로스터 파일 v1도 호환 유지.
5. 캡처에서 근거는 현재 report 기반 명단 관측이다. 지연 로드 연간 자료를 포함했다고 주장하지 않는다. 선수 효과/승률/시뮬레이션 미계산 문구 유지. 예전 'baseline을 바꾸지 않는다' 설명은 '이미 고정된 A를 소급 변경하지 않는다'로 정확하게 수정한다.
6. 읽기 전용 재현이 밴픽/로스터/기기 저장/기준 A에 영향을 주지 않는지 검사한다. 파일 크기 제한/오류/unknown schema는 기존 fail-closed 유지.

## 검증·보고

관련 단위 → typecheck/lint → Pages 빌드 및 desktop/mobile 실제 Chrome E2E(명단 A 고정 후 교체→차이→JSON 재현, 슬롯 변경/진영 교체/이전 v1/잘못된 ID). 긴 전체 E2E 재실행 금지. 복원 1회 flake 이력 있으니 확정되지 않은 문제를 없다고 쓰지 않는다.
명령은 npm --prefix web 또는 node --test web/tests/... . npm test 빌드 권한이 막히면 우회하지 말고 보고(부모가 실행). 요청 승인 블록에서 멈추고 기다리거나 범위를 늘리지 않는다.
docs/ROSTER_COMPARISON_RESULT.md에 변경/실검사/미확인을 기록. **git commit/push/merge/deploy 금지**. 기존 untracked 파일 보존. 결과 요약은 한국어.
