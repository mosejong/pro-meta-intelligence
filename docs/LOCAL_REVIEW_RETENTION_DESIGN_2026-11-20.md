# 로컬 자동저장에 자동 선택 이유 유지 — 제한 설계 (2026-11-20, Claude 설계 / 구현 전)

과제: docs/CLAUDE_LOCAL_REVIEW_RETENTION_DESIGN_TASK_2026-11-20.md
이번 턴은 이 문서만 작성. 제품·테스트 수정, 명령, 실행 없음. 아래 "근거"는 실제 소스를 읽은 결과이며,
기존 전체 웹 526, 범위 15/15, PC/모바일 8/8은 이전 체크포인트 증거일 뿐 이번에 새로 실행한 것이 아니다.
5800895c의 .txt 다운로드는 사용자가 명시적으로 내보내는 기능이며, 새로고침 후 복원이 아니다.

## 1. 목표 / 비목표
- 목표: 새로고침이나 탭 재시작 뒤 같은 로컬 자동저장 보드를 이어갈 때, 보드에 아직 남아 있는 자동 확정 차례의 **확정 직전 설명 기록**을 다시 보여 준다.
  재계산·추정·출처 보강은 없다.
- 비목표: 범용 영속화 프레임워크. 시나리오 파일(v2~v4)·연습 보관함·공유 링크·방 프로토콜·권한·모델·출처·readiness 변경.
  마지막 선택 한 줄(`lastAuto`) 복원과 TXT 내용 변경도 하지 않는다.
- 저장된 이유는 "이 기기에 저장된 연습 메모"일 뿐이다. 브라우저 저장소는 진위 증명이 아니며, 과거 관측이나 예측 근거로 승격하지 않는다.

## 2. 실제 호출 경로 (근거)
- **메모리 상태:** `draft-lab.tsx:251` `autoHistory`(메모리 전용).
  - 추가는 `:331`에서 일어난다. 600ms 자동 확정 콜백 안에서 `setSelections`와 같은 배치로 `appendSoloAutoHistory`를 호출하며,
    context는 `soloHistoryContext(soloAutoContext(blue, red, firstPickSide, manualSide, previousPicks), basisKey(rosterBasis(report)))`다.
  - 가지치기는 `:342-343`의 render 중 조정이다. `pruneSoloAutoHistory(autoHistory, selections, historyContext)`, 방이 활성이면 `[]`.
  - undo(`:603`), team/side/firstpick/basis/manualSide 변경은 context나 prefix 불일치로 이 가지치기에서 제거된다.
  - 명시적 비우기: `resetDraft()`(`:535-537`)는 next game(`:619`), reset series(`:637`), reopen(`:629`), swap(`:600`)에서 불린다.
    `restoreSession()`(`:356-357`)도 `setSoloEnabled(false)`, `setAutoHistory([])`를 호출한다.
- **패널:** `:746` `{!room.active && <SoloDraftHistoryPanel history={prunedHistory} …/>}`. `soloEnabled`와 무관하게 표시된다.
  따라서 기본값 `soloEnabled=false`(`:247`)로 새로고침해도 복원된 기록이 보인다.
- **manualSide:** `:248` `useState("BLUE")`이며 저장되지 않는다. context에 manualSide가 들어가므로, RED로 연습한 기록은 새로고침 후 BLUE 기본값에서 즉시 가지치기된다.
  → 복원 시 함께 저장한 manualSide를 되돌려야 한다.
- **자동저장 쓰기:**
  - `:404-407` `saveSnapshot = serializeDraftScenario(seriesReport, …, positionRecord)`. `!sessionReady`, `importing`, `room.active`일 때는 null이다.
  - `:429` `useDraftSave(saveSnapshot, …)` → `use-draft-save.ts:10` 모듈 전역 `createDraftSaveTracker(writeLocalDraft)` →
    `draft-session.ts:175` `writeLocalDraft`(직렬 `pendingWrite` 체인) → `persistLocalDraft`. IndexedDB는 `pro-meta-draft` v1, store `sessions`, key `current`(`:128,165`).
- **자동저장 읽기:** `:381-397` `readLocalDraft().then(parseDraftSession → restoreSession)`. `active` 가드가 있고, `finally`에서 `setSessionReady(true)`.
  `canSelect`(`:306`)는 `sessionReady`가 필요하므로 읽기가 끝나기 전에는 선택·쓰기가 없다(`saveSnapshot`이 null).
