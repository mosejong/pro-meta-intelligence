# A/B 선수·챔피언 관측 근거 연결 — 결과 (2026-11-18, Opus 5.5)

Codex 통합 검토용. 코드 commit/push/merge/deploy 없음. `package.json`, `player-season-history.ts`, 모델·워크플로·자료는 수정하지 않았다.

**최종 부모 검증:** [통합 검토](AB_PLAYER_EVIDENCE_REVIEW_2026-11-18.md). 아래 미실행 표는 Claude 구현 시점의 기록이다. 이후 Codex가 runner를 연결하고 웹180/180, 타입·린트, Pages4/4, PC·모바일34개 고유 UI 시나리오 및 독립 실제 자료 대조를 완료했다.

## 1. 실행 여부 (중요)

이 세션에서는 **타입체크·린트·단위·E2E를 하나도 실행하지 못했다.** `npm run typecheck`, `npx tsc`, `npm test`, Playwright 명령이 모두 권한 승인 대기("requires approval")로 막혔다. 지시에 따라 반복하거나 우회하지 않았다. 아래 검사는 **작성만 했고 실행 결과는 없다.** 부모가 실행해야 한다.

| 검사 | 상태 |
|---|---|
| `npm run typecheck` | 미실행(권한). 수동 타입 검토만 함 |
| `npm run lint` | 미실행(권한) |
| `node --test tests/draft-comparison.test.mjs` (갱신) | 작성, 미실행 |
| `node --test tests/comparison-player-evidence.test.mjs` (신규) | 작성, 미실행. **`package.json` test 목록에 아직 없음 → 부모가 연결** |
| `node --test tests/simulation-scenario.test.mjs tests/simulation-player-evidence.test.mjs` (회귀) | 미실행. champion-roles 분리로 import 경로가 바뀌었으나 재export로 공개 API는 동일 |
| `tests/e2e/ab-player-evidence.spec.mjs` (신규, desktop·mobile-width) | 작성, 미실행 |
| `tests/e2e/roster-workshop.spec.mjs` (schema "2"→"3", `champion_roles` null 확인 추가) | 갱신, 미실행 |

권장 실행 순서(부모): `npm run typecheck` → `npm run lint` → `npm run build` 후 `node --test tests/draft-comparison.test.mjs tests/comparison-player-evidence.test.mjs tests/simulation-scenario.test.mjs tests/simulation-player-evidence.test.mjs` → `npx playwright test tests/e2e/ab-player-evidence.spec.mjs tests/e2e/roster-workshop.spec.mjs tests/e2e/simulation-player-evidence.spec.mjs` (전체 E2E 반복은 하지 않음).

## 2. 변경 파일

- 신규 `web/app/champion-roles.ts`: `validateRoles`/`teamPicks`/`championKey`/역할 타입을 simulation-scenario에서 그대로 옮김(draft-comparison↔simulation-scenario 순환 import 방지). simulation-scenario는 같은 이름으로 재export.
- `web/app/draft-comparison.ts`
  - 스냅샷 `roles: TeamRoles | null`: 현재 세트 팀 픽으로 검증한 분리 사본.
  - `draftRosterKey` 추가: 역할을 제외한 밴픽·로스터·데이터 키.
  - `compareRoles` 추가: `NOT_RECORDED`(missing A/B), `PAIR_CHANGED`, `COMPARED`.
  - schema 3: `champion_roles`(팀 ID 정렬 객체 또는 명시적 null)와 `comparison.roles`를 기록한다. 경계 문구에 "연간 수치는 파일에 포함·재현되지 않음"을 넣었다.
  - v1/v2 재현:
    - 그대로 읽기 전용이다.
    - `champion_roles`가 있으면 거부하고, 현재 역할로 채우지 않는다.
- `web/app/simulation-readiness-panel.tsx`: `onReadyInputChange`.
  - 최신 콜백은 ref로 잡는다.
  - `sameSimulationInput`으로 중복을 제거하므로, 콜백 identity나 타이머로 인한 재렌더에서는 다시 알리지 않는다.
  - 준비되지 않았거나 언마운트되면 null을 보낸다. 알릴 때는 structuredClone 사본을 보낸다.
- `web/app/draft-lab.tsx`: `readyInput` 상태를 추가하고 `DraftComparisonPanel`에 다음을 전달한다.
  - `readyInput`, `publicationRoot`
  - `onOpenRoleAssignment`: 시뮬레이션 탭으로 전환하고 첫 역할 select에 포커스한다.
