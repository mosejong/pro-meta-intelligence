# 고정 밴픽 가정 실험·재생 — Claude 구현 결과 (2026-11-19)

Opus 5.5 · 커밋/푸시/배포 없음 · Codex 독립 검증 대상.

## 변경 파일

| 파일 | 내용 |
|---|---|
| NEW `web/app/experiment-replay.ts` | 순수 어댑터: seed/가정값 파서, source ID→core ID 매핑, 1회 실행·동결(`buildExperimentRun`), 분 단위 프레임(`replayFrame`), 재생 reducer(`playbackReducer`) |
| NEW `web/app/experiment-replay-panel.tsx` / `.css` | 시뮬레이션 탭 실험 패널 (입력·실행·재생) |
| `web/app/draft-lab.tsx` | import 1줄 + SIMULATION 탭에 `<ExperimentReplayPanel readyInput={readyInput} blocked={!canSelect \|\| room.active} nameOf={nameOf} />` 1개 |
| `web/package.json` | `test` 스크립트에 `tests/experiment-replay.test.mjs` 추가 |
| NEW `web/tests/experiment-replay.test.mjs` | 단위 10개 |
| NEW `web/tests/e2e/experiment-replay.spec.mjs` | 브라우저 2 케이스 × desktop/mobile-width = 4 |

`simulation-core.ts`, `simulation-scenario.ts`, `simulation-readiness-panel.tsx`, 저장 스키마, 추천 규칙은 수정하지 않았습니다.

## 계약 대응

- **입력 출처**: 부모의 기존 `readyInput`(readiness 패널이 `onReadyInputChange`로 전달하는 검증 snapshot)만 사용. null이거나 `!canSelect || room.active`(room·복원/import·피드 로딩·세션 미준비)이면 실행 버튼 비활성 + 사유 표시.
- **고정**: 실행 시 snapshot을 `structuredClone` 후 run 전체(snapshot·input·result)를 deep-freeze. 이후 밴픽/로스터/가정값 입력란 변경은 run을 바꾸지 않고, `sameSimulationInput`으로 비교해 "기존 실행 · 실행 뒤 현재 밴픽 입력이 바뀌었습니다" 또는 "가정값/시드 입력란은 이 실행과 다름"을 표시. 새 실행은 현재 입력이 다시 준비 완료일 때만 가능.
- **검증**: seed는 `^(0|[1-9]\d{0,9})$` 이면서 ≤ 4294967295. 가정값은 일반 10진수, 유한, [-1,1]. blank/지수/16진수/범위 밖이면 해당 칸 `aria-invalid` + 버튼 비활성. clamp나 이전 값 대체 없음.
- **1회 계산**: `simulateManager`는 `buildExperimentRun` 안에만 있고, 패널에서는 submit(버튼/Enter)에서만 호출. 재생·seek·속도·입력 변경은 reducer와 `replayFrame`(순수, 동결된 events만 읽음)만 거침.
- **팀 ID**: 실제 team ID를 코드 단위 정렬해 `team_a`/`team_b`로 매핑(core 정렬 순서와 일치). 진영 교환 시 매핑·input·result가 동일함을 테스트로 확인. 실제 source ID와 실행 당시 진영은 `run.teams[core]`에 따로 보존. core input에는 safe ID와 사용자 가정값만 들어가며, 챔피언/선수/팀 이름은 "참고 고정 맥락(모델 미사용)"으로 표시만 함.
- **자동 추론 없음**: 기본값은 모든 팀·항목 `"0"`. 팀이 바뀌어도 기본값은 중립 0.
- **재생**: 재생/일시정지/처음/한 단계(+1분)/1x·2x·4x/seek(range, 키보드 Home/End/화살표). 시간축은 **고정 0..45분 척도**라서 슬라이더 길이로 종료 시점이 드러나지 않음. 커서는 모델 종료 분에서 clamp. 프레임은 `minute ≤ 커서`인 사건만으로 자원·킬·추상 오브젝트·기지를 다시 만들고, END는 로그에 넣지 않음. `outcome`(승자/사유)은 커서가 종료 분일 때만 채워지고 "모델 내부 결과"로 표시.
- **최종 상태 일치**: `buildExperimentRun`이 종료 프레임 상태를 `result.states`와 비교해 다르면 실행을 거부함(어댑터가 core의 킬당 300·오브젝트 600 보너스를 복제하고 있어서 그 부분의 어긋남을 잡는 장치). 단위 테스트는 seed 60개에서 0/중간/종료 직전/종료/뒤로 가기 프레임과 기지 0 처리를 확인.
- **타이머**: `setTimeout` 하나를 `[playing, cursor, speed, runId]` effect로 관리하며 cleanup에서 해제(일시정지·seek·속도 변경·새 실행·unmount). TICK에는 runId가 있어 이전 실행이나 일시정지 뒤 도착한 tick은 무시. 끝에 도달하면 자동 정지. 속도는 간격(700ms/배속)만 바꿈.
- **표시 경계**: 상단 note "사용자 가정에 따른 추상 모델 실행… 실제 LoL 승률이나 실제 경기 재현이 아니며…". 스탯 라벨은 "모델 자원 (실제 골드 아님)", "추상 오브젝트". 결과 문구는 "…실제 승패·승률 예측이 아닙니다". 모델 설명과 고정 입력은 `<details>` 안에 넣음. JSON 입출력, 새 저장/공유 형식, 기기 저장은 없음.

