# 고정 밴픽 가정 실험·재생 · Claude 구현

Opus 5.5 medium. Codex 독립 검증. 기존 작업 유지. 추가 에이전트/웹조회/새 수집/패키지 설치/번역/커밋·푸시·배포 금지. 실제 챔피언/선수/아이템 효과를 invent하지 않는다.

## 목표

기존 `simulation-core.ts`는 실행 가능한 가정 엔진이지만 제품 UI에 실행/재생 연결이 없다. 기존 simulation readiness로 검증된 고정 입력을 사용하고 시뮬레이션 전용 탭에 작은 실험 패널을 연결한다. 기본값은 중립0, 사용자가 두 팀의 라인/운영/한타 가정(-1..1)을 직접 지정한다. 이름/챔피언/시즌/선수 기록으로 가정값을 자동 채우지 않는다. **실전 LoL 승률·배속 실제 경기 재현이 아니라 사용자 가정에 따른 추상 모델 실행**임을 입력/결과에 명시한다.

읽기: simulation-core.ts, simulation-scenario.ts, simulation-readiness-panel.tsx, draft-lab.tsx의 onReadyInputChange/시뮬레이션 탭, 기존 시뮬레이션 테스트. 기존 엔진/준비 검증/자료를 재사용하고 재설계하지 않는다.

쓰기: NEW `web/app/experiment-replay.ts` (순수 어댑터·이벤트 시점 상태), NEW `web/app/experiment-replay-panel.tsx`/css, draft-lab.tsx 최소 연결, web/package.json 테스트 추가, NEW web/tests/experiment-replay.test.mjs, NEW web/tests/e2e/experiment-replay.spec.mjs, NEW docs/CLAUDE_EXPERIMENT_REPLAY_RESULT_2026-11-19.md. core/scenario/readiness/기존저장스키마/추천 규칙은 수정하지 않는다. 막히면 정확한 이유를 보고한다.

## 필수 계약

- 준비 입력이 없거나 room/복원/자료 로딩 중에는 실행하지 않는다. 부모의 기존 validated readiness snapshot을 받아 detached run에 고정한다. UI 변경/후속드래프트/자료갱신이 이미 실행한 입력·사건·결과를 바꾸지 않는다. 현재 입력과 달라졌다면 기존 실행임을 표시하고, 새 준비 전 새 실행은 금지한다.
- seed는 0..uint32 정수만, 가정값은 유한수·범위내만. 입력 invalid/blank/out of range에서 실행을 무시/차단하고 과거 정상값으로 몰래 대체하지 않는다.
- `simulateManager` 호출은 명시적 실행 버튼에서 한 번. 자동 렌더/slider/속도변경/재생/seek 때 새 계산·새 난수·새 winner 생성 금지.
- 안전한 core team id는 실제 team ID 정렬에 따른 team_a/team_b 매핑 등 양 팀 순서 교환에도 안정적인 방법 사용. 표시 진영을 identity로 사용하지 않는다. 실제 source 팀 ID는 별도로 고정 보존한다. 실제 선수/챔피언의 강함은 core 입력에 넣지 않는다.
- 재생/일시정지/처음/한 단계/1x·2x·4x/seek. 보이는 시점 이전 사건만으로 금화·킬·추상오브젝트·기지 상태를 재구성하고 미래 승자/사건을 재생 화면에 미리 보여주지 않는다. 완료에서만 '모델 내부 결과' 표시. engine gold는 실제 경기 골드 재현 아님, objectives도 추상 진행임을 표시.
- 초기 상태/종료 상태·전투기록·기지피해의 상대/END 처리와 모델 total state가 일치해야 한다. 자동 끝·unmount timer 정리·reset·뒤로 seek·새 실행 후 타이머 경합을 처리한다. 속도 변경은 표시 속도만 바꾼다.
- 큰 설명/전문 입력은 접거나 상세 안에 배치, 기존 디자인 톤. 사용자에게 JSON을 기본 사용 흐름으로 요구하지 않는다. 로컬 메모리 실행이며 새 저장/공유 형식은 만들지 않는다. 새 실행 버튼을 눌러야 실행하며 재생/슬라이더 변경만으로 현재밴픽을 수정하지 않는다.

## 검증

단위: 같은 입력·seed 재현, source ID↔core 매핑 진영교환불변, 가정값 자동추론없음, 누락/invalid 차단, 이벤트 0/중간/끝/후퇴 상태·terminal winner 비노출, 입력 및 완료결과불변.
실제브라우저 신규 spec PC/모바일 최대4케이스: 준비 안 됨→실행 차단, 준비 완료 실행·pause/step/speed/seek/reset, 현재밴픽변경후 고정입력 표시, 가로넘침·키보드. 기존 준비 테스트 helper 재사용 가능. broad 41개 브라우저 반복은 금지. 관련 단위/타입/lint/Pages 및 신규 browser만 실행하고 실제 수행 결과를 적는다. Codex가 독립검사한다.
