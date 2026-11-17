# C3b 시뮬레이션 입력 준비 — 결과 (2026-11-17, Opus 5.5)

승패 계산 연결 전 단계. `simulation-core.ts`는 읽기만 했고 호출하지 않는다. 화면·파일 어디에도 승자/결과 필드가 없다.
commit/push/merge/deploy 하지 않음.

## 변경 파일

| 파일 | 내용 |
| --- | --- |
| `web/app/simulation-scenario.ts` (신규) | 준비 검증·detached 스냅샷·입력 정체성·`manager-scenario` schema 1 내보내기/읽기 전용 재현 |
| `web/app/simulation-readiness-panel.tsx/.css` (신규) | 기본 접힘 `<details>` '시뮬레이션 입력 준비' |
| `web/app/draft-lab.tsx` | import 1줄 + A/B 비교 패널 바로 아래(모의 밴픽 탭 맨 아래)에 패널 연결. `key=sim-${comparisonEpoch}` → import/복원 시 재마운트 |
| `web/tests/simulation-scenario.test.mjs` (신규) | 단위 |
| `web/tests/e2e/simulation-readiness.spec.mjs` (신규) | E2E (desktop/mobile-width 두 project에서 자동 실행) |

기존 `draft-comparison.ts`, `roster-comparison.ts`, `roster-scenario.ts`, `draft-session.ts`, `package.json`은 수정하지 않음.

## 설계 요점

- **검증 재사용**: `buildSimulationReadiness`는 `buildDraftComparisonSnapshot`(20턴 규칙 재생, report의 팀 레코드, 피어리스 이전 세트, `captureRoster`로 같은 report index 기반 선수 ID·중복·basis 검증)을 그대로 호출하고, 그 위에 (a) 로스터 10칸 모두 채움, (b) 역할 배정만 추가로 검사한다.
- **역할 배정**: 팀 ID → `{TOP..SUPPORT: championAssetId}`. 허용 값은 그 팀이 **현재 진영에서 이번 세트에 픽한 5개**뿐(`teamPicks`). 미배정(`ROLE_UNASSIGNED`), 다른 팀 픽/밴/이전 세트/이름(`ROLE_NOT_TEAM_PICK`), 중복(`ROLE_DUPLICATE`), 키 불일치(`ROLE_SHAPE`) 거부. 픽 순서로 자동 채우지 않는다.
- **오래된 배정 방지(UI)**: 패널 상태는 팀ID별 `{context, roles}`. context = report basis + 팀 쌍 + 그 팀 진영 + firstPickSide + 이전 세트 수 + 그 팀 픽 목록. context가 다르면 빈 배정으로 보이고, 유효성은 매 렌더 현재 픽과 대조. side swap/리셋/언두로 픽이 바뀌면 옛 배정은 붙지 않는다. import/복원은 재마운트로 전부 폐기. (같은 팀이 같은 진영·같은 순서로 동일 5챔프를 다시 픽하면 동일 입력이므로 배정이 되살아난다 — 의도된 동작.)
- **스냅샷**: patch/cutoff/fixtureOnly/정렬된 source versions, `rosterEvidenceScope=CURRENT_REPORT_PLAYER_OBSERVATIONS`, `roleSource=USER_ASSIGNED`, 드래프트(이전 세트·firstPickSide·선택 20개·로스터 캡처), 팀ID별 역할. 전체를 `deepFreeze`한 detached 사본. 메모리에만 있고 자동 저장하지 않음.
- **입력 정체성**: `sameSimulationInput` = evidenceIdentity 동일 && canonical key(팀 by side, 선픽, 이전 세트, 선택, 로스터 ID, 역할) 동일. 승패는 비교하지 않음.
- **파일 `manager-scenario` schema 1** (숫자 1만 허용): 최상위/`input` 키 정확 일치(추가 `winner` 등 거부), report는 `analysis_snapshot` 하나만, patch/cutoff/source versions 대조, 팀 이름·선수 이름 라벨 대조, `parseRosterExport`로 근거 범위 확인, 재검증 후 `readiness` 레코드(상태·role_source·scope·`season_history_included:false`·`outcome_computed:false`·세트 번호·team_ids·입력 fingerprint) 재계산 일치 요구 → 합법적이지만 바뀐 입력(역할 맞바꿈 등)도 '준비 결과 불일치'로 거부. fingerprint는 FNV-1a 2회의 **일관성 검사이지 보안 서명이 아님**. 16MB는 메타데이터로 먼저 거부.
- **안전성**: 파일 읽기는 토큰 기반 — 닫기/새 파일/언마운트 뒤 늦게 끝난 read는 버림. 재현은 패널 내부 상태만 바꾸며 밴픽·로스터·기준 A·localStorage를 건드리지 않음. 실패 시 이전 재현 결과를 지움. 패널은 일반 흐름의 `<details>`라 메인 밴픽 컨트롤을 덮거나 inert로 만들지 않음. 역할 select는 `!canSelect`(가져오기 중 등)일 때만 비활성.
- 문구(한국어): '역할은 사용자 배정', '선수 근거는 현재 관측이며 연간 자료는 포함하지 않습니다', '학습된 선수/챔피언 효과·상성·룬·아이템·실제 승률은 아직 계산하지 않습니다.' — 패널 안 note 한 줄. 상단 설명 추가 없음.

