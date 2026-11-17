# C3d — 배정 챔피언의 실제 선수 관측 근거 (결과)

2026-11-17 · Opus 5.5 · 커밋/푸시/배포 없음

## 무엇을 만들었나

시뮬레이션 입력 준비 패널 안, **현재 입력이 준비된 경우에만** 기본 접힘 `배정 챔피언의 선수 기록`이 나타난다.
펼칠 때만 기존 `history/player-season-2026.json`을 기존 `loadPlayerSeasonHistory`(15초 기한·basis 검증)로 불러온다.

각 팀·역할 카드: `역할 · 배정 챔피언 · 선수 (원팀 기록 · 가상 배정 여부)` + `연간 a/b경기 · 최근 20 a/b경기 · 패치 X a/b경기`
(a = 그 역할 경기에서 배정 챔피언을 고른 횟수, b = 그 선수-원팀-역할의 범위 경기 수). 효과·승률·가중치는 없음.

| 상태 | 조건 | 표시 |
|---|---|---|
| OBSERVED | FOUND + 해당 역할 기록 | a/b. 검증된 complete 목록에 없는 챔피언은 0/b |
| ZERO_IN_ROLE | FOUND, 해당 역할 기록 없음 | `역할 0경기` + 다른 역할 연간 경기(합치지 않음) |
| UNCONFIRMED | 파일에 (원팀,선수 ID) 없음 / NOT_FOUND / UNSUPPORTED_ID | `자료 없음/확인 불가 (0경기 아님)`, 숫자 없음 |
| 오류 | HTTP 실패, 다른 basis, 형식 오류, 15초 초과 | `연간 자료 확인 불가: …` + 다시 불러오기, 행 없음 |

- 매칭: `snapshot.draft.roster.teams[team_id][role]`의 정확한 `(source_team_id, player_id)` → `playerKey`, 챔피언은 `snapshot.roles[team_id][role]`. 이름·현재 가상 소속·역할 순서로 합치지 않는다. 다른 팀에서 관측된 선수는 원팀 이름과 `가상 배정`을 함께 표시한다.
- 챔피언 alias: `player-pool-evidence.championKey`(파서와 같은 함수).
- 출처 줄: 원본 취득일, 집계 경기 기간(마지막 유효 경기), 검증 통과 경기 수, 원본 제외 N경기(현재 642), 참조 패치, "같은 원팀·선수 ID의 해당 포지션 경기만 세며 올해 모든 실제 경기는 아닙니다".
- 문구: "현재 입력 추가 참고입니다. 고정 입력·입력 JSON(manager-scenario)·A/B 파일에는 연간 자료가 포함되지 않으며, 횟수는 효과나 승률이 아닙니다."
- 요청 수명: 닫기·basis 변경·언마운트(패널 key 재마운트 포함) 시 abort, 늦은 응답은 key/abort 확인으로 폐기. 검증된 파일은 (url, basis)별 모듈 캐시로 재사용하고 실패는 캐시하지 않는다. 행은 매 렌더 현재 snapshot에서 다시 계산하므로 선수/역할/챔피언 교체 시 이전 선수 숫자가 남지 않는다.
- 펼친 상태에서 입력이 미준비가 되면 `현재 입력이 준비되지 않아 선수 기록을 표시하지 않습니다`만 보이고 행은 없다. 다시 준비되면 캐시로 즉시 현재 입력 기준 행이 나온다.
- 스키마·입력 고정·JSON 저장·밴픽·기기 저장·simulation-core 미접촉. Elo+draft 가중치 미사용.

## 변경 파일

- 새 `web/app/simulation-player-evidence.ts`: 순수 매칭 `assignedChampionEvidence`, `historyFitsSnapshot`
- 새 `web/app/simulation-player-evidence-panel.tsx`: 지연 로드 `<details>` 컴포넌트
- `web/app/simulation-readiness-panel.tsx`: 컴포넌트 삽입, optional `publicationRoot` prop(기본 `./`)
- `web/app/simulation-readiness-panel.css`: 역할 카드 스타일, 720px 이하 1열
- `web/app/draft-lab.tsx`: `publicationRoot={productRootHref(currentSpace)}` 1개 prop 추가
- 새 `web/tests/simulation-player-evidence.test.mjs`, 새 `web/tests/e2e/simulation-player-evidence.spec.mjs`

## 실제 실행한 검사

- `node --test tests/simulation-player-evidence.test.mjs` → **7/7 통과**
  (positive 18/25·14/20·2/2, 같은 선수 미관측 챔프 0/25·0/20·0/2, Wukong↔MonkeyKing alias, FOUND·역할없음 = 0경기 + 다른역할 분리, NOT_FOUND/파일에 없음/빈칸 = 숫자 없음, 동명이인 다른 팀 미병합, 가상 이동 선수 원팀 유지·가상팀 ID로는 미확인, basis/cutoff/patch 불일치 거부, snapshot·history 불변, 선수 교체 시 이전 숫자 없음)
