# 연습 보관본 시즌 카탈로그 버전 복원 — 결과 (2026-11-19, Claude Opus 5.5)

## 변경 파일
- `web/app/season-catalog-loader.ts`
- `web/app/draft-practice-library-panel.tsx` (loader 타입 확장 + 호출 1줄)
- `web/app/draft-lab.tsx` (loader useCallback 1줄)
- 신규 `web/tests/season-catalog-loader.test.mjs`

## 동작
`loadPublishedSeasonCatalog(publicationRoot, signal, expected?, options?)`
- 기존 2인자 호출은 그대로: 현재 정적 카탈로그 1회 요청 → parse → hash verify.
- `expected = {catalog_id, cutoff}`:
  1. 요청 전 검증: `catalog_id`는 `isCardHash`(64자리 소문자 hex), `cutoff`는 시간대가 있는 시각이어야 함. 아니면 요청 0회로 한국어 오류.
  2. 현재 카탈로그를 받아 parse+verify. id·cutoff가 정확히 일치하면 그대로 반환(요청 1회).
  3. 버전이 다르면 **같은 publicationRoot의** `history/catalogs/<catalog_id>.json` 하나만 요청함. URL은 검증된 hex에서 만들고, origin과 root 접두 경로가 같은지 한 번 더 확인함. 받은 파일도 parse+verify 후 id·cutoff가 정확히 일치해야 함 → 최대 요청 2회.
  4. 현재 요청이 **전송 실패**(오프라인/timeout/HTTP 오류·404)이면 유효한 expected가 있을 때만 대체 요청 1회. abort는 절대 대체하지 않고 그대로 던짐.
  5. 현재 카탈로그를 받았지만 형식 오류·위조이면 그대로 오류 처리하고 archive로 덮지 않음.
  6. archive가 없음 → "저장 당시 버전의 시즌 선수 자료를 찾지 못했습니다…", 일치하지 않음 → "보존된 시즌 선수 자료가 저장 당시 버전과 정확히 일치하지 않습니다." 상태는 바꾸지 않음.
  7. 재시도 루프 없음.
- 테스트용 주입: `options.fetchImpl`, `options.baseHref`(없으면 `window.location.href`), `options.timeoutMs`.

Panel: `loader(signal, {catalog_id: savedSeason.catalog_id, cutoff: savedSeason.cutoff})`. 인자는 선택이라 1인자 대역도 그대로 호환됨. 그 뒤의 `verifySeasonPart` 정확 일치 검사, gate, abort, 원자 복원은 바꾸지 않음. 구단 저장과 수동 시즌 패널은 건드리지 않음.

## 단위 테스트 (작성함, 실행 못 함)
현재 버전 일치 시 1요청 / 레거시 2인자 / 다른 버전이면 정확히 2요청으로 fallback / 현재 404이면 fallback / expected 없이 404이면 fallback 없음 / archive 없음·cutoff 불일치 오류 / 잘못된 hash·시간대 없는 cutoff는 요청 0회 / `../`·원격 URL·`%2e` 삽입은 요청 0회 / 위조 archive·현재본 바꿔치기·위조 현재본 거부 / abort 시 추가 요청 없음.
"다른 버전"은 실제 공개 카탈로그에서 카드 1장을 빼고 같은 canonical sha-256으로 다시 해시한 내부적으로 유효한 자료로 만들었음.

**실행 상태:** `node --test web/tests/season-catalog-loader.test.mjs`가 권한 승인 대기로 막혔고, 지시대로 다시 시도하지 않음. typecheck와 lint도 돌리지 않았음. Codex 쪽에서 위 단일 파일 테스트와 typecheck를 실행해 확인해 주세요.

## 남은 일
- `public/history/catalogs/<id>.json` 불변 파일은 이번에 준비하지 않음(Codex가 별도로 준비). 파일이 없으면 지금처럼 명확한 오류로 끝남.


## 자료 버전 복원 Codex 확인

기대 catalog_id/cutoff를정확검증하는동일사이트보존본fallback구현. 핵심15개/타입통과. 실제PC에서현재카탈로그만다른유효버전으로응답시켜보존본HTTP200을거쳐기존연습복원·취소유지1개통과. 첫실패는prepare-public.ts허용목록에보존파일이없어발생했고검토된기존집계카탈로그1개만명시추가해수정했다. raw나폴더통째공개없음. 보존JSON은기존공개카탈로그와바이트동일. 병합2015검토본은아직현재카탈로그로채택하지않음; 구단저장호환을추가확인한다.
