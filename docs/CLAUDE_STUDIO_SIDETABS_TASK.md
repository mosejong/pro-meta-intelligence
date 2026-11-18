# 화면 밀도 정리 — 실제 사이드탭 작업실

2026-11-18 사용자: '한페이지에서 보여주기 너무 많지않아? 사이드탭같은걸 활용해'. Opus 5.5 Medium 구현, Codex 통합검토. commit/push/배포/새데이터/가중치 변경 금지. 한도 발생 시 인수인계 후 멈춤.

## 디자인/동작

기존 draft-lab.tsx의 두 탭은 밴픽 안에 로스터/A-B/입력준비를 모두 쌓는다. **다섯 개 실제 패널**로 분리:
1. 모의 밴픽(DRAFT)
2. 선수·로스터(ROSTER): RosterWorkshop + 현재 선수 근거/연간 기록(기존 nested 내용)
3. 상세 분석(DETAILS): 챔피언 정보(DraftChampionInfo) + 상대 픽 미리보기 + 현재 에이전트 후보/검증경계
4. A/B 비교(COMPARISON): DraftComparisonPanel
5. 시뮬레이션 준비(SIMULATION): SimulationReadinessPanel + 배정 챔피언 기록(기존 nested 내용)

- PC(대략>=1100px) 좌측 132~152px 내비게이션 레일 + 오른쪽 현재 패널. 기존 어두운 작업실/차분한 금색 강조를 유지. 장식 카드/그라디언트/큰 설명 추가 금지.
- 모바일은 좌측 폭을 먹지 않는 상단 가로 스크롤 탭 레일. 선택 탭이 보이게 하고 터치44px이상, 전체 문서 가로넘침 없음. 바닥 기존 글로벌 내비와 겹치지 않는다.
- 팀 선택은 모든 패널 위 공유한 번만. 모의 밴픽에는 진행/검색/양팀픽밴/확정/되돌리기/세트/저장만. 챔피언 정보 전체는 DETAILS로 이동하고 main에는 작은 '챔피언 정보 보기' 진입점. 확정 슬롯 클릭 시 DETAILS로 이동해 해당챔프를 보게 해도 됨(선택/확정과는 분리).
- 나머지 패널에 roster/A-B/simulation 컴포넌트를 각각 한번만 렌더. **전부 mounted 유지 + hidden**. 레일 전환 시 타이머/선택/올려놓기/가상로스터/liveRoster/기기저장/기준A/roleassignment/frozeninput/파일재현 상태를 버리지 않는다.
- 숨김을 CSS display:grid 등으로 덮지 않는다. 패널별 role=tabpanel/aria-labelledby, nav role=tablist/aria-controls/aria-selected/roving tabIndex. PC Up/Down, 모바일 Left/Right, Home/End 지원(양 축 허용해도 됨). focus-visible와 선택 강조. 기존 showStudioTab/DETAIlS->DRAFT 추천올려놓기 동작 유지.
- nav 짧은 문구 이외 새 설명 늘리지 않음. 기존 세트/저장 실패 경고는 밴픽에서 보이고 저장 경고를 숨겨도 저장 성공으로 꾸미지 않는다. 가능하면 공유 헤더에 '저장 실패' 작은 상태가 모든패널에서 보임.
- 새 탭 번역 키만 기존 locale 카탈로그에 추가(ko/zh-CN 기존범위). 기능 내용 전체 번역/새번역에이전트 금지.

## 소유와 검사

소유: draft-lab.tsx, draft-studio.css(필요시 draft-workspace.css), locale의 새 nav 키, web/tests 중 새 navigation E2E 및 기존 시나리오의 **실제 탭 이동 helper** 변경. 기능 모델/roster/시뮬레이션 스키마/데이터/로더는 수정하지 않는다. 부모는 검토/별도문서/최종실행 담당.

기존 E2E는 로스터/비교/입력준비가 main에 보인다고 가정한다. helper에서 해당탭을 클릭하고, 밴픽 조작 전에 DRAFT로 돌아오게 현실적으로 갱신한다. hidden을 강제해제하거나 test용 UI/리트라이로 숨기지 않는다. static소스 tests에 두 탭/순서 하드코딩이 있으면 새 구조의 의미로 갱신하되 검증을 삭제하지 않는다.

새 E2E desktop/mobile:
- 진입에 DRAFT만 visible. ROSTER/COMPARISON/SIMULATION/DETAILS 내용은 눈에 안보임.
- 올려놓기+확정 후 탭 왕복해 draft 상태 유지, 로스터 수정 상태 유지, A 고정 후 다른탭왕복 baseline 유지, 준비입력 역할 상태유지(필요시2개테스트로).
- 키보드 Up/Down/Left/Right/Home/End, active focus, selectedtabpanel 연동.
- desktop레이일실제왼쪽/모바일한화면문서overflow0, PC/모바일 캡처 저장.
- main 아래 다른패널 내용이 숨겨져 스크롤 길이가 실제로 줄었는지 확인.

관련 단위→type/lint→Pages→새+변경 E2E. 권한막힌 명령은 우회하지 말고 보고(부모실행). 테스트전체를 무의미하게 반복하지 않는다.
docs/STUDIO_SIDETABS_RESULT.md에 바뀐파일/실제검사/미검사/미확인을 기록.
