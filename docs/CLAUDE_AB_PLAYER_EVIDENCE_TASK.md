# A/B 선수·챔피언 관측 근거 연결

2026-11-18 사용자 승인: 준비한 역할/선수 기록을 한 흐름으로 연결하고 A/B 차이를 근거로 설명. Opus 5.5 Medium 구현, Codex 통합 검토. 새 소스/모델 가중치/승률/전략 엔진/배포/commit 금지. 기존 작업/파일 보존.

## 현재

- A/B baseline은 draft-comparison.ts의 draft+roster만 기록, 명시적 챔피언 역할은 없음.
- SimulationReadinessPanel이 사용자의 챔피언 역할을 보유하고 준비 입력(SimulationInputSnapshot)을 검증한다.
- simulation-player-evidence.ts는 준비 입력과 검증된 연간 파일을 받아 해당 선수-원팀-역할에서 챔피언 사용 횟수를 계산한다. 0과 미확인 구분.
- UI는 5개 persistent side tabs. 다시 한 화면에 쌓거나 기본 밴픽 흐름을 바꾸지 않는다.

읽기 최소: simulation-scenario.ts, simulation-readiness-panel.tsx, simulation-player-evidence.ts/panel.tsx, player-season-history.ts, draft-comparison.ts/panel.tsx, draft-lab.tsx, 관련 단위/E2E. 모델 상수/기존 데이터 수정 금지.

## 이번 배치

1. 실제 현재 준비 입력을 SimulationReadinessPanel→부모→A/B에 전달하는 안정적인 콜백을 추가한다. tagged basis/pair/draft/roster를 검증하고 한 렌더 이전의 입력이 새 B에 붙지 않게 한다. 준비되지 않으면 null. 콜백 루프/타이머만 바뀌어 재통지/다른 pair 누출 금지. readiness 고정 입력이 아니라 **현재** 입력을 전달해야 한다.
2. A/B에서 A를 고정하면 당시 역할 배정도 detached 고정(준비된 입력이 같은 draft/roster일 때만). 역할이 없더라도 기존 구조 비교는 계속 가능하고 '역할 배정 기록 없음' 표시. 역할을 픽 슬롯 순서로 추정하지 않는다. 이후 역할/선수를 바꿔도 A를 소급 변경하지 않는다.
3. A/B에 '선수·챔피언 경험 차이' 기본 접힘 섹션. A와 B 모두 역할 기록이 있을 때만 연간 파일을 사용자 열기로 지연 로드. 없으면 시뮬레이션 준비 탭의 역할 배정으로 가는 짧은 CTA(실제 탭 전환)와 A 재고정 필요 여부 안내. 기본 A/B diff와 파일 재현은 막지 않는다.
4. 연간 자료는 **현재 추가 참고**로 같은 검증된 파일에서 A/B를 재집계한다. 당시 자료를 고정했다고 주장하지 않는다. A/B frozen 선수/역할별 챔피언에 대해 연간/최근20/참조패치 횟수·분모를 기존 helper로 구하고, 비교 카드로 A→B 선수/챔피언/횟수를 표시. 미확인·역할0·관측0 구분, 원팀·선수 ID 유지. 기준/패치/자료버전 다르면 보류, source/date/누락 표시.
5. **다음 세트 남은 관측 풀**: 선수·원팀·역할의 전체 연간 챔피언 목록에서 이전 세트 양팀 픽 + 현재 세트 양팀 픽을 잠근다. 현재 밴은 다음 세트 초기화하므로 제외하지 않는다. 별칭 정규화. available/observed-unique, 남은 챔프(빈도순, 접기/전체 보기)를 비교. unknown을0으로 계산하지 않음. 선수 교체 시 집합/표본 차이지 실력 우위가 아님. 챔피언 이름 몇 개/원시 횟수 차이를 정해진 한국어 문장으로 설명, '유리/승리/숙련도/강함' 추정 금지.
6. 비교 파일 **schema3**는 역할 기록(있으면 검증된 team→role→champion, 없으면 명시 null)을 포함해 재현한다. v1/v2 계속 읽기 전용 호환, 없는 역할을 현재 역할로 채우지 않음. 기존 로스터·초기 드래프트 v2/v3 파일은 변경하지 않는다. 역할 diff 재계산/잘못된 역할·중복·다른team픽·입력과 다른 역할기록 거부. **연간 추가 참고는 이번 파일에 미포함**임을 화면/파일 boundary로 명시. 연간 수치 재현을 저장했다고 쓰지 않는다.
7. 최소 module 분리: comparison-player-evidence.ts(순수 비교), comparison-player-evidence-panel.tsx(지연로드/UI) 등 권장. existing year loader(15초 제한/basis/외부abort) 재사용. key/cancel/닫기/새입력/언마운트 늦은응답 안전. 같은 basis라면 검증 파일 재사용하되 행은 현재 A/B로 재계산. 오류에도 밴픽/로스터/A/입력준비/기기저장 보존.

## 소유

위 새 module/component/style, draft-comparison.ts/panel.tsx, simulation-readiness-panel.tsx(콜백), draft-lab.tsx(콜백/탭 CTA), 필요한 simulation-scenario.ts helper export, 관련 단위/E2E만. player-season-history.ts/model/워크플로/자료/package.json은 수정 금지. 코드 commit/push/merge/deploy 금지.

## 검사

- 단위: A frozen 복사, 같은 챔프 다른선수, 같은선수 다른챔프/역할, 가상원팀/동명이인, role0/미확인/관측0, alias, 다음세트 현재밴 해제·현재양팀픽 잠금·기존잠금 합집합, side swap 팀ID 비교, pair/basis불일치, v1/v2역할없음·v3역할변조, 재현시 현재상태불변.
- 새 E2E desktop/mobile: 역할입력→A고정→선수/챔프 또는역할변경→B근거차이→추가연간자료 open요청/출처→닫기/오류/재시도→v3저장/재현. 기존 A/B/준비 입력 관련 helper도 새 역할/버전에 맞게 갱신하되 검증삭제하지 않는다.
- UI 표는 모바일 카드/짧은 설명, 오버플로0. main페이지/사이드탭 구조 유지.
- 관련 단위 먼저. 권한 막힌 명령은 반복/우회하지 말고 부모 실행으로 보고. 전체 E2E 반복 금지. runner 연결 package.json은 부모 담당.
- docs/AB_PLAYER_EVIDENCE_RESULT.md에 실행한/작성만한 검사·원자료미포함 한계를 구분한다.
