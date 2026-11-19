# 결과: 같은 밴픽의 여러 재현 번호 비교 (2026-11-19)

## 구현 파일
- `web/app/experiment-batch.ts` (신규, 순수): `parsePairCount`(정수 1~30), `runExperimentBatch(A, B, shownMinute, pairs)`, `batchMatchesTarget`, `spreadOf`.
  - 먼저 기존 `compareExperimentRuns`로 검증(미신뢰/규칙/시드/자료/팀/밴픽/로스터/역할/입력 불일치 거부), B 재생 종료 전·A=B 실행 거부.
  - 고정 시드 목록 `BATCH_SEEDS` = 1..30 (`BATCH_SEED_LIST_ID = "batch-seeds-1-30-v1"`), 앞 N개를 A·B 각각 사용(기본 20).
  - A/B 각자의 `input.assumptions`·ruleset 그대로 `simulateManager` 호출, `replayFrame` 최종값이 모델 합계와 다르면 전체 거부.
  - 팀은 원본 team ID로 대응. 결과: 시드 목록·목록 ID·규칙 버전·입력 키·evidenceIdentity·팀 ID 순서·대상 run ID 보존, 팀별 모델 내부 승리 횟수(분모), B−A 자원/킬/종료 분 min/median/max, `allZero`. 결과는 깊은 동결, 원본 run 불변.
- `web/app/experiment-batch-panel.tsx/.css` (신규): 쌍 수 입력 + 버튼(단일 A/B 비교가 유효하고 B 재생 종료 시에만 활성). 버튼 클릭 때만 계산. A/B가 바뀌면 기존 결과를 재계산하지 않고 "이전 대상" 안내 + "현재 A/B로 다시 실행". 요약은 짧게, 쌍별 상세는 `<details>`로 접음. 승률/퍼센트/신뢰구간 표시 없음. "같은 가정" 문구는 `changeKind === "NONE"`일 때만 표시하고, 가정이 다른데 차이가 모두 0이면 "이 재현 번호 목록에서는 표시된 차이가 모두 0"이라고만 표시합니다.
- `web/app/experiment-comparison-panel.tsx`: import 1줄 + 기준 A가 있을 때 `ExperimentBatchPanel` 렌더 1블록만 추가. 기존 재생/현재 선택 변경 없음.
- `web/tests/experiment-batch.test.mjs` (신규): 쌍 수 파싱, 같은 가정→모든 차이 0·시드/맥락 보존·동결, 변경 가정 결정성·원본 불변, 재생 전/복사본/팀·시드 불일치/상한 초과 거부, 대상 불일치 판정.

## 실행한 검사
- `node --test web/tests/experiment-batch.test.mjs ...` 실행 시도 → **권한 승인 필요로 차단**되어 재시도하지 않음. unit/typecheck 모두 **미실행**. 타입은 수동 대조만 함.

## 미완료 / 부모 확인 필요
- 위 unit 테스트와 typecheck 실행(부모 통합 시).
- 기준 A 해제 시 batch 패널이 언마운트되어 결과도 사라짐(화면 메모리 전용, 의도된 동작으로 둠).
