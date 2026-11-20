# 결과: 밴픽 결과 PNG 저장 (2026-11-19)

## 변경 파일
- 신규 `web/app/draft-result-image.ts`
  - `buildDraftResultImageModel` — READY `buildDraftResultReport` 결과 + selections → 텍스트 전용 표시 모델(순수, 입력 불변, READY 아니거나 픽/밴 5개가 아니면 `NOT_READY` throw). 픽 순서는 결과 순서, 밴 순서는 selections 순서. 챔피언 이름은 `nameOf` 사용(실패/빈 값은 id 또는 "알 수 없는 챔피언"으로 대체).
  - `clean` — 정규식 리터럴 대신 코드포인트 비교로 제어·공백·zero-width·U+2028/2029·bidi 문자를 공백 하나로 합침(1차 버전은 소스에 보이지 않는 U+2028/2029가 들어가 Vite PARSE_ERROR → 수정).
  - `wrapTeamName` — 제어/양방향 문자 제거, 16자×최대 2줄, 넘치면 `…`, 빈 이름은 "이름 없는 팀".
  - 패치 / 자료 기준일(`analysis_window.availability_cutoff` → 없으면 `cutoff`, 날짜 부분만, 없으면 "미확인") / "연습 결과 · 승패 예측 아님" / 승률·점수·실력·포지션 비계산 안내.
  - `serializeDraftResultImageModel`(결정적), `renderDraftResultImage`(Canvas2D 텍스트만, 폭 1080 고정, measureText 기반 말줄임), `createDraftResultPng`(toBlob, 서버 전송 없음), `downloadBlob`(object URL → `<a download>` → 1초 후 revoke).
- `web/app/draft-result-panel.tsx` — '밴픽 결과 이미지 저장' 버튼과 상태 문구만 추가.
  - 현재 result ref는 렌더 중이 아니라 commit 단계 `useEffect`에서 갱신(react-hooks/refs 준수). 저장 완료 시 이 ref와 클릭 시점 snapshot을 비교해 이전 결과 여부를 안내.
  - `disabled`(방 잠금 포함)·READY 아님·busy 중에는 실행 안 함. ref 기반 연속 클릭 차단.
  - 표시 모델을 클릭 시점에 동기로 만들어 고정 → 비동기 인코딩 중 결과가 바뀌어도 처음 입력만 쓰고 "이전 밴픽 결과 이미지로 다운로드를 요청했어요" 안내. 기기에 실제로 저장됐는지는 확인할 수 없으므로 모든 성공 문구는 "저장 완료"가 아니라 "다운로드 요청"으로 표현.
  - 실패 시 한국어 안내, draft 상태는 건드리지 않음.
  - 휴대폰 브라우저 저장 한계 안내(다운로드 폴더/파일 앱/길게 눌러 저장). Web Share/업로드는 쓰지 않음.
- 신규 `web/tests/draft-result-image.test.mjs` — 순서/기준일/안내문/점수 없음/결정성/입력 불변, non-READY 거부, 긴·빈 팀 이름, Canvas 대역(모든 문구 그려짐·폭 1080·넘침 말줄임·context 없음 실패).
- CSS 추가 없음(기존 `.draft-result-actions` 버튼 스타일 재사용).

## 검사
- **실행 못 함**: `node --test web/tests/draft-result-image.test.mjs`가 권한 승인 필요로 막혔고, 지시대로 재시도하지 않았습니다. typecheck/lint도 돌리지 않았습니다.

## 미완료 / 한계
- 테스트·타입 검사 실행 필요: `cd web && node --test tests/draft-result-image.test.mjs`.
- 브라우저에서 실제 다운로드 동작은 확인하지 않았음(iOS Safari 등은 `download` 속성을 무시하고 새 탭 미리보기로 열 수 있음).
- 폰트는 시스템 한글 폰트 대체 체인에 의존(웹폰트 로딩 대기 없음).