- `node --test tests/player-season-history.test.mjs tests/simulation-scenario.test.mjs` → **25/25 통과** (기존 회귀)

## 작성만 하고 실행하지 못한 검사 (권한 승인 필요 → 부모가 실행)

- `tsc --noEmit` 타입 검사: 명령 승인 필요로 미실행. 수동 검토만 함.
- `vite build --config vite.pages.config.ts` 및 Playwright: 승인 필요로 미실행. 새 TSX는 빌드/트랜스파일로도 확인하지 못했다.
- `tests/e2e/simulation-player-evidence.spec.mjs` (desktop·mobile-width 두 프로젝트)
  1. 열기 전 0회 → 열면 1회, 행 값(7/20, 패치 0경기, ZERO_IN_ROLE, UNCONFIRMED 숫자 없음), 642 표시, 고정 입력·기기 저장·A/B 버튼·진행 20 보존, overflow 없음, 파란 MID 선수 교체 → 0/5로 갱신(요청 추가 없음), 역할 하나 비우면 not-ready·행 0, 복구 시 캐시로 행 복귀.
  2. 404 → 다른 basis → 15초 기한(clock) → 재시도 → 로딩 중 닫기 후 늦은(stale basis) 응답 폐기 → 다시 열면 정상 행·alert 0, 총 5회 요청, 밴픽·로스터·기기 저장 보존.
- package.json `test` 목록에 새 단위 테스트 연결은 부모 몫(수정 금지 범위).
- 기존 `simulation-readiness.spec.mjs`는 패널 note 문구를 검사하는데 그 문구는 바꾸지 않았다. 다만 E2E 전체 회귀는 실행하지 않았다.

## Codex 통합 검토 — 2026-11-18

- Claude 결과를 확인하고 기존 실행을 중복 호출하지 않았다. 선수·출처팀 ID 매칭, 포지션별 분모, 0과 미확인 분리, basis/취소/캐시 경로를 검토했다.
- 오래된 원본의 의미가 날짜만으로 묻히지 않게 '원본이 분석 기준 시각보다 오래되어, 원본 취득 이후 경기는 포함하지 않습니다'를 화면에 추가했다.
- 기본 test runner에 새 단위를 연결했다. 빌드 포함 웹 **165/165**, typecheck/lint, Pages **4/4** 통과.
- Chrome PC·모바일 폭 새 선수 기록/기존 입력 준비 **8/8** 통과. 지연 로드·선수 변경·입력 미준비·HTTP404·다른 basis·기한·재시도·닫기 뒤 늦은 응답·작업/기기저장 보존을 확인했다.
- 합성 자료만 확인하지 않고 **실제 player-season-2026.json**을 `/draft/` 하위 경로에서 추가 확인했다. 두 진영 10역할의 원팀·선수 ID를 직접 조회하고 챔피언 횟수/역할 범위 분모를 독립적으로 대조한 Chrome **2/2** 통과(PC·모바일 폭). 공유 helper의 집계 함수를 다시 호출해 같은 결과를 비교한 검사는 아니다.
- 실제 자료 캡처 `outputs/scenario-evidence-20261118/{desktop,mobile}-real.png`, 합성 장애/숫자 캡처는 `*-fixture.png`로 구분한다. 합성 숫자를 실제 경기 기록으로 소개하지 않는다.
- 로그 `outputs/scenario-evidence-{full-web,typecheck,lint,pages,e2e,real-e2e}-20261118.log`. 기존 Python331 통과 결과는 앞 배치 것이고 이번에는 Python 변경이 없어 재실행하지 않았다.

## 남은 한계 (통합 뒤)

- 캐시는 `player-season-panel.tsx`의 모듈 캐시와 별개다(그 파일 수정 금지). 두 섹션을 모두 열면 같은 파일을 최대 2회 요청한다.
- 최근 20·참조 패치 범위는 파일이 선수-원팀-포지션 단위로 정의한 범위 그대로다. 역할 내 최근 20경기이며 시즌 전체 최근 20경기가 아니다.
- 참조 패치 경기가 0이면 `패치 X 역할 0경기`로 표시된다(선수 FOUND·역할 기록 있음일 때만).
- 원본이 기준 시각보다 오래되면 `data-source-older`만 표시하고 문장으로 따로 강조하지 않는다(취득일은 출처 줄에 있음).
- 숫자는 관측 횟수일 뿐이며 효과·승률·숙련도로 해석하지 않도록 문구만 둔다. 시뮬레이션에는 연결하지 않았다.
