# 결과 이미지 명시 포지션 연결 — 결과 (2026-11-19, Claude Opus 5.5)

## 변경 파일
- `web/app/draft-result-image.ts`
  - `DraftResultImageInput.positionRecord?: DraftPositionRecord | null` 추가 (선택).
  - `DraftResultImageSide.pick_roles?: string[]` 추가 (선택). 기존 픽 순서와 같은 순서로 한국어 역할(`탑/정글/미드/바텀/서포터`) 또는 `미배정`.
  - `positionRecord`가 `undefined`(미전달)이면 모델·직렬화·경계 문구가 기존과 완전히 동일 (`pick_roles` 키 자체가 없음).
  - 전달되면(`null` 포함) 기존 `parseDraftPositions`(엄격 검증)로 결과의 BLUE/RED `team_id`와 현재 `selections`에 대해 재검증. 다른 팀 키, 상대 픽, 밴/외부 챔피언, 중복, 미지 역할, 형태 오류가 하나라도 있으면 기록 전체를 버리고 모든 픽을 `미배정`으로 표시 (추정 없음).
  - 픽 매칭은 기존 `championKey`(asset id alias 정규화) 재사용. 역할 라벨은 기존 `roleLabel` 재사용.
  - 관측 역할(`pick.roles`)은 전혀 사용하지 않음. `unassigned`(명시 해제)도 `미배정`.
  - 렌더: 역할이 있으면 각 픽 아래 `포지션 <역할>` 한 줄(26px) 추가, 픽 행 높이를 `ROW + 36`으로 늘리고 `draftResultImageHeight`와 카드 높이를 같은 함수(`sideBlockHeight`)로 계산해 세로 넘침 없음. 가로는 기존 `fit`으로 절단. 픽5/밴5 유지.
  - 역할 포함 시 경계 문구 2번째 줄만 "승률·점수·실력은 계산하지 않고, 포지션은 직접 배정한 것만 표시합니다."로 교체.
- `web/app/draft-result-panel.tsx`: 선택 prop `positionRecord` 추가, 클릭 시점에 동기 빌더로 전달(전달된 경우에만 키 포함). 화면 렌더/결과 로직은 변경 없음.
- `web/app/draft-lab.tsx`: 기존 `positionRecord` memo(이미 현재 두 팀·현재 픽으로 정규화, room 모드면 null)를 `DraftResultPanel`에 전달. 그 외 변경 없음.
- `web/tests/draft-result-image.test.mjs`: 신규 4개 하위 테스트.
  - 일부 배정·양팀·alias(`Kai'Sa`)·픽 순서 유지·입력 불변·모델 분리(이후 기록 변경 무영향)·캔버스 문자열/폭/높이.
  - 구버전 호환(무옵션 = 기존 모델, `pick_roles` 없음, 기존 경계 문구).
  - `null`/`{}`/전부 명시 해제 → 미배정, 관측 역할이 있어도 미배정.
  - 다른 팀 키, 다른 팀 키 혼합, 상대 픽, 밴 챔피언, 상대 팀에 내 픽, 중복, 미지 역할(ADC), 역할 키 누락, 배열/문자열 → 전부 미배정 + 입력 불변. BLUE/RED 교체 후 stale 기록 → 미배정.

## stale 처리 근거
- draft-lab의 `positionRecord`는 이미 현재 matchup으로 정규화됨. 빌더가 결과 `team_id`·`selections` 스냅샷으로 다시 엄격 검증하므로, 팀 변경/사이드 교체/undo 후 재선택으로 픽이 바뀐 기록은 표시되지 않음. 빌더는 동기 실행이며 문자열만 복사하므로 클릭 시점 분리 복사본이 유지됨.

## 검증 상태
- **미검증.** `cd web && node --test tests/draft-result-image.test.mjs` 실행이 승인 단계에서 거부됨 → 지시대로 재시도하지 않음. Codex 직접 실행 필요.
- typecheck/lint/전체 테스트/브라우저 확인 미실행(지시상 금지 또는 미시도).
- 확인 필요 포인트: 샘플 fixture에서 RED 픽에 `Kaisa`가 포함된다는 가정(테스트에서 assert로 확인), `draftResultImageHeight` 신규 export 아님(기존 export 사용).


## Codex 통합 확인 완료

Claude 정상완료 세션4fbcadaa-d015-4881-90ec-d7719747abad, is_error=false. PNG에 현재 명시배정 포지션을 연결했다. 관련 단위9개·타입·변경lint·Pages빌드 통과. 실제 desktop Chrome에서 밴픽20턴 → 서포터명시배정 → PNG다운로드를 확인했으며 PNG바이너리서명/1080폭/캔버스역할문자열/미배정/예측아님 표시 및 실제 이미지 눈검사까지 확인했다(브라우저1개 통과). Android/iOS 실기기 다운로드 확인은 아니다. 시즌 보관함 모바일폭 핵심1개도 통과했다. 전체 회귀는 반복하지 않았다. 로컬만 반영, 푸시·배포 없음.