- **연습 보관함이 같은 문자열을 저장한다(결정적 근거):**
  - `:773` `DraftPracticeLibraryPanel scenario={saveSnapshot}`.
  - `draft-practice-library.ts:5-9` "exact scenario string produced by serializeDraftScenario … re-validated with parseDraftSession". 불러오기는 `restoreSession`(`:777`)이다.
- **파일 내보내기·가져오기:** `downloadScenario`(`:641-650`)는 `serializeDraftScenario`를 별도로 호출하고, 가져오기(`:652-670`)는 `parseDraftSession` → `restoreSession`.
- **공유와 방:**
  - `draft-share.ts:58`은 `parseDraftSession(serializeDraftScenario(...positions 없음))`.
  - 방 생성 `draft-room-panel.tsx:65`는 `createDraftShareUrl(outgoing)`, 수락은 `:770 onAccept → restoreSession`.
- **레코드 형태:**
  - `solo-draft-explanation.tsx:8-16` `SoloAutoRecord{turn, champion_id, reason, prefix, context, explanation}`.
  - `solo-draft.ts:39-55` `SoloDraftExplanation{turn, kind BAN|PICK, side, record_team, record_scope OPPOSING_TEAM|ACTING_TEAM, season_evidence, selected, alternatives}`.
  - 선택지는 `SoloDraftSuggestion{champion_id, role_supported?, reason, source TEAM_RECORD|PLAYER_SEASON|RADAR|FALLBACK}`에 `{inferred_roles, evidence(6종)}`가 붙는다.
  - 다른 후보는 최대 2개(`solo-draft.ts:67`).
- **기존 검사:**
  - `tests/draft-storage-deadline.test.mjs`는 `readLocalDraft`/`writeLocalDraft`의 시간 제한을 검사한다.
  - `tests/draft-autosave.test.mjs:110`은 draft-lab이 `writeLocalDraft`를 직접 부르지 않는다는 것을 검사한다.
  - E2E 7개가 `pro-meta-draft` v1을 직접 연다.

## 3. 두 안 비교
**A. 시나리오 스키마 v5(자동저장 전용 envelope 포함)**
- `saveSnapshot` 문자열이 연습 보관함에 그대로 저장된다(`:773`). 넣으면 이름 붙은 연습에 이유가 섞이고, 보관함 불러오기·가져오기·공유 재구성의 `parseDraftSession` 신뢰 경계가 넓어진다.
  파일로 위조한 "AI 이유"를 표시할 수 있게 된다.
- 이를 막으려면 저장용과 보관용 문자열을 분리해야 한다. 또는 `current` 값을 envelope로 감싸야 하는데, 그러면 구버전 탭이 `RESTORE_FAILED`를 내어 보드 자체를 잃는다. v2~v4 엄격성 보존과도 충돌한다.

**B. 같은 store의 sidecar key + 정확한 보드 문자열 결합 (선택)**
- `sessions/current`는 바이트 그대로 두고, `sessions/current-solo-review`에 리뷰만 둔다. DB 버전 업그레이드가 없고, 시나리오·보관함·파일·링크·방 경로에는 손대지 않는다.
- **원자성:** 두 key를 **한 readwrite transaction**에서 쓴다. 보드와 리뷰는 항상 같은 탭, 같은 시점의 쌍이다.
- **결합:** 리뷰에 `current` 문자열의 SHA-256을 넣어, 구버전 탭이 `current`만 덮어쓴 경우를 걸러 낸다.

**결정: B.** 근거는 `:773`과 `draft-practice-library.ts:5-9`(같은 문자열의 재사용)와 `restoreSession`의 공용 경로다.
제품 결정이 더 필요한 부분은 없다(로컬, 되돌릴 수 있음, 기존 범위 안).

