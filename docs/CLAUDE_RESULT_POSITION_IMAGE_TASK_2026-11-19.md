# 결과 이미지에 명시 포지션 연결

Claude Opus5.5 medium. 작은 제품 개선: 현재 결과 PNG는 픽 선택 순서만 표시한다. 사용자가 화면에서 배정한 포지션을 PNG에도 넣어 친구와 공유하기 쉽게 한다. 기존 기능을 재사용하고 이미지에 선수능력/승률/예측 추가 금지.

소유 파일 web/app/draft-result-image.ts, draft-result-panel.tsx, draft-lab.tsx, web/tests/draft-result-image.test.mjs, 결과문서 docs/CLAUDE_RESULT_POSITION_IMAGE_RESULT_2026-11-19.md. 기존 draft-position-session.ts와 draft-position-board.ts는 읽기만. package/다른파일/git/네트워크/설치/full tests/browser/subagent 금지.

선택적 positionRecord를 기존 result panel 및 image builder로 전달. 기존 타입/호출 무옵션은 동일 모델/기존 테스트 유지. 전달한 명시 포지션은 기존 정규화/검증 함수로 현재 두팀/현재픽에 대해서만 수용하고 추정하지 말 것. 이미지 각 픽에 명시 역할을 한국어로 표시, 미배정은 미배정으로 표기. 관측 role을 명시배정으로 오인하지 말 것. BLUE/RED 변경/다른팀/undo 이후 stale 포지션을 표시하지 말 것. 역할 줄 추가로 캔버스 넘침 없이 기존 픽5/밴5 유지. 순서는 기존 픽 순서를 유지해 최소변경. 모델은 클릭 시점의 분리된 복사본 유지. 기존 결과/추천/선택 로직 변경 금지. ID alias 정규화 기존 도구 재사용. 신규 테스트는 일부배정/양팀/잘못된팀과외부픽/미배정/구버전호환 및 입력불변을 다룬다.

변경 검사 draft-result-image 단위만 시도. 명령이 승인 단계에서 거부되면 반복하지 말고 보고, Codex가 직접 실행한다. 구현 후 완료/미검증 정확히 기록. 한도 오류면 실제 오류/세션/reset시각 기록 후 종료, 과금/모델우회 없음.
