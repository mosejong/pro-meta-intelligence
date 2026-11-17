# 자동 진행 체크포인트

사용자 2026-11-17 지시: 토큰 한도로 막힐 때까지 자동 진행. 한도 우회·유료 설정 변경 없이 기록을 남긴다.
머지·배포·새 데이터 소스·구매는 하지 않는다. 기존 파일/원본/사용자 자료를 보존한다.

## 이번 배치

1. 로스터를 A/B 비교에 고정 — Claude Opus 5.5 Medium 구현 + Codex 검토·전체 통합 검사 완료.
2. 가정 기반 최소 엔진 — Codex 내부 모듈·단위 검사 작성. 실제 밴픽 UI와 연결하지 않음.
3. IndexedDB 대기 제한 — Codex 보완. open/읽기/쓰기 각 10초 제한, blocked 즉시 오류, 늦은 연결 닫기, 실패 뒤 쓰기 큐 재개.
4. 명시적 챔피언 역할 배정·입력 고정/읽기 전용 재현 — Claude 구현 + Codex 이전 세트 소유권 key 결함 수정. 웹 158/158, 새 E2E 8/8 통과. 로스터 배치 E2E 24/24 통과.
5. 팀 실력 기본값 대비 밴픽 추가 정보량 오프라인 평가 — 구현·실행·부모 독립 계산 완료. 평가 2,695경기에서 Elo accuracy .621521 vs Elo+draft .616327, logloss/Brier도 draft가 소폭 불리, 차이 구간은0포함. 단순 챔피언 가중치의 추가효과 미입증, UI 미연결. 9,146확률 대조 일치·Python331/331·ruff 통과. `docs/DRAFT_OUTCOME_BASELINE_REVIEW.md`.
6. 현재 배정 챔피언의 해당 선수-출처팀-역할 연간/최근20/참조패치 경험 연결 — Claude 실행 중. `docs/CLAUDE_SCENARIO_PLAYER_EVIDENCE_TASK.md`, `outputs/claude-scenario-player-evidence-20261117-result.json`. simulation-player-evidence 새 파일 + readiness패널/스타일 + draft-lab publicationRoot prop + 관련 검사/결과 문서만 소유. 기존 manager-scenario 스키마는 변경하지 않는다.

기본 브랜치 `feat/workspace-reliability-20261117`. 앞선 신뢰성 커밋 `f4ee0935`, 이전 선수 자료 작업의 로컬 커밋도 포함한다.
로스터/역할 입력/내부 엔진/저장 기한 배치는 `01719476`으로 로컬 커밋했다. `draft-session.ts`는 저장 경로만 보완하며 v2/v3 형식은 유지한다. 원격 푸시/머지/배포는 안 했다. 오프라인 평가 작업은 별도 미커밋이다.

## 검사 위치

- Claude: `docs/ROSTER_COMPARISON_RESULT.md`, `outputs/claude-roster-comparison-20261117-result.json`.
- 부모: `outputs/roster-comparison-{full-web,typecheck,lint,pages,e2e}-20261117.log`.
- 내부 엔진: `docs/SIMULATION_CORE_RESULT.md`, `outputs/simulation-core-unit-20261117.log`.
- DB 대기: `outputs/draft-storage-deadline-20261117.log` (7/7: 기존 autosave 4개+새 3개).

Claude가 타입·린트/브라우저 명령 승인을 받지 못해 단위만 돌렸으므로 **부모 결과가 통합 완료 근거**다.
기존 복원 검사 1회 flake 이력을 지우지 않는다. 현재 배치에서 재발하면 제품/테스트 원인을 구분해 조사한다.

## 다음 단계

- 실패한 통합 검사를 먼저 해결하고 검증된 범위만 로컬 커밋한다.
- 시뮬레이션 연결 전 역할별 챔피언 배정·자료 기준·사용자 가정을 고정하는 입력 관문을 만든다.
- 실제 예측 효과가 없는 상태에서 가상 선수 교체가 승패를 바꾼다고 주장하지 않는다.
- 가용 한도 시점에는 호출을 멈추고 상태/남은 검사/파일 소유를 이 문서에 갱신한다.
