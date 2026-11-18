# C3b — 시뮬레이션 입력 준비 (승패 계산 연결 전)

2026-11-17 사용자 자동 진행 지시. Opus 5.5 Medium. 앞 배치 결과는 docs/ROSTER_COMPARISON_RESULT.md.
토큰 한도 오류가 나면 호출/모델 변경/유료 전환 없이 상태를 기록하고 멈춘다. commit/push/merge/deploy 금지.

## 제품 목적

완료된 드래프트 + 실제 편집된 양 팀 로스터 + **명시적 챔피언 역할 배정**을 고정하는 입력 관문.
픽 순서에서 TOP/JUNGLE/MID/BOTTOM/SUPPORT를 추정하지 않는다. 아직 실제 효과/예측으로 보이지 않게 한다.
부모의 simulation-core.ts는 가정 기반 내부 실험이며 이번 UI에서는 호출하거나 승자를 보여주지 않는다.

읽기: roster-comparison.ts, draft-comparison.ts, draft-lab.tsx(liveRoster), roster-scenario.ts, simulation-core.ts(읽기만), 관련 단위/E2E.
소유: 새 web/app/simulation-scenario.ts + simulation-readiness-panel.tsx/.css, draft-lab.tsx(새 패널 연결), 새 단위/E2E, docs/SIMULATION_READINESS_RESULT.md. 다른 기존 app 파일·package.json 수정 금지. Codex는 draft-session.ts 저장 기한 및 engine 파일과 이전 배치 검사를 담당한다.

## 요구

1. 메인 모의 밴픽 영역 맨 아래에 기본 접힘 '시뮬레이션 입력 준비'를 둔다. 완료 전에는 간단한 미충족 안내. 큰 설명을 상단에 추가하지 않는다. 한국어 먼저.
2. 두 팀 각각 5역할에 **현재 그 팀이 픽한 5챔피언만** 직접 선택하는 컨트롤. 역할당 하나, 챔피언 중복/누락 금지. 이름/다른 팀 픽/밴/이전 세트에서 가져오지 않는다. 빈 로스터는 미완성으로 보고 준비 확정 막기.
3. 현재 실제 liveRoster와 같은 report의 index로 재검증한다. 팀/선수 ID와 source_team_id를 보존. source pair/basis 변경·draft reset/import/side swap 뒤 오래된 역할 배정을 현재 입력으로 잘못 붙이지 않는다. 역할 매핑은 팀ID 기준, 유효성은 매번 현재 픽과 비교.
4. 입력을 고정하면 detached 스냅샷에 report의 patch/cutoff/source versions, 로스터 근거 범위 CURRENT_REPORT_PLAYER_OBSERVATIONS, 해당 드래프트/이전 세트/firstPickSide, 팀ID별 챔피언 역할 배정이 들어간다. draft-comparison의 기존 replay-validation 재사용. v2 비교나 v2/v3 draft-session 형식은 변경하지 않는다.
5. 새 manager-scenario 파일 schema1로 내보내고 **읽기 전용** 재현한다. report 자체를 하나만 포함하고 입력을 다시 검증. 16MB 제한, unknown version/불명ID/중복/다른team/basis/규칙 위반/변조된 준비결과 거부. 재현이 현재 로스터·밴픽·A 기준·기기 저장을 바꾸지 않아야 한다. 재현 후 '현재 입력과 같음/다름'은 입력정체성을 대조하되 승패는 계산하지 않는다.
6. 화면: '역할은 사용자 배정', '선수 근거는 현재 관측; 연간 자료 미포함', '학습된 선수/챔피언 효과·상성·룬·아이템·실제 승률은 아직 계산하지 않습니다.' 내부 테스트 엔진의 승자를 제품 예측으로 노출하지 않는다.
7. 새 패널·파일 가져오기 unmount/늦은 read 안전성, 비정상/과대 파일에서도 현재 작업 유지. 실수로 메인 밴픽 controls를 막지 않는다.

## 검증

새 단위: 미완료draft/빈slot/중복rolechamp/다른teamchamp/없는player/basis변경/first-selection/피어리스 이전세트, frozen 복사, 파일재현변조/구버전거부.
새 E2E: desktop/mobile 20턴→명시적 배정→준비고정→JSON 재현→슬롯 변경 뒤 현재와다름→가져와도 작업보존. incomplete 안내도 확인.
우선 관련 단위만 실행. npm/type/lint/build/E2E 권한이 막히면 반복 호출/우회하지 말고 부모가 실행하도록 보고. 전체 E2E 재실행 금지.
새 테스트 runner 연결은 부모가 package.json에서 한다. 결과 문서에 실행된 것과 작성만 한 검사를 분리한다.
