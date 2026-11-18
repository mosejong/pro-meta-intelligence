# 품질 보완 — 공개 자료 로딩과 갱신 경합

Opus 5.5 Medium의 작은 새 세션. 추가 에이전트/Fable/번역/새 패키지·다운로드/계정 변경 금지.
미추적 문서·첨부와 기존 변경 보존. 커밋/푸시/머지/배포 금지. Codex가 별도로 연간 자료 로더를
보완하므로 player-season-* 파일·그 검사는 수정하지 않는다.

## 확인한 문제

radar-dashboard.tsx의 loadPublishedFeed는 core JSON을 받은 뒤 부가 요청 약 8개를 순차 await한
다음에야 setReport/setFeedState를 한다. 느린 부가 요청이 밴픽 시작을 막는다. timeout도 없다.
manualOverride는 시작 시에만 검사해서, 도중 수동 JSON을 불러오면 늦은 자동 응답이 덮을 수 있다.
동시 새로고침/5분 주기 응답 순서 역전도 막지 않는다. 새로고침 때 필터·검색을 지우는 부작용도 있다.

## 수정 범위

web/app/radar-dashboard.tsx의 공개 로딩/수동 불러오기/효과 cleanup 관련 부분만,
필요하면 새 web/app/publication-loader.ts로 작은 fetch/timeout/취소 도구를 분리한다.
검사 web/tests/publication-loader.test.mjs, web/tests/e2e/publication-reliability.spec.mjs,
package.json 검사 연결, docs/PUBLICATION_RELIABILITY_RESULT.md.
기존 밴픽/로스터/연간 스키마, 추천/분석 가중치, 출처/수집/디자인/번역은 변경하지 않는다.

## 완료 조건

1. 검증된 current.json이 도착하면 즉시 report/초기 팀/피드 상태를 반영해 밴픽을 쓸 수 있게 한다.
   최신성/fixture 표시와 검증 경계는 유지하고, 부가 상태를 확인하기 전 최신·정상 수집이라고 꾸미지 않는다.
2. collection/creator/history→outcomes/AI/schedule→changes를 가능한 병렬로 읽는다. history/outcomes의
   as_of·benchmark_ready, schedule/changes의 hash·retrieved_at, creator의 patch/cutoff 기존 대조를 유지한다.
   부가 실패는 해당 자료만 미연결로 두고 core를 데모로 바꾸거나 기다리게 하지 않는다.
3. core·부가 요청 모두 유한한 시간 제한. fetch 응답뿐 아니라 body 읽기도 제한한다.
   타이머/AbortController를 정리하고 새 요청·수동 불러오기·unmount/StrictMode에서 옛 요청 결과를 차단한다.
   처음 로딩 실패는 명시적인 데모 fallback, 이미 연결된 발행본의 갱신 실패는 그 발행본을 유지하고
   실패 사실을 표시한다. 이전 발행본을 LIVE/새 데이터라고 새로 표시하지 않는다.
4. 수동 파일 불러오기가 성공하면 진행 중 자동 요청은 중단/무효화한다. 로딩 도중에 수동 선택을
   덮거나, 느린 이전 응답이 새 응답을 덮어서는 안 된다. 자동 갱신이 Radar 필터·검색을 지우지 않는다.
   선택한 팀·저장된 밴픽·고정 스냅샷은 유효하면 유지한다. '발행 피드 새로고침' 동작은 유지한다.

## 최소 읽기/검사

radar-dashboard.tsx의 관련 상태/로더/수동 import/return, report·companion validator 타입들,
draft-lab의 canSelect/feedLabel(수정하지 않음), 기존 E2E/config와 tests/rendered-html 참조.
전체 docs/CSV/과거 대화는 읽지 않는다.

단위: timeout·body hang·abort·응답 순서/오래된 요청 차단·의존 자료 검증 유지·원본 불변.
실제 Chrome PC/모바일: 부가 요청을 지연시켜도 core 밴픽 confirm 가능, 첫 실패 demo 표시,
갱신 실패 시 기존 자료/진행 보존, 연속 새로고침 뒤 늦은 응답 배제, 수동 import 후 덮어쓰기 없음.
실제 테스트에 필요한 기존 UI를 쓰고, 제품에 테스트 버튼이나 구현 내부를 노출하지 않는다.

관련 단위→타입/린트→전체 npm test/test:pages→새 E2E 및 기존 주요 밴픽 회귀를 수행한다.
부가 자료는 route로 지연해 검증하되 결과에 실제 서버 지연을 측정한 것처럼 쓰지 않는다.
Bash 명령은 저장소 루트의 `npm --prefix web run ...` 또는 `node --test web/tests/...`를 쓴다.
권한 차단이면 우회·재시도하지 말고 미실행으로 기록한다. 날짜·실제 통과 수·한계를 짧게 남긴다.
