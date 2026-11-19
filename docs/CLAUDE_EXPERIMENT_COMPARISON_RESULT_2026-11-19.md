# 가정 실험 A/B 비교 · Claude 구현 결과 (2026-11-19)

작업 지시: `docs/CLAUDE_EXPERIMENT_COMPARISON_TASK_2026-11-19.md`. 커밋·푸시·배포·패키지 추가 없음. Codex 독립 검증 대상.

## 변경 파일

| 파일 | 내용 |
|---|---|
| NEW `web/app/experiment-comparison.ts` | 순수 비교기 `detachRun` / `freezeBaseline` / `compareExperimentRuns` |
| NEW `web/app/experiment-comparison-panel.tsx`, `.css` | 실험 패널 안의 접힌 `<details>` 보조 기능 |
| `web/app/experiment-replay-panel.tsx` | import 1줄 + 결과 아래 `<ExperimentComparisonPanel run shownMinute readyInput />` 1줄 |
| `web/package.json` | `test` 목록에 `tests/experiment-comparison.test.mjs` 추가만 |
| NEW `web/tests/experiment-comparison.test.mjs` | 단위 11개 |
| NEW `web/tests/e2e/experiment-comparison.spec.mjs` | E2E 1개 × desktop/mobile-width = 2개 실행 |

core / scenario / recommendation / draft A/B / 저장 스키마 / README는 변경하지 않았습니다.

## 동작

- **기준 A 보관**: `freezeBaseline(run, shownMinute)`는 화면 시각이 그 실행의 끝일 때만 성공합니다. 실행을 `structuredClone`으로 복사하고 검증한 뒤 deep-freeze합니다. 메모리(`useState`)에만 두며, 현재 입력·슬라이더·자료 갱신으로는 바뀌지 않습니다. 바꾸는 방법은 "현재 실행 #N로 기준 A 바꾸기"(현재 실행도 끝까지 재생했을 때만)와 "기준 A 해제" 버튼뿐이고, 둘 다 밴픽·실행·재생 상태를 건드리지 않습니다.
- **검증 (`detachRun`)**: 복사본에 남는 것은 자기 소유 데이터뿐입니다. 상속 필드는 복사 과정에서 사라지므로 검증에서 걸립니다. `isManagerInput`을 통과해야 하고, `input.seed === seed`, 저장된 result가 `simulateManager(input)` 재계산 결과와 같아야 하며, `endMinute === result.minute`, `teams.team_a/b.sourceId`가 `sourceTeamOrder(snapshot)`와 같아야 합니다. 팀 가정값은 input과 일치해야 하고 `sideAtRun`은 snapshot의 진영 ID와 일치해야 합니다. snapshot이 깨져 있으면 `simulationInputKey`가 throw하므로 거부됩니다.
- **비교 거부 (`compareExperimentRuns`)**: 재현 번호가 다르면 `SEED`, 규칙 버전이 다르면 `RULESET`, `evidenceIdentity`·모델·패치·cutoff·출처가 다르면 `EVIDENCE`로 거부합니다. 소스 팀 ID 쌍이 다르면 `TEAMS`로 거부하고 그 뒤 항목은 비교하지 않습니다. 그 외 차이는 `DRAFT`(진영·선픽·이전 세트·선택), `ROSTER`, `ROLES`로 나눕니다. 분류는 기존 `simulationInputKey`의 각 부분을 그대로 써서 하고, 마지막으로 `sameSimulationInput`이 참인지도 확인합니다. 따라서 기존 의미는 그대로이고, 같은 입력인지 판정하는 별도 기준은 새로 만들지 않았습니다. 팀 ID용 정규식도 새로 만들지 않았고, 기존 core 검증만 씁니다. 거부된 결과에는 `outcome` 필드가 없습니다.
- **가정 diff**: 실제 소스 팀 ID × 라인/운영/한타별로 A/B 값과 변경 여부를 보여주고, `NONE` / `SINGLE` / `MULTIPLE`로 구분합니다. 여러 개를 바꾼 경우 차이를 한 가정 탓으로 나눌 수 없다고 표시합니다. 팀은 진영이 아니라 소스 ID로 짝을 맞춥니다. 표시 이름이 같은 두 팀은 화면에서 `이름 (팀ID)`로 구분합니다.
- **결과**: 팀별 모델 자원·모델 킬·추상 오브젝트·기지 내구도의 A→B 값과 B−A 차이, 종료 시각·종료 종류만 보여줍니다. 승자·순위·단일 점수·승률은 없습니다. 이 값들은 `shownMinute`가 B의 끝일 때만 반환하고, 그 전에는 `outcome: null`입니다. 이 경우 반환 JSON에 minute/reason/gold/base가 전혀 없다는 것을 단위 테스트로 확인했습니다.
- **화면 표시**: B가 A와 같은 실행이면 비교하지 않고 안내만 합니다. B의 입력이 현재 밴픽 입력과 달라졌으면 "기존 실행끼리 비교"로 표시합니다. 보관·해제 뒤에는 상태 메시지로 focus를 옮깁니다(버튼이 사라져도 focus가 page로 빠지지 않도록). 표는 `overflow-x: auto`이고 모바일에서는 글자를 줄입니다.

