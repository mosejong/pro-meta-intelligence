# 결과: 피어리스 여러 세트 밴픽 쉬운 글 복사 (2026-11-19)

모델: Claude Opus 5.5 (medium). 과금/모델 우회 없음. git·네트워크·설치·전체 테스트·브라우저·서브에이전트 사용 없음.

## 구현 (변경 파일)

- 신규 `web/app/draft-series-recap-text.ts`
  - `buildSeriesRecapText({ recap, patchId, cutoff, nameOf })` → `{ ok: true, text, game_count }` 또는 `{ ok: false, reason }`.
  - 이미 계산된 `SeriesRecap`만 읽음. recap/엔진 재실행 없음, recap에 없는 세트(미완료 현재 세트 포함) 추가 없음.
  - 거부: 세트 0개 `NO_FINISHED_GAME`, 하나라도 UNSUPPORTED `UNSUPPORTED_GAME`, `total_locks` 미확인 `UNVERIFIED_TOTAL`, 형식 이상(세트 번호 순서·BLUE/RED 순서·픽5/밴5 아님 등) `INVALID_RECAP`. 부분 공유 없음.
  - 출력: 제목(완료 N세트), 자료 기준(패치·기준일, 비면 "미확인"), 세트별 `[n세트(· 방금 완료)] 블루 팀 vs 레드 팀 · 선픽 진영`, 양팀 픽 5/밴 5, 이 세트 전 잠금 수와 다음 세트부터 잠기는 픽, 총 잠금 수·목록, 안내(선수 구성·명시 포지션은 범위 밖, 경기 승패·승률 계산/예측 아님).
  - `cleanShareName`: 제어문자(Cc)·서식/bidi/제로폭(Cf)·줄/문단 구분자 제거, 공백 정리, 40자(코드포인트) 제한+`…`. 팀명·챔피언명·패치·기준일에 적용. `nameOf` 예외/비문자열이면 정리된 ID로 대체.
  - 원본 행·팀 ID·원시 JSON 미출력. 입력 불변, 결정적.
- `web/app/draft-series-recap-panel.tsx`
  - 펼친 복기 본문 안에 '여러 세트 밴픽 복사' 버튼 추가. `<details>` 기본 접힘 유지, 밴픽/세트 상태 미변경.
  - 공유 글은 화면의 `recap` useMemo 결과로 만든 `share` useMemo에서만 생성(복사 시 재계산 없음). 패치/기준일은 recap의 자료원인 `report.opponent_prep.patch_id/cutoff`.
  - experiment-batch-panel 패턴을 로컬로 복제(공용 리팩토링 없음): `useLayoutEffect`로 `[recap, nameOf, patchId, cutoff]` 변경·언마운트 시 토큰 증가, 비동기 완료 시 토큰 불일치면 무시. 렌더 시 `copy.recap/nameOf/patchId/cutoff` identity가 현재와 모두 같을 때만 상태 표시 → 입력이 바뀌면 이전 성공 문구·수동 textarea 숨김.
  - Clipboard API `writeText` 성공 후에만 성공 문구. API 없음/거부 시 `aria-label="여러 세트 밴픽 글 (직접 복사)"` readOnly textarea(포커스 시 전체 선택)에 같은 글.
  - 거부 사유는 버튼 `aria-describedby` 안내 문장으로 표시하고 버튼 비활성.
  - 참고: draft-lab의 `nameOf`는 `useCallback([catalog])`로 안정적이라 매 렌더 무효화되지 않음(읽기만 확인).
- 신규 `web/tests/draft-series-recap-text.test.mjs` (기존 recap 테스트와 같은 vite ssrLoadModule 방식, 기존 `buildSeriesRecap`으로 입력 생성)
  - 세트 순서 / Red 선픽 / 진영 교체 / 잠금 수(0→10, 총 20·30) / 픽5·밴5
  - 미완료 현재 세트 제외, 완료 현재 세트는 recap 경유로 1회만 "방금 완료"
  - 세트 없음·UNSUPPORTED·total_locks null·형식 이상 거부
  - 이름/패치 정리(bidi·제어·줄바꿈·제로폭), 길이 제한, nameOf 예외 대체, 줄 주입 불가
  - 입력 불변·결정성, 원시 JSON/ID 미출력

## 미검증

- `node --test web/tests/draft-series-recap-text.test.mjs` 실행이 **승인 단계에서 거부**됨("This PowerShell command contains multiple operations. The following part requires approval: node --test web/tests/draft-series-recap-text.test.mjs"). 지시대로 반복하지 않음 → **신규 단위 테스트 미실행, 통과 여부 미확인**. Codex 측 실행 필요.
- 타입체크/린트 미실행(전체 테스트 금지 및 승인 문제).
- 브라우저에서 실제 클립보드 동작·접근성 수동 확인 미실행(브라우저 금지).
- CSS 미변경: 새 `.draft-series-recap-share` 블록은 기본 스타일로 렌더됨.
- 한도 오류는 발생하지 않음.


## 최신 통합 확인

저장 경합·게시 staging 격리·친구방 공개경로 차단·세트 글공유를 포함한 웹429개통과. 타입/변경lint통과, 실제카탈로그경합 수정전실패/수정후보존1개, 실제피어리스3세트완료/글공유/전환시옛표시해제1개통과. 신규공유검사의실제U+2028/2029가포함된정규식구문오류는코드포인트검사로수정했다. 세부현재상태는 IMPLEMENTATION_CHECKPOINT_2026-11-19.md에모았다. 공개제품기능배포없음.