## 검증

### 실행함
- `node --test tests/simulation-scenario.test.mjs tests/draft-comparison.test.mjs tests/roster-scenario.test.mjs` → **40/40 통과** (신규 14개 포함: 미완료 draft, 빈 slot/빈 로스터, 없는 player·중복 player·basis 변경·다른 팀 쌍 로스터, 미배정/중복/다른 팀/밴/이름/잘못된 팀키 역할, side swap, first-selection RED, 피어리스 이전 세트, frozen detached 복사, 입력 동일/다름, export→replay, 변조·구/미래 버전·문자열 버전·추가 필드·규칙 위반 거부, 과대/읽기 실패 파일, SSR 패널 접힘·미충족 안내·문구·승자 미표시·자동 배정 없음).

### 작성만 함 (부모 실행 필요)
- `tests/e2e/simulation-readiness.spec.mjs`: (1) 미완료 안내 + 패널 열린 상태에서 메인 밴픽 조작 가능, (2) 20턴 → 로스터 빈칸 명시 채움 → 명시적 역할 배정(중복 시 이동 확인) → 고정 → JSON 저장 → 재현 '현재 입력과 같음' → 로스터 슬롯 변경 뒤 '현재 입력과 다름' → 미래 버전/변조/불명 선수/깨진 JSON 거부 시 밴픽·로스터·localStorage·A/B 버튼 보존. 실행 안 함(지시대로 전체 E2E 재실행 금지, build:pages 필요).
- `tsc --noEmit`, `eslint`: 이 세션에서 권한 승인이 필요해 **실행하지 못함**. 반복 시도하지 않았다. 부모가 실행해 주세요.
- package.json `test` 스크립트에 `tests/simulation-scenario.test.mjs` 연결은 부모 몫.

## 부모 검토·통합 결과

- 이전 세트 챔피언 순서는 같고 진영 소유권만 다르면 입력 정체성이 같아지던 결함을 Codex가 수정했다. key에 이전 선택 side/kind/slot을 포함하고 기존 준비 레코드 거부 반례를 추가했다.
- 최종 단위 15/15, 빌드 포함 웹 158/158 통과. typecheck/lint 및 Pages 4/4 통과(입력 key 추가 직전 실행).
- Chrome PC·모바일 폭 입력 준비+저장 장애 E2E 8/8 통과. 이 E2E는 입력 key 보완 직전 빌드이며 소유권 반례는 보완 뒤 단위·전체 검사로 확인했다.
- 캡처 `outputs/simulation-readiness-20261117/desktop.png`, `mobile.png`. 로스터/패널을 의도적으로 펼친 검증 화면이며 기본 진입에서는 둘 다 접혀 있다.
- 로그 `outputs/simulation-readiness-*-20261117.log`.

## 남은 주의점
- 역할 배정은 메모리 전용(새로고침 시 사라짐). 기기 저장은 이번 범위 밖.
- 로스터가 기본 관측으로 10칸이 채워지지 않는 팀은 사용자가 로스터 편집에서 채워야 준비 가능.
