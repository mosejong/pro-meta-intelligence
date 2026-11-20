# 시즌 선수 관측 챔피언 비교 (2026-11-19)

## 범위
- 블루·레드 같은 역할에 서로 다른 선수의 과거 시즌 카드가 배정됐을 때(예: 2015 MaRin vs 2022 Nuguri, 둘 다 TOP) 당시 관측된 챔피언 사용 기록을 한곳에서 비교한다.
- 표시 전용. 승패·능력치·우열·현재 메타 추천·시대 보정 없음. 시뮬레이션·추천·저장·선수 배정·로더 변경 없음.

## 파일
- `web/app/season-player-comparison.ts` — 순수 helper `compareSeasonCards(blue, red, selections, previousPicks)`.
- `web/app/season-player-comparison-panel.tsx`, `season-player-comparison.css` — 기본 접힌 `details` "시즌 선수 관측 비교".
- `web/app/season-lineup-panel.tsx` — 시즌 선수 선택 영역 아래 child import·render만 추가.
- `web/tests/season-player-comparison.test.mjs`, `web/package.json` 테스트 등록.

## 규칙
- 같은 role 필수(`ROLE_MISMATCH`), 같은 `player_id`는 시즌이 달라도 거부(`SAME_PLAYER`), 경기 수·챔피언 관측 수가 양의 정수가 아니거나 카드 경기 수를 넘으면 거부(`INVALID_CARD`).
- `championKey`로 정규화한 별칭은 카드별 최대 단일 행만 채택하고 합산하지 않는다.
- 카드별 상위 3(경기 수 desc, ID asc), 공통 챔피언 전체 수 + 최대 5개(정규화 키 asc, 블루/레드 경기 수 분리, 합산 순위 없음), 한쪽에서만 관측된 챔피언 최대 3개씩. 상대 쪽은 "미관측"이며 0으로 표시하지 않는다.
- 상태는 `poolChampionState` 재사용(이번 판 밴/픽, 이전 세트 잠금, 이번 밴픽 미사용).
- 각 쪽 표본 경기 수·시즌·패치 목록·`source_id`·`source_hashes` 보존, 카탈로그 기준 시각 표시, 리워크/시대·관측 기간 차이 안내 1줄.
- 패널: 카탈로그가 없거나 시즌 ref가 하나도 없으면 숨김. side BLUE/RED 팀이 정확히 하나씩이 아니면 안내만. 역할별로 `resolveSeasonRef` 검증, 실패 역할은 미확인 표시이며 다른 선수로 대체하지 않고 다른 역할 비교는 유지. 새 fetch·모델 호출 없음.

## UI 문구 수정
- 출처 표시: `source_id`가 `oracles-elixir-match-data`이면 화면에 "Oracle’s Elixir", 그 외는 "출처 미확인". 순수 helper 결과는 원본 `source_id`를 그대로 보존한다.
- 공통 챔피언 목록 안내: "챔피언 ID순 N개 표시" → "N개 표시".

## 검증 상태
- 이 문서 작성자(Claude)는 테스트·타입검사를 실행하지 않았다. 위 UI 문구 수정 이후의 검사는 아직 실행되지 않았다.
- 2015~2026 전체 기간 완전 수집이나 능력 효과를 주장하지 않는다.


## 통합 확인

마오카이를 현재 밴한 뒤2015MaRin/2022Nuguri를 배정해, 비교의 밴 상태와 분리된 관측횟수,
읽기전용·기본접힘·선수해제시옛비교제거·현재밴픽1턴불변·가로넘침없음을 PC/모바일폭에서 확인했다.
출처ID와 정렬 안내의 개발자 문구는 Codex가 지적하고 같은 Claude 세션이 수정했다.

전체62파일을4동시/테스트본체120초로 실행해451/451 통과했다.
outputs/web-season-comparison-bounded-20261119.log.
제한 없는 최초실행은 assertion451개 통과 후 worker하나 종료대기로 실패했고 실제 root cause는
미확인이다. 테스트 실행 종료 기한은 별도 Claude 수정 중이며 기능이 실패했다고 합치지 않는다.
이 검증을 승률/선수강함/현재메타 효용 증명으로 쓰지 않는다. 제품 push/배포 없음.


후속 통합은 Claude가 만든 전체프로세스 기한 실행기로 npm test457/457 통과했다.
문구 수정후 모바일폭1개도 다시 통과했고, 최신캡처는
outputs/season-player-comparison-mobile-20261119.png에 보존했다.