## 4. 형식 / 버전 / 범위
`sessions/current-solo-review` 값은 JSON 문자열이다.
```
{ "schema": "solo-review-retention", "version": 1,
  "scenario_sha256": "<64 hex: 같은 트랜잭션에 쓴 current 문자열 UTF-8의 SHA-256>",
  "manual_side": "BLUE" | "RED",
  "records": SoloAutoRecord[] }   // 1..20개, 차례 오름차순
```
- **크기:** 직렬화 64 KiB 이하. 넘으면 리뷰를 쓰지 않고 key를 삭제하며, 보드는 평소대로 저장한다.
- **엄격 파싱(전부 아니면 전무):**
  - **키:** 정확한 키 집합. 알 수 없는 키, 열거값, 역할(`TOP|JUNGLE|MID|BOTTOM|ADC|SUPPORT`, `solo-draft-history-text.ts` ROLE_TEXT와 동일), 다른 후보 2개 초과면 거부.
  - **문자열 길이:** ~~문자열은 1~200자, `reason`은 300자 이하.~~ (2026-11-20 정정)
    - `context`는 중첩 직렬화 JSON이라 Fearless 잠금과 basis에 따라 200자를 정상적으로 넘는다. 임의 상한을 두지 않는다. 세션으로 다시 계산한 context와 **정확히 같아야** 하므로 길이는 보드 자체가 묶는다.
    - `record_team`의 실제 값은 `target.team_name || target.team_id`(`solo-draft.ts:77`)라 팀 이름일 수 있다. 길이 상한 대신 세션 팀에서 다시 계산한 값과 정확히 같아야 한다.
    - 나머지 문자열은 비어 있지 않고 제어 문자가 없어야 한다. 전체 크기는 64 KiB UTF-8 상한이 묶는다. 실제 규칙은 `docs/SOLO_REVIEW_CODEC_2026-11-20.md`.
  - **정수:** turn은 1~20 정수이고 중복이 없다. `explanation.turn===turn`이며 `selected.champion_id===champion_id`(`buildSoloHistoryText`의 일치 규칙과 같음).
  - **보드 대조:** 복원한 세션으로 다시 계산한 `soloHistoryContext(soloAutoContext(blue, red, firstPickSide, manual_side, fearlessLocks(games)), basisKey(rosterBasis(session.report)))`와
    모든 `record.context`가 같아야 한다. 각 레코드는 `soloAutoRecordMatches(record, session.selections, …)`를 통과해야 하고, 레코드끼리는 `appendSoloAutoHistory`의 consistentWith 관계여야 한다.
  - **통과 후:** `freezeSoloAutoRecord`로 동결한다.
- **손상 정책:** 리뷰가 없거나, 해시가 다르거나, 파싱·대조에 실패하거나, 읽기 예외가 나면 → 리뷰만 버린다. 보드는 기존 그대로 `RESTORED`, `manualSide`는 기본값이다.
  사용자 문구는 추가하지 않는다. 다음 쌍 쓰기에서 key가 덮어써지거나 삭제된다.
- **쓰기 범위:** `room.active`이거나 `saveSnapshot`이 null이면 아무것도 쓰지 않는다(기존과 같음).
  기록이 비면 같은 트랜잭션에서 key를 **삭제**한다. 그래서 undo·reset 등으로 지운 이유가 되살아나지 않는다.

## 5. 동작 정책
- **복원:** 시작 읽기는 한 readonly transaction에서 `current`와 `current-solo-review`를 함께 읽는다(`readLocalDraftWithReview`).
  `restoreSession`(기록 `[]`, `soloEnabled=false`) 직후, 유효할 때만 `setManualSide(saved)`와 `setAutoHistory(records)`를 실행한다.
  `soloEnabled`는 꺼진 채로 두어 자동 진행이 재개되지 않는다. 기존 `active` 가드 안에서만 적용한다.
- **다른 복원 경로:** 가져오기, 공유 수락, 보관함 불러오기, 방은 sidecar를 읽지 않는다. 기존대로 `[]`가 되고, 다음 쌍 쓰기에서 key가 삭제된다.
- **render 가지치기 유지:** 복원 후 사용자가 undo, team/side/firstpick/manualSide 변경, next game, basis 변경을 하면 기존 가지치기 그대로 제거되고 즉시 쌍으로 다시 쓰인다.
- **쓰기 트리거:** 쓰기 단위는 `{scenario: saveSnapshot, review}`. review는 `prunedHistory`와 `manualSide`로 memo한다.
  보드는 같고 manualSide 변경으로 기록만 비는 경우도 다시 쓴다.
- **늦은 비동기:** 쓰기는 기존 tracker의 직렬 체인과 세대 규칙을 그대로 쓴다(`createDraftSaveSession`이 최신 값만 retry).
  해시는 트랜잭션 전에 `crypto.subtle.digest`로 계산한다. `crypto.subtle`이 없으면 리뷰 없이 보드만 쓰고 key를 삭제한다.