## 실제 실행 결과 (`web/`에서 실행)

| 명령 | 결과 |
|---|---|
| `node --test tests/experiment-comparison.test.mjs tests/experiment-replay.test.mjs tests/experiment-replay-review.test.mjs tests/simulation-core.test.mjs tests/simulation-scenario.test.mjs` | tests 45 / pass 45 / fail 0 |
| `npm run typecheck` | 오류 없음 |
| `npm run lint` | 오류 없음 |
| `npm run build:pages` + `node --test tests/pages-build.test.mjs` | build 성공(기존 chunk 크기 경고만 있음), tests 4 / pass 4 |
| `npx playwright test tests/e2e/experiment-comparison.spec.mjs` | 2 passed (desktop 23.1s, mobile-width 25.4s) |

- 처음 E2E에서는 두 프로젝트 모두 실패했습니다. 상태 `<p>`가 아직 `:empty { display:none }`인 상태에서 `focus()`를 호출해 focus가 들어가지 않았습니다. 렌더 뒤 `useEffect`에서 focus하도록 고친 후 재실행해 통과했습니다.
- 단위 테스트를 처음 돌렸을 때는 테스트 fixture 문제로 2개가 실패했습니다. 로스터 offset 5가 중복 선수를 만들었고, 진영 교환 helper가 로스터·역할까지 바꿨습니다. fixture를 고쳤고, 진영 표시만 교환한 snapshot이 `DRAFT`로만 거부되는 검사를 추가했습니다.
- E2E 흐름: A 실행 → End → 보관(키보드 Enter, focus 확인) → 한타 하나만 0.35로 바꿔 B 실행 → 0분·2분에서 결과표 없음 → End에서 결과표 2행 → Home에서 다시 숨김(A는 그대로) → 다른 재현 번호로 실행하면 End에서도 거부 alert → A 해제(실행 #3과 재생 분이 그대로인지, focus 확인). 가로 넘침은 1px 이하이고, `0.35`가 native 검증에서 valid인지도 확인했습니다.
- 지시대로 기존 `experiment-replay.spec.mjs`와 그 밖의 광범위한 브라우저 테스트는 재실행하지 않았습니다. 전체 `npm test`도 실행하지 않았습니다.

## 수정 1 · Codex 검토 반영: 비교 경로에서 모델 재실행 제거 (2026-11-19)

**지적 사항**: `web/tests/experiment-comparison-review.test.mjs`(Codex 독립 검토, 수정하지 않음)가 실패했습니다. 명시 실행 2번 뒤 `freezeBaseline`과 중간·끝 비교를 거치면 `simulateManager` 호출 수가 2에서 7로 늘었습니다. 원인은 `detachRun`이 무결성 확인을 위해 매번 모델을 다시 실행한 것입니다. 모듈 주석의 "재실행 없음" 및 기존 실험/재생 보장과 모순되었습니다.

**신뢰 경계 변경 (정확한 범위)**:
- `web/app/experiment-replay.ts`(이전 작업에서 제가 소유)에 모듈 비공개 `TRUSTED_RUNS = new WeakSet<object>()`를 추가했습니다. 구성원은 두 종류뿐입니다.
  1. `buildExperimentRun`이 만들고 deep-freeze한 실행
  2. `cloneTrustedRun(run)`이 신뢰된 실행을 `structuredClone`해 deep-freeze한 분리 복사본(기준 A용)
- 공개 API는 `isTrustedRun(value)`와 `cloneTrustedRun(value)`입니다. 신뢰되지 않은 값이 들어오면 `cloneTrustedRun`은 `null`을 반환합니다. WeakSet에 추가하는 함수는 공개하지 않았습니다.
- 모든 구성원은 deep-frozen 상태이므로, WeakSet에 들어 있다는 것은 명시 실행 뒤 바뀌지 않았다는 뜻입니다. 그래서 모델 재계산 없이 무결성이 보장됩니다.
- `experiment-comparison.ts`의 `detachRun`은 `trustedRun`으로 바꿨습니다. 출처(WeakSet)를 확인하고, 모델 호출 없이 기존 모양 검사(입력/seed/`result.input`/팀 매핑/진영/snapshot 키)를 그대로 합니다. 출처 확인을 통과하지 못하면 새 거부 코드 `UNTRUSTED`("이 화면에서 직접 실행한 기록만 사용할 수 있습니다 (복사·수정된 기록은 받지 않습니다).")를 돌려줍니다.
- `freezeBaseline`은 신뢰된 실행을 끝까지 재생한 경우에만 `cloneTrustedRun`으로 기준 A를 만듭니다. `compareExperimentRuns`는 두 신뢰 실행을 복사 없이 읽기만 하고, 반환값은 항상 새 객체입니다.
- **명시적 제한**: 내용이 완전히 같더라도 `structuredClone`이나 JSON 왕복으로 만든 복사본, 손으로 만든 객체, 상속 객체는 모두 `UNTRUSTED`로 거부합니다. 이 화면에는 실행 파일을 가져오는 API가 없으므로 의도한 제한입니다.
- **변조 거부는 약해지지 않았습니다.** 변조하려면 복사본을 만들어야 하고(그러면 신뢰되지 않음), 신뢰된 원본은 frozen이라 제자리 수정이 throw합니다. 둘 다 단위 테스트로 확인했습니다.
- 기준 A 보관, 비교, 재생, 화면 렌더링 어디에서도 모델을 호출하지 않습니다. 캐시가 아니므로 첫 비교도 모델을 호출하지 않습니다. core / selection / scenario 파일은 변경하지 않았습니다.

**테스트 변경**:
- `experiment-comparison.test.mjs`: 위조 실행(ruleset 변경 등) 거부 기대값을 `INPUT`에서 `UNTRUSTED`로 바꿨습니다. 거부 목록에 내용이 같은 `{...run}`, `structuredClone`, JSON 왕복 복사본을 추가했고, 신뢰 원본의 제자리 수정이 throw하는지 확인을 추가했습니다. 기준 A 분리 테스트는 공개 경로로 만든 실행을 쓰도록 바꾸고, 분리 참조와 `isTrustedRun(baseline)`을 확인합니다. 테스트가 신뢰 확인을 우회하는 부분은 없습니다.
- `package.json` `test` 목록에 `tests/experiment-comparison-review.test.mjs`를 추가했습니다(파일 자체는 수정하지 않음).

**재실행 결과 (`web/`)**:

| 명령 | 결과 |
|---|---|
| `node --test tests/experiment-comparison.test.mjs tests/experiment-comparison-review.test.mjs tests/experiment-replay.test.mjs tests/experiment-replay-review.test.mjs tests/simulation-core.test.mjs tests/simulation-scenario.test.mjs` | tests 46 / pass 46 / fail 0 (review: 모델 호출 2회 유지) |
| `npm run typecheck` / `npm run lint` | 오류 없음 |
| `npm run build:pages` | 성공 (E2E용) |
| `npx playwright test tests/e2e/experiment-comparison.spec.mjs` | 2 passed (desktop 25.1s, mobile-width 24.3s) |

다른 브라우저 테스트와 전체 `npm test`는 실행하지 않았습니다.

## 남은 판단 / Codex 확인 요청

- ruleset이 다른 실행은 공개 경로로 만들 수 없습니다(`buildExperimentRun`이 항상 현재 ruleset을 씁니다). 그래서 위조본으로만 만들 수 있고, 위조본은 `RULESET`이 아니라 `UNTRUSTED`로 거부됩니다. `RULESET` 분기는 신뢰된 두 실행의 ruleset이 다를 경우를 위한 방어 코드로만 남아 있습니다.
- 진영만 바꾼 같은 두 팀은 `sameSimulationInput` 의미에 따라 `DRAFT` 차이로 거부합니다(팀 ID 기준 매핑 자체는 유지).
- 기준 A는 패널 컴포넌트 수명 동안만 유지됩니다(새로고침하면 사라짐, 메모리 전용).
