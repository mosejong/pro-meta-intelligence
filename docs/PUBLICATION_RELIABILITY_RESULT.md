# 공개 자료 로딩·갱신 경합 보완 결과 (2026-11-17)

## 변경

- `web/app/publication-loader.ts` (신규): `fetchJsonWithTimeout`이 응답과 `response.json()` body 읽기를
  모두 타이머·외부 AbortSignal과 경쟁시킨다. 종료 시 타이머·abort 리스너를 해제하고 내부 요청을 abort.
  core 15초, 부가 10초 제한. 부가 로더: collection / creator(patch·cutoff 대조) /
  history+outcomes(병렬 요청 후 as_of·benchmark_ready 대조, 외부 history 없으면 core 내장 history 기준) /
  AI / schedule+changes(병렬 요청 후 content_hash·retrieved_at 대조, 36시간 stale 판정 유지).
  `withHistoryStatus`는 새 객체를 반환해 받은 원본을 바꾸지 않는다.
- `web/app/radar-dashboard.tsx` 로딩부만 교체:
  - 검증된 `current.json`이 오면 곧바로 report·팀/상대 선택·피드 상태를 반영(밴픽 사용 가능).
    이때 detail은 "부가 자료 확인 중", stale 발행본은 "수집 상태 확인 중"으로 표시하고, 부가 자료가
    모두 끝난 뒤 기존 문구(수집 상태 메시지/현재 판단 잠금)로 확정한다. LIVE/STALE 판정 기준은 기존과 같다.
  - 부가 자료 7개는 병렬. 각각 실패하면 그 자료만 미연결(null/unavailable)로 둔다.
    history가 오면 같은 core일 때만 `history_status`를 합친다. core의 patch·cutoff가 바뀌면
    creator/outcomes를 먼저 비워 옛 발행본과 섞이지 않게 한다.
  - 요청마다 번호+AbortController. 새 요청·수동 파일 성공·unmount(StrictMode 포함)에서 이전 요청을
    abort하고 결과 반영을 차단한다.
  - 첫 로딩 실패는 `DEMO FALLBACK`. 이미 발행본/파일이 있으면 그대로 두고
    `REFRESH FAILED · PREVIOUS FEED`(파일이면 `· LOCAL FILE KEPT`)만 표시하며 확인 시각을 갱신하지 않는다.
  - 수동 파일 성공 시 자동 요청 중단·무효화. 파일 읽는 동안 5분 주기 갱신은 건너뛴다.
    파일을 고른 뒤 사용자가 직접 새로고침을 누르면 새로고침이 우선한다.
  - 자동 갱신은 검색·포지션·기준 통과 필터·표시 개수를 지우지 않는다. 선택 항목·포지션은 새 발행본에
    없을 때만 첫 항목/전체로 바꾼다. 팀·상대 선택 유지 규칙과 '발행 피드 새로고침' 동작은 기존과 같다.
    수동 파일 불러오기의 기존 초기화 동작은 유지.
- 검사: `web/tests/publication-loader.test.mjs`(npm test에 연결), `web/tests/e2e/publication-reliability.spec.mjs`.

변경하지 않음: 밴픽/로스터/연간 스키마, 추천·분석 가중치, 출처/수집/디자인/번역, player-season-* 파일, draft-lab.

## 검증 (2026-11-17, 로컬 Windows + Chrome)

| 항목 | 결과 |
| --- | --- |
| `node --test web/tests/publication-loader.test.mjs` | 8/8 통과 (헤더 hang·body hang timeout, 외부 abort, 타이머/리스너 해제, 의존 자료 불일치 거부, 원본 불변, 라벨) |
| typecheck / lint | 통과 |
| 단위 파일 9개 직접 실행 (rendered-html 제외) | 86/86 통과 |
| `node --test web/tests/rendered-html.test.mjs` | 42/42 통과 — 단, 기존 vinext 빌드 결과물 대상이며 이번에 재빌드하지 않음 |
| `npm --prefix web test` (빌드 포함 전체) | **미실행** — 권한 승인 필요로 차단, 우회하지 않음 |
| `npm --prefix web run test:pages` | 4/4 통과 |
| 새 E2E (desktop + mobile-width) | 12/12 통과 |
| 기존 E2E 회귀 (draft-studio, neutral-navigation, roster-workshop, player-pool, desktop+mobile) | 19/20 통과. desktop `stage, cancel, confirm, undo and refresh…` 1건이 reload 후 진행 0(기대 1)으로 실패(38.8초 소요, 다른 작업과 동시 실행되어 느린 상태). 같은 테스트 단독 3회 반복 재실행은 3/3 통과. 타이밍 의존 flake로 보이지만 이번 변경과의 무관함은 확정하지 못함 |

E2E 시나리오: 부가 7개 route 보류 중 core만으로 밴 확정 / core 503 → DEMO FALLBACK /
새로고침 성공·실패 후 검색·필터·PATCH 유지, 실패 라벨에 LIVE 없음 / 5분 주기(clock) 갱신 실패 후
진행 중 드래프트·staged 픽 유지, 데모 전환 없음 / 연속 새로고침에서 늦게 도착한 이전 응답 배제 /
초기 로딩 중 수동 파일 → 늦은 자동 응답이 덮지 않음.
지연은 Playwright route로 인위적으로 만든 것이며 실제 서버 지연을 측정한 것이 아니다.

## 한계

- 드래프트 화면은 픽이 시작되면 데이터 라벨이 고정 표시로 바뀌어, 주기 갱신 실패 라벨은 그 화면에서 보이지 않는다
  (draft-lab 미수정). 실패 라벨은 Radar/팀 화면 상단에서 확인된다. 모바일 폭은 상단 라벨을 CSS로 숨긴다.
- timeout 값(15s/10s)은 실측 근거가 아닌 보수적 기본값.
- 갱신 중 부가 자료가 끝나기 전(최대 10초)에는 core와 무관한 collection/AI/schedule의 직전 값이 남아 보일 수 있다.
  core에 종속된 creator/outcomes는 core가 바뀌면 즉시 비운다.
