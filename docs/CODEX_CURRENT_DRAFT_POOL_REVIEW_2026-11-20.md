# 후보 누락 진단 — 독립 검토 (2026-11-20)

기존9경기180차례를 다시 쓰는 설명용 진단이다. 새로운 예측 검증이나 규칙 개선 성과가 아니다. 실제 선택을 최선의 전략으로 가정하지 않는다. 추천·기준/시즌 평가 코드는 바꾸지 않았다.

## 확인한 결과

### BASELINE

|행동|분류|횟수|
|---|---|---|
|BAN|BAN_NOT_IN_TARGET_SOURCES|3|
|BAN|BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE|75|
|BAN|BAN_TARGET_PRIORITY_BEYOND_TOP3|5|
|BAN|TOP3|7|
|PICK|PICK_IN_POOL_FEASIBLE_BEYOND_TOP3|65|
|PICK|PICK_IN_POOL_ROLE_INFEASIBLE|5|
|PICK|PICK_NOT_IN_POOL|2|
|PICK|TOP3|18|

### SEASON

|행동|분류|횟수|
|---|---|---|
|BAN|BAN_NOT_IN_TARGET_SOURCES|2|
|BAN|BAN_OUTSIDE_TARGET_PRIORITIES_IN_OTHER_TARGET_SOURCE|76|
|BAN|BAN_TARGET_PRIORITY_BEYOND_TOP3|5|
|BAN|TOP3|7|
|PICK|PICK_IN_POOL_FEASIBLE_BEYOND_TOP3|72|
|PICK|TOP3|18|

- 시즌 경로에서 실제 픽90개는 모두 관측 후보 풀에 있었고 역할상 수용 가능했다. 그중72개는 실제 추천3개 밖이었다. 이9경기에서는 단순 자료 부재와 후보 순위를 구분해야 한다.
- 시즌 경로의 실제 밴76개는 상대 우선 픽에는 없지만 다른 관측 자료·메타에는 있었다. 밴 규칙의 자료 사용 범위를 조사할 근거이며 그 밴을 추천해야 한다는 증명은 아니다.
- 두 경로 모두180차례의 앞3후보가 운영 함수와 같았다. 3위 이후 재구성 위치는 간접 검증된 연구 값이며 운영 함수가 반환한 순위가 아니다.
- 진단 전/기록/진단 후 전체 기준 결과와 시즌 결과가 각각 바이트 동일했고, 입력 데이터도 그대로였다. 원본 경로·경기ID를 담은 상세 기록은 로컬 outputs에만 보관한다.

## 검증

- 합성 진단9/9, 기존 기준28/28 및 시즌31/31 검사는 이전 독립 실행 통과. 새68개 웹 검사를 기본 npm test 목록에도 등록했다.
- 실제 두 경로 실행 성공, 각180차례 분모와 TOP3합계25 보존. 단계별·행동별 분류 합계가 각 분모와 일치한다.
- 최종 통합: Python879/879, 웹632/632, Pages5/5, 타입·전체웹lint, Python src/tests ruff·포맷134파일 통과. 추천 규칙 파일은30525faf 이후 변경 없음.

## 다음 관문

추천 가중치나 자료 사용 순서의 개선은 별도 설계다. 이미 본9경기를 맞추도록 조정하지 않는다. 이후 물리적으로 확보한 입력·결과 자료와 고정된 평가 기간·배제 기준을 준비하기 전 실전 성능 개선을 주장하지 않는다. 자료 준비를 기다리는 동안 검증 가능한 사용성·호환성 개선을 우선할 수 있다.

## 이미 배포한 화면

별도 PR#132는 merge03b67913c2786ebfdb9eeb444cc52226abfda369, Pages44680342203 성공. 공개 PC/모바일 HTTP200·팀 선택/시작·자동 선택2회·4차례 상태 복원·메모2개·자동off·뒤로/이어가기·오류0·가로 넘침 없음 확인. 후보 진단 도구의 성과와 화면 배포를 혼동하지 않는다.
