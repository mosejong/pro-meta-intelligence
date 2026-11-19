# 여러 재현 번호 비교 요약 복사 — 결과 (2026-11-19, Claude Opus 5.5)

## 변경 파일
- `web/app/experiment-batch-summary.ts` (신규): `buildBatchSummaryText(result, label)` 순수 함수, `BATCH_SUMMARY_BOUNDARY` 문구.
  - 기존 `BatchResult`/`Spread` 타입과 패널의 `label`만 사용. 엔진/`runExperimentBatch` 호출 없음, 입력 불변.
  - 포함: 기준 A #, 실행 B #, 재현 번호 목록 ID·범위·쌍 수, 규칙, 팀별 모델 승리 횟수/분모(A→B), 자원/킬 B−A 최소·중앙·최대, 종료 분 B−A 범위, 같은 가정/전부 0 안내, 모델 내부 실험·실제 승률/실전 예측 아님·선수/챔피언/룬/아이템 효과 미반영 문구.
- `web/app/experiment-batch-panel.tsx`: 결과 아래 "비교 요약을 쉬운 글로 복사" 버튼.
  - 현재 A/B와 다른 이전 결과(`!matches`)면 버튼 비활성 + 이유 문구(`aria-describedby`).
  - `navigator.clipboard.writeText` 완료 후에만 "복사했습니다" 표시. API 없음/거부 시 같은 글을 `readOnly` textarea(포커스 시 전체 선택)로 제공.
  - 오래된 상태 방지: `useRef` 토큰을 A/B runId·result 변경 및 unmount 때 증가, 비동기 완료 시 토큰 불일치면 무시. 추가로 렌더 시 copy 상태가 현재 result 객체·A/B id와 정확히 같을 때만 표시(effect 이전 렌더 보호). 완료 판단은 ref로 하므로 이전 렌더 클로저 값에 의존하지 않음.
  - 스타일 파일 변경 없음(기존 클래스 재사용, textarea만 inline `width:100%`). 권한/네트워크/외부 공유 추가 없음.
- `web/tests/experiment-batch-summary.test.mjs` (신규): 원본 불변, 동일 결과 결정성, 필수 항목 포함, 쉬운 글(JSON/마크업·원시 id·% 없음), 경계 문구, NONE/allZero 안내.

## 검증
- `node --test web/tests/experiment-batch-summary.test.mjs` 실행 시도 → 도구 승인 단계에서 승인 필요로 중단됨(반복 시도하지 않음). **미실행** — Codex가 실행 필요.
- 타입체크/린트/브라우저 확인도 범위 밖이라 미실행.

## Codex 확인 요청
1. `cd web && node --test tests/experiment-batch-summary.test.mjs`
2. 타입체크(`experiment-batch-panel.tsx`의 `navigator.clipboard?.writeText?.bind` 및 async onClick).


## 중단 없는 후속 실행: 가정 비교 UX

여러시드 화면의 명시실행/쌍수제한/새B 후 stale 표시를 실제PC에서 확인했다. 이어 Claude세션 eed9010e-d402-40e2-8677-d2750e7e89c3(정상완료)가 쉬운글요약복사를 구현했다. Codex가 effect내동기setState lint실패를 제거하고 commit단계 토큰무효화/useLayoutEffect로 정리했다. 핵심11개·빌드·변경lint 통과, 실제PC에서 복사거부시 수동textarea와 새B시복사차단까지1개통과. 이전 시험실패는 innerText/textContent와 버튼정확명 테스트선택자 차이였으며 수정했다. 신규테스트 package등록. 제품배포없음. 이제 최근 여러 저장형식 연결이 모였으므로 웹통합검사를 한 번 실행한다.

통합 검사 결과: 최신 기능을 포함한 npm test 369/369 통과. 로그 outputs/web-integration-20261119.log. 타입/변경lint와 가정비교 실화면1개 통과는 별도 기록이며 실제효용/승률 입증이 아니다. 다음 구현은 연습 보관함 이름변경으로 기존 저장분을 삭제·재생성하지 않고 관리하는 작은 흐름이다.
