# C3d — 배정 챔피언의 실제 선수 관측 근거

2026-11-17 자동 진행, Opus 5.5 Medium. C3b 코드/결과 재사용. 토큰 한도 시 기록 후 중단, 유료 설정/모델 우회/commit/push/배포/새 소스 금지.

현재 시뮬레이션 입력 준비는 10선수+역할별 챔피언을 직접 배정한다. 다음은 **현재 배정한 그 챔피언을 해당 선수가 해당 역할에서 얼마나 사용했는가**를 연간 자료로 확인하는 기능이다. 숫자를 효과/승률로 바꾸지 않는다.
이전 Elo+draft 실험은 추가효과 미입증이다. 그 실험 가중치를 웹에 넣지 않는다. simulation-core.ts도 호출하지 않는다.

읽기 최소: simulation-readiness-panel.tsx, simulation-scenario.ts, player-season-history.ts, player-season-panel.tsx(기한/캐시/취소 패턴), player-season-history.test.mjs, e2e/player-season.spec.mjs.
소유: 새 simulation-player-evidence.ts(+필요한 component), simulation-readiness-panel.tsx/.css, draft-lab.tsx의 publicationRoot prop 1개, 새 단위/E2E, docs/SCENARIO_PLAYER_EVIDENCE_RESULT.md. 다른 기존 파일/스키마/package.json 수정 금지.
부모는 ops/draft_outcome_baseline.py 및 결과의 교차검증·커밋 중이다.

## 요구

1. readiness 패널 안 **현재 입력이 준비된 경우**에만 기본 접힘 '배정 챔피언의 선수 기록'을 둔다. 사용자가 열 때 기존 history/player-season-2026.json만 지연 로드. root/하위route 경로는 publicationRoot 전달로 기존 패턴 사용.
2. snapshot.draft.roster.teams의 정확한 (source_team_id,player_id)와 snapshot.roles[team_id][role]로 매칭. 다른 팀 관측은 source team 의미를 보존. 동명이인/현재 가상 소속/role순서 추정으로 합치지 않는다.
3. 연간/최근20/참조패치 각각 **해당 역할에서 고른 횟수 / 해당 역할 범위 경기 수**. 같은 챔피언 alias는 기존 championKey 사용. 다른 역할 경기와 섞지 않는다. 어떤 역할의 실제 모든 champ목록에서 빠진 champion은 검증된 complete history일 때만0. FOUND but role 없음은 역할0경기. player미확인/MISSING/다른basis/file실패는 '자료 없음/확인 불가', 0으로 표시하지 않는다.
4. 전체 시즌/최근20의 정의는 '해당 선수-출처팀-포지션' 기존 파일의 범위 그대로. 현재 reference patch와 자료수집일/마지막유효경기/642제외 등 기존 source/import_summary를 표시해 '올해 전체 실제경기 전부'라고 하지 않는다.
5. 로딩/timeout/오류/재시도, 닫기/다른snapshot/unmount 시 취소, 늦은응답 차단. 기존 loadPlayerSeasonHistory의 15초 기한을 재사용. 입력이 바뀌어도 같은 basis의 검증된 history는 재사용 가능하지만 선수/역할/챔피언 매핑은 항상 현재 준비입력을 따른다. 새로 고른 선수 자료에 이전 선수 결과가 표시되면 안 된다.
6. **현재 입력 추가 참고**이며 frozen입력/manager-scenario 파일/A/B 파일에는 연간 자료가 포함되지 않는다는 문구. 이번에 스키마 변경하지 않는다. 입력고정/JSON저장/기존밴픽·기기저장 건드리지 않는다. 펼친 뒤 현재 입력이 미준비가 되면 오래된 행을 현재근거로 보여주지 않는다.
7. 한국어만. 모바일 폭 overflow/큰 표 대신 역할 카드 또는 기존스타일을 재사용. 설명은 패널내 최소한, 메인상단에 추가 금지.

## 검사

단위: 동일champ0과positive, role0, missingplayer/nullhistory, basis불일치, source team 다른가상배정, aliases, 스냅샷/기록불변.
E2E desktop/mobile: 요청열기전0회→열면1회, 현재선수교체로행갱신, HTTP404/다른basis/기한/재시도 상태, 닫기후늦은응답, 밴픽/고정입력/기기저장보존. 필요한 2~3개 시나리오에 묶고 전체 E2E 반복 금지.
관련 단위부터 실행. 권한 막힌 npm/브라우저 명령은 우회하지 말고 보고, 부모가 검사. package.json 연결도 부모가 한다.
결과에 실제검사와 작성만한검사·남은한계를 분리한다.