- `web/app/draft-comparison-panel.tsx`
  - 준비 입력의 `evidenceIdentity`와 `draftRosterKey`가 현재 B와 정확히 같을 때만 B에 역할을 붙인다. 따라서 한 렌더 전의 준비 입력은 새 B에 붙지 않는다.
  - A 고정 시 B 스냅샷(역할 포함 사본)이 그대로 A가 되므로, 이후 수정이 A를 소급 변경하지 않는다.
  - A·B 역할 상태를 표시한다("역할 배정 기록 없음"). 역할 차이 표를 추가했고, 재현 v1/v2에는 "기록되지 않음, 현재 역할로 채우지 않음"을 표시한다.
  - `diff.ok`일 때만 근거 섹션을 넣는다.
  - 경계 문구에 "연간 자료는 비교 JSON에 포함되지 않음"을 추가했고, 기존 문구는 유지했다.
- 신규 `web/app/comparison-player-evidence.ts` (순수)
  - `compareAssignedEvidence`는 기존 `assignedChampionEvidence`를 A·B에 각각 적용한다.
  - `nextSetLocks`: 이전 세트 잠금 ∪ 이번 세트 양 팀 픽이다. 이번 밴은 제외한다.
  - `nextSetPool`, `annualText`, `explainRow`: 고정 한국어 문장만 쓴다.
- 신규 `web/app/comparison-player-evidence-panel.tsx` + `.css`
  - 기본은 접힌 `<details>`다. A·B 모두 역할 기록이 있고 사용자가 열거나 "불러오기"를 눌렀을 때만 요청한다.
  - 기존 로더를 쓴다(15초 타임아웃, 기준 검사, 외부 abort). basis별로 모듈 캐시를 두며 실패는 캐시하지 않는다.
  - 닫기·키 변경·언마운트 시 abort하고, 늦은 응답은 버린다.
  - 행은 매 렌더 현재 A/B로 다시 계산한다.
  - 모바일은 1열 카드다.

## 3. 동작 요약

- 역할이 없으면 섹션에서 다음을 안내한다.
  - A·B 중 어느 쪽이 없는지 보여 준다.
  - "입력이 준비된 상태로 기준 A를 다시 고정해야 A에 역할이 기록"된다고 알린다.
  - 픽 순서로 추정하지 않는다고 밝힌다.
  - CTA(시뮬레이션 준비 탭 전환)를 둔다.
- 기본 픽·밴·로스터 비교와 저장·재현은 역할 없이도 그대로 동작한다.
- 연간 자료는 "현재 추가 참고"로만 쓴다. 지금 불러온 하나의 검증 파일로 A와 B를 각각 다시 집계하며, A 고정 당시 자료라고 주장하지 않는다.
- 다음 경우에는 비교를 보류한다: 분석 데이터(패치·기준 시각·모델) 불일치, 파일 basis 불일치, 팀 조합 변경.
- 출처 줄에는 다음을 표시한다.
  - 출처 ID, 원본 취득일, 집계 기간, 검증 통과·원본 제외 경기 수, 참조 패치
  - 원본이 분석 기준 시각보다 오래되었는지 여부
  - "올해 모든 실제 경기는 아님", "파일에 없는 선수는 0이 아니라 확인 불가"
- 행(팀 ID·역할 기준; 진영 교체도 팀 ID로 맞춘다)마다 다음을 보여 준다.
  - A→B 선수·챔피언
  - 연간·최근 20·패치 횟수와 분모
  - 원시 횟수 차이
  - 다음 세트 남은 관측 풀(가능/관측 종류, 경기 수순 목록 접기)
  - 같은 선수일 때 새로 잠김·다시 열림
- 선수 상태는 섞지 않는다: 미확인(UNCONFIRMED)·빈칸(EMPTY)·역할 0경기(ZERO_IN_ROLE)·관측 0회(OBSERVED 0/n)를 각각 구분한다.
- 선수 교체는 "서로 다른 선수의 표본, 실력 비교가 아님"으로 표시한다. 유리/승리/숙련도/강함 같은 표현은 쓰지 않는다(소스 검사 포함).

## 4. 한계

- 연간 원자료는 A/B 파일에 들어가지 않는다. 파일 재현은 픽·밴·로스터·역할 차이까지만 하며, 화면에도 "연간 선수·챔피언 기록은 비교 파일에 없으므로 재현하지 않습니다"라고 명시한다.
- 연간 파일은 해당 원팀·선수 ID의 해당 역할 경기만 센다. 이적 전후의 다른 팀 ID 기록은 합치지 않는다.
- 다음 세트 풀은 관측 목록 기준이다. 관측하지 않은 챔피언이나 실제 가용성(패치·제재)은 판단하지 않는다.
- 역할은 사용자가 배정한 값만 쓴다. 준비 입력이 없으면 B 역할은 null이다.
- 위 1절대로 모든 검사는 미실행이다. 특히 E2E에서 확인이 필요한 점:
  - 선택자와 상태 문구: `data-*` 속성, "연간 자료 불러오기" 버튼 흐름
  - CTA 포커스: 첫 활성 select = 블루 탑
- `package.json` test 목록에 `tests/comparison-player-evidence.test.mjs` 추가가 필요하다(부모 담당).
