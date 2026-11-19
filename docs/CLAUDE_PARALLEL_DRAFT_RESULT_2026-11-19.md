# 병렬 A 결과: 자동 상대 전체 선택 복기 · 2026-11-19

## 구현 (소유 파일만)
- `web/app/solo-draft-history.ts` (신규): `appendSoloAutoHistory` / `pruneSoloAutoHistory` / `freezeSoloAutoRecord` / `soloHistoryContext`.
  각 기록은 확정 직전에 만든 `SoloAutoRecord`를 `structuredClone`하고 깊게 동결한 사본이다. 나중에 다시 계산하지 않는다.
  context = 기존 `soloAutoContext`(팀·선픽·내 진영·이전 세트 잠금) + `basisKey(rosterBasis(report))`(자료 기준).
  append할 때 맥락이나 과거 prefix가 다른 기록은 버린다. prune는 현재 보드에서 같은 prefix/turn/챔피언이 아닌 기록을 영구 삭제한다.
- `web/app/solo-draft-history-panel.tsx` (신규): 접힌 `details.solo-history` 목록. 차례별로 접힌 상세를 두고 기존 설명 본문을 재사용한다. 읽기 전용이다.
- `web/app/solo-draft-explanation.tsx`: `SoloAutoSummary`, `SoloDraftExplanationBody`를 추출했다. 마지막 선택 패널의 마크업과 문구는 그대로다.
- `web/app/solo-draft-explanation.css`: `.solo-history` 스타일을 추가했다.
- `web/app/draft-lab.tsx`: 실제 자동 확정 타이머 안에서 `lastAuto`와 같은 record를 history에 추가한다. 렌더링 중 prune해서 맞지 않는 기록을 영구 제거한다.
  같은 차례에서 같은 챔피언을 나중에 수동으로 고르면 자동으로 표시되던 문제를 막으려고, 매칭되지 않는 `lastAuto`도 같은 방식으로 null 처리한다.
  리셋·자동 토글·복원/불러오기·방 진입 때는 history를 비운다. undo는 비우지 않고 prune에 맡긴다. 그래서 더 앞선 자동 차례 기록은 유지된다.
- 추천 규칙과 선택 결과는 바꾸지 않았다. 저장·파일·링크·방 계약도 바꾸지 않았다.

## 범위
- history는 **현재 세트, 메모리 전용**이다. 저장·공유·링크·방으로 내보내지 않는다.
- 완료된 세트 기록은 보존하지 않는다. 다음 세트로 넘어가면 previousPicks가 바뀌어 context가 달라지고 기록이 삭제된다. 현 구조에서 세트별 보존을 안전하게 묶을 키가 없어서 범위 밖으로 두었다.
- 시즌 자료가 늦게 들어와도 과거 기록은 그대로다. 자동 선택은 로딩이 끝날 때까지 대기하고, 기록은 동결된 사본이다.

## 테스트
- unit `web/tests/solo-draft-history.test.mjs` (신규, 4개): 전체 세트 자동 10차례가 순서대로 남고 수동 차례는 빠지는지, 기록이 확정 직전 재계산 결과와 같은지, 동결되는지 본다. 그 밖에 undo·재선택·리셋·팀·진영·선픽·다음 세트·자료 기준 변경, 늦은 시즌 자료, 패널 마크업을 검사한다.
- E2E `web/tests/e2e/solo-draft-history.spec.mjs` (신규, 2개).
  인수인계에서 지적된 진영 전환 기대를 고쳤다. 이전 테스트는 turn3 이후 RED로 바꾸면 value 4가 될 것으로 기대했는데, 이 기대가 틀렸다.
  수정한 흐름은 다음과 같다. 자동 OFF 상태에서 turn3 수동 확정 → RED로 변경 → 자동 ON → turn4는 사용자 차례라 value 3 유지, history 없음 → 사용자가 turn4 확정 → BLUE가 turn5 자동 확정 → value 5, history (1), `5번째 차례`. 자동이 꺼진 상태에서 진영을 바꾸므로 타이머 경합이 없다. 제품 규칙은 바꾸지 않았다.

## 실제 실행 결과 / 미완료
- 이 세션에서는 node/tsc 실행이 권한 승인 대기로 막혀 **unit·타입·E2E를 직접 실행하지 못했다**. 재시도로 우회하지 않았다.
- 인수인계 문서 기준으로 Codex가 이전 초안을 검사했다. 관련 unit 51개 통과, 기본 이력 보기 E2E 2/2 통과, 진영 변경 E2E 2/2 실패였다.
- 이번에는 진영 변경 E2E 시나리오만 수정했다. 수정한 E2E 재실행, `package.json` 등록(Codex 몫), 타입/lint 확인이 남았다.
