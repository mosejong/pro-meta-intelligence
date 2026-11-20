# 실험 가정 입력 도움말 — Claude 구현, Codex 검증

역할: Claude Opus 5.5 medium이 제품 코드 구현/수정 담당. Codex는 독립 검증 담당. 제품 코드를 Codex가 대신 수정하지 않는다.

목적: 초보 이용자가 라인·운영·한타 수치를 바꾸기 전에 추상 모델에서 무엇이 달라지는지 이해하도록 입력 바로 옆에 짧은 한국어 설명 제공.

읽기 최소: web/app/experiment-replay-panel.tsx, 관련 CSS, web/app/simulation-core.ts, web/tests/experiment-event-navigation.test.mjs 또는 experiment-replay.test.mjs의 SSR fixture.

소유: web/app/experiment-replay-panel.tsx, 필요할 때만 해당 CSS, 기존 관련 테스트 한 파일. 신규 테스트 파일/테스트 등록 변경은 불필요. 다른 소스 변경 금지.

요구사항:
- 라인: 모델의 시간당 자원 증가에 영향을 준다는 짧은 설명.
- 운영: 모델 자원 증가와 교전 점수 양쪽에 영향을 준다는 설명.
- 한타: 모델 교전 점수에 영향을 준다는 설명.
- 실제 선수 능력치·챔피언 효과·실제 승률로 오해시키지 말 것. 현 엔진은 분 단위이며 정밀한 계수 설명은 필요 없다.
- 각 input에 항상 고유 help ID를 aria-describedby로 연결. 오류가 있으면 기존 issue ID도 함께 유지. label/validation/noValidate/명시적 실행/시드/기본값/계수/재생/저장 규칙 불변.
- 도움말은 간결하게, 모바일 폭에도 적용. 기존 색상/컴포넌트 사용.
- 기존 fixture SSR 검증으로 6개 입력 각각의 실제 도움말 연결과 설명, 기존 모델 경계 문구 확인. 구현 소스 문자열만 검사하는 테스트 금지.

금지: Bash/명령 실행, git, 네트워크, 수집, API, 배포, subagent, 모델 계수/새 능력치/별도기능. 테스트 실행은 Codex가 담당. Read/Edit/Write/Glob/Grep만 사용. 범위 밖 파일은 보존.

완료 시 바뀐 파일/검증 미실행/잔여 위험을 짧게 보고. 서비스 한도면 실제 오류와 reset을 기록하고 중단. 유료나 다른 모델로 우회하지 말 것.