- **다른 탭:**
  - 쌍이 원자적이라, 다른 탭의 보드와 이 탭의 이유가 섞이지 않는다.
  - 마지막 쓰기가 이기는 것은 보드와 같다. 지운 탭이 나중에 쓰면 key가 없어지고, 오래된 탭이 나중에 쓰면 그 탭의 보드와 이유가 쌍으로 복원된다(기존 보드 의미와 동일).
  - 구버전 빌드 탭이 **다른 바이트의** `current`만 쓰면 해시 불일치로 무시된다. 바이트가 같은 보드를 쓰면 무시되지 않는다(8절 첫 항목).
- **할당량·거부:**
  - 쌍 트랜잭션이 `QuotaExceededError` 등으로 abort되면, 같은 `persist` 안에서 **보드만 쓰고 리뷰 key는 삭제하는** 두 번째 트랜잭션으로 한 번 되돌아간다.
    그것도 실패하면 기존 `SAVE_FAILED`.
    (2026-11-20 정정) 이 fallback으로 보드 저장 신뢰성이 "기존보다 낮아지지 않는다"는 것은 **증명·검증되지 않았다**. 쌍 쓰기가 늘린 시간·용량이 기존보다 먼저 시간 제한이나 할당량에 걸릴 수 있다. 저장소 통합 과제에서 별도로 검증해야 한다.
  - 시간 제한은 기존 `DRAFT_STORAGE_TIMEOUT_MS`.
- **정직한 표시:** 복원된 레코드(복원 시 동결 객체를 WeakSet으로 표시)가 패널에 하나라도 있으면 한 줄을 표시한다.
  "이 기기에 저장된 연습 메모에서 불러온 설명입니다. 증명 자료나 예측 근거가 아닙니다."
  TXT/복사 내용은 바꾸지 않는다(기존 검증된 글 유지).
- **부작용 없음:** roster, results, 비교 A, URL/hash, localStorage, 연습 보관함 DB, 공유 링크, 방 메시지, 시나리오 파일 바이트는 변하지 않는다.

## 6. 후속 구현 과제 소유 파일 (한 과제)
- 신규 `web/app/solo-review-retention.ts`(순수): `serializeSoloReview(scenarioSha, manualSide, records)`(64 KiB cap → null)와 `parseSoloReview(text, session, scenarioSha)`.
- `web/app/draft-session.ts`
  - 추가: `SOLO_REVIEW_KEY`, `readLocalDraftWithReview`, `writeLocalDraftWithReview(scenario, review|null)`. 같은 `pendingWrite` 체인, 쌍 트랜잭션, quota fallback.
  - 기존 `readLocalDraft`/`writeLocalDraft`의 시그니처와 동작은 불변(deadline 검사 보존).
- `web/app/draft-autosave.ts`: 타입 매개변수만 추가(`<T = string>`). 동작 불변, 기존 검사 불변.
- `web/app/use-draft-save.ts`: `useDraftSave(snapshot, review, onStatus)`. snapshot null → submit null. tracker writer → `writeLocalDraftWithReview`.
- `web/app/draft-lab.tsx`: 시작 읽기 교체(`:383`), 유효 시 manualSide·기록 적용, review memo, 복원 표시용 WeakSet.
  직접 쓰기 호출 금지(`draft-autosave.test.mjs:110` 정신 유지).
- `web/app/solo-draft-history-panel.tsx`: optional `restoredNote` 표시만.
- 주석 정리(정확한 범위):
  - `solo-draft-explanation.tsx:7`의 "only an explicit plain-text copy is allowed, never persisted, linked or sent to a room"은 **현재 이미 사실이 아니다**(.txt 다운로드 존재).
    → "explicit readable copy/.txt export; retained only in the local autosave sidecar (solo-review-retention.ts); never in scenario files, practice library, links or rooms"로 바꾼다.
  - `solo-draft-history.ts:8-10`과 `solo-draft-history-panel.tsx`의 "never stores or restores … reload loses it"도 같은 뜻으로 수정한다.
  - `draft-lab.tsx:250`의 "Memory-only"도 같은 뜻으로 수정한다.
  - `tests/solo-draft-history-text.test.mjs`의 주석 단언(`/reload loses it/`, `/never stores or restores/`)을 새 문구로 수정한다. 이 파일이 소유 범위에 포함된다.
- 테스트: 신규 `web/tests/solo-review-retention.test.mjs`와 `web/package.json` 목록 1줄, 신규 E2E `web/tests/e2e/solo-review-retention.spec.mjs`.

