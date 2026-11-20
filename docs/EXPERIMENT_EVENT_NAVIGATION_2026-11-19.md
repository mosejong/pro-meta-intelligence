# 가정 실험 재생: 사건 단위 이동 (2026-11-19)

## 구현
- `web/app/experiment-event-navigation.ts`: 순수 `eventNavigation(run, minute)`.
  - 실제 필드 `run.result.events`(ManagerResult)만 읽음. `log`는 replayFrame 출력 필드이며 입력이 아님.
  - SKIRMISH/OBJECTIVE/BASE만(GROWTH·END 제외), 정수 0..endMinute 분만, 중복 분 1개, 오름차순.
  - cursor: 유한값 floor 후 0..endMinute clamp, 비유한 0 (replayFrame과 동일).
  - prev = 엄격 작은 분, next = 엄격 큰 분. endMinute가 정수 0..MAX_MINUTE가 아니면 전부 null/빈 배열.
  - 입력 불변, 엔진·buildExperimentRun·replayFrame 호출 없음.
- `experiment-replay-panel.tsx`: seek 아래 기본 접힘 `details` "사건 단위로 이동" + 이전 사건/다음 사건/결과까지 이동.
  - 클릭 시 기존 reducer에 `PAUSE` → `SEEK` 순서로 dispatch (reducer 미수정). 고정 `run`만 사용하므로 실행 뒤 현재 입력이 바뀌어도 고정 실행 기준.
  - 이전/다음 없으면 disable, 마지막 시각이면 결과 버튼 disable. 설명: "고정 실행의 표시 위치만 이동하며 다시 계산하지 않습니다."
- CSS: 기존 details/controls 재사용, 이 영역 summary·버튼 44px, 줄바꿈 허용.
- 테스트 `web/tests/experiment-event-navigation.test.mjs` + `package.json` test 목록 등록.

## 한계
- Claude는 검사를 실행하지 않았다. 이후 Codex가 관련21개·타입·변경lint와 Pages 빌드를 확인했다.
- 실제 Chrome PC/모바일 폭2개에서 사건앞뒤/이동후정지/끝/실행뒤시드변경에도고정결과유지/44px/가로넘침없음을 확인했다. 실제 휴대폰 검증은 아니다.
- 이동 단위는 모델 사건 분이며 실제 LoL 하이라이트·선수 효과·예측이 아님.


모델/계수/팀입력/시뮬레이션코어/reducer는 바꾸지 않았다. 전체웹436 통과는 직전
복기 공유 통합 시점이며, 이후 이 작은 변경에는 관련21개와 실제PC/모바일2개를 적용했다.
전체를 다시 실행했다고 주장하지 않는다. 캡처 outputs/experiment-event-navigation-mobile-20261119.png.
제품 push/배포 없음.