## 실제 실행 결과 (`web/`)

- `node --test tests/experiment-replay.test.mjs` → 10 pass / 0 fail
- `node --test tests/simulation-core.test.mjs tests/simulation-scenario.test.mjs tests/experiment-replay.test.mjs` → 30 pass / 0 fail
- `npm run typecheck` → 오류 없음
- `npm run lint` (전체) → 오류 없음
- `npm run build:pages` → 성공 (기존 chunk 크기 경고만)
- `node --test tests/pages-build.test.mjs` → 4 pass / 0 fail
- `npx playwright test tests/e2e/experiment-replay.spec.mjs` → 4 passed (desktop 2, mobile-width 2). 첫 실행에서 `innerText`/`toHaveText` 공백 차이로 테스트 자체가 실패해 `textContent` 비교로 고친 뒤 통과. 제품 코드 문제는 아니었음.
- 기존 41개 브라우저 broad 반복과 `npm test` 전체 묶음은 지시에 따라 실행하지 않음.

## Codex 독립 검토 후속 수정 (2026-11-19)

1. **상속 가정값 거부**: `validateRunInputs`가 팀 행은 `Object.hasOwn(drafts, id)`, 항목은 `Object.hasOwn(draft, field)`일 때만 명시 입력으로 인정합니다. prototype으로 상속된 행이나 값은 "팀 가정값이 없습니다", "값을 입력하세요"로 막습니다. 패널의 현재 입력 조회도 own-property 기준으로 바꿨습니다. 정상 snapshot과 일반 입력의 동작은 그대로입니다. `tests/experiment-replay-review.test.mjs`(Codex 작성, 수정 안 함)를 `npm test` 목록에 추가했습니다.
2. **브라우저 step 검증 불일치**: 가정값 입력을 `step={0.1}`에서 `step="any"`로 바꿔 0.25 같은 소수가 `stepMismatch`에 걸리지 않게 했습니다. form에도 `noValidate`를 넣어 판정 기준을 파서 하나로 맞췄습니다. 파서가 받는 범위는 줄이지 않았습니다. E2E는 이제 0.25를 넣고 `validity.valid === true`를 확인한 뒤, Enter로 실제 실행해 고정 입력에 "라인 0.25"가 보이는지 확인합니다.
3. **시드 설명**: 라벨을 "재현 번호 (시드)"로 바꾸고 도움말 "같은 번호와 가정값이면 언제나 같은 흐름이 나옵니다. 번호를 바꾸면 우연 요소만 달라집니다."를 넣었습니다(`aria-describedby`로 연결).

후속 실행 결과 (`web/`):
- `node --test tests/experiment-replay.test.mjs tests/experiment-replay-review.test.mjs tests/simulation-core.test.mjs` → 19 pass / 0 fail
- `npm run typecheck`, `npm run lint` → 오류 없음
- `npm run build:pages` → 성공
- `npx playwright test tests/e2e/experiment-replay.spec.mjs` → 4 passed (desktop 2, mobile-width 2). 다른 브라우저 spec은 실행하지 않음.

## 알려진 한계 / 검토 요청

- 재생 상태 재구성이 core의 보너스 상수(300/600)를 복제함. core를 바꾸면 실행 시 일치 검사가 실패하고 결과를 표시하지 않음(조용히 틀린 값을 보여 주지 않도록 막는 방식).
- 탭 이름은 기존 "시뮬레이션 준비" 그대로임(locale 키/기존 테스트 영향 회피).
- 실행 번호(#n)는 패널 메모리 카운터이고 새로고침하면 실행도 사라짐(의도한 동작).