## 7. 수용 검사
단위 테스트(`solo-review-retention.test.mjs`, 실제 `play` 경로로 만든 기록 사용):
1. **왕복:** serialize → parse가 기록을 그대로 되돌리고(동결), 각 기록이 `soloAutoRecordMatches`를 통과한다. RED manual_side도 보존된다.
2. **전부 거부(보드 무관):**
   - 해시 불일치, 알 수 없는 키·열거값·역할, 다른 후보 3개, turn 중복·소수
   - `explanation.turn`·`selected` 불일치, context 위조, 다른 basis·팀·firstPick·previousPicks
   - prefix나 보드 불일치, 64 KiB 초과, JSON 손상, 프로토타입 키(`__proto__`)
3. **기존 형식 불변:**
   - `serializeDraftScenario` 출력 바이트와 v2/v3/v4 `parseDraftSession` 결과가 이전과 동일하다.
   - 연습 보관함에 저장되는 문자열에 `solo-review`나 `records`가 없다.
   - share URL과 방 `enter({share})` payload에 이유가 없다.
4. **저장소(가짜 IndexedDB):**
   - 쌍 쓰기는 한 트랜잭션이다. 기록이 비면 key가 삭제된다.
   - quota abort 시 보드만 저장되고 key는 삭제된다.
   - `readLocalDraft`/`writeLocalDraft` deadline 검사가 그대로 통과한다.
   - `crypto.subtle`이 없으면 key가 삭제된다.
5. **draft-autosave:** 기존 검사가 전부 그대로 통과한다(타입만 변경).

E2E(PC/모바일):
6. **새로고침 복원:**
   - RED로 자동 연습 → 상대 자동 3개 → 새로고침
   - 패널 (3)이 보이고 설명이 이전과 같으며(TXT 내용 동일), "저장된 연습 메모" 줄이 보인다.
   - `soloEnabled`는 꺼져 있고 manualSide는 RED다.
7. **지운 이유가 되살아나지 않음:**
   - 자동 1개 undo → 새로고침 → 없음
   - 같은 챔피언을 수동 재선택 → 새로고침 → 자동으로 표시되지 않음
   - reset, next game, swap, manualSide 변경 각각 → 새로고침 → 없음
8. **다른 복원 경로:** 가져오기, 공유 수락, 보관함 불러오기 후 새로고침 → 이유 없음. 방 참여·이탈 후 이유 없음, 방 메시지 불변.
9. **손상:** devtools로 `current-solo-review`를 손상하거나 해시를 변경 → 새로고침 → 보드 `RESTORED`, 패널 없음, 콘솔 예외 없음.
10. **두 탭:** A에서 undo로 삭제 → B(오래된 탭)는 변경 없이 대기 → 새로고침 시 삭제가 유지된다. B가 이후 행동하면 B의 보드와 이유 쌍만 복원된다.
11. **부작용 없음:** URL, localStorage, 연습 보관함 DB, roster, 비교 A 불변. 44px, 모바일 가로 넘침 없음.

## 8. 리스크
- **같은 보드의 수동 선택:** 구버전 빌드 탭이 바이트가 같은 `current`를 쓰는 경우, 수동 선택이 자동으로 보일 수 있다. 해시는 보드 동일성만 묶고, 자동인지 수동인지는 묶지 않기 때문이다.
  재배포 직후의 잔존 탭에 한정되며 문서화한다.
  (2026-11-20 정정) 1단계 codec은 이를 해결할 수 없다. 구버전 빌드 전반에 대해 "지운 이유가 되살아나지 않는다"를 **주장하지 않는다**.
  - 저장소 통합은 주장 범위를 같은 버전 코드로 한정해야 한다.
  - 같은 버전 코드 안에서 `current`를 쓰는 **모든 기존 writer**(리뷰 없는 쓰기 경로 포함)는 같은 트랜잭션에서 sidecar를 삭제해야 한다.
- **해시 비용:** 큰 `analysis_snapshot` 문자열의 SHA-256 비용이 저장마다 든다(비동기, 수 ms 예상, 미측정).
- **쓰기 빈도:** manualSide 변경만으로도 쓰기가 한 번 늘어난다.
- **탭 간 경합:** 마지막 쓰기가 이기는 기존 보드 의미를 그대로 상속한다. 탭 간 merge는 하지 않는다.
- **진위:** 저장된 이유는 위조 가능한 로컬 메모다. 표시 문구로 한정하며, 실험·비교·예측 입력으로 쓰지 않는다.
- **E2E 정리:** 7개 E2E가 `sessions`를 직접 다루므로, key가 하나 늘어나는 것이 정리 로직에 영향을 주는지 구현 시 확인이 필요하다(clear는 둘 다 지운다).
