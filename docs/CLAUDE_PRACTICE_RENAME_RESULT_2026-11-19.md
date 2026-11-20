# 연습 보관함 이름 바꾸기 — 결과 (2026-11-19, Claude Opus 5.5 medium)

## 변경 파일
- `web/app/draft-practice-library.ts`
- `web/app/draft-practice-library-panel.tsx`
- `web/tests/practice-rename.test.mjs` (신규)
- 이 문서

DB 이름/버전(`pro-meta-practice-library` v1), 최대 5개, schema v1/v2/v3 형식은 바꾸지 않았습니다. CSS, package, 기존 테스트는 손대지 않았습니다.

## 구현 완료
### 라이브러리 `rename(id, newName)`
- id 형식이 잘못되면 `NOT_FOUND`. 이름은 기존 `validatePracticeName`으로 확인합니다(앞뒤 공백 제거, NFC, 50자, 제어/bidi 문자).
- **readwrite 트랜잭션 하나** 안에서 `entries.getAll()`과 `scenarios.get(id)`를 읽습니다.
  - 항목과 본문이 둘 다 없으면 `NOT_FOUND`(삭제된 ID는 다시 만들지 않음).
  - `read`가 쓰던 검증을 `verifyStored()`로 뽑아 **read와 rename이 같이 씁니다**. entry 파싱, id 일치, 본문 `parsePracticeContent`(현재/시즌 로스터 bundle 검증 포함), summary/roster/season 플래그 일치를 확인하고, 실패하면 abort(`CORRUPT` 등)하며 아무것도 쓰지 않습니다.
  - 중복 이름은 자기 자신을 뺀 정상 항목들과 비교합니다(save와 같은 NFC/대소문자/공백 기준). 대소문자만 바꾸는 등 자기 이름은 허용합니다.
  - `entries.put({...검증된 entry, name})`만 실행합니다. id, created_at, summary, schema_version, 본문, 다른 항목은 그대로이고 슬롯도 쓰지 않습니다(5개가 차 있어도 동작). 이름이 완전히 같으면 쓰기를 건너뜁니다.
- 값은 트랜잭션 `complete` 뒤에만 resolve합니다. error, abort, timeout이면 reject하고 커밋되지 않습니다(기존 `run` 재사용).
- 같은 store에 대한 readwrite 트랜잭션은 IDB가 순서대로 처리하므로, 다른 탭의 save/rename과 동시에 실행돼도 중복 이름은 생기지 않습니다.

### 패널 UI
- 정상 항목마다 "이름 바꾸기" 버튼이 있습니다(손상 항목에는 없음). 누르면 그 항목 아래에 "새 이름" 입력과 적용/취소가 나타나고, 평소에는 숨겨져 있습니다. 기존 `.draft-practice-save` 스타일을 다시 쓰고, 한 줄 전체를 쓰도록 inline `flexBasis: 100%`만 추가했습니다.
- Enter는 적용(form submit), Escape와 취소는 아무것도 저장하지 않고 닫은 뒤 버튼으로 포커스를 되돌립니다. 작업 중(busy)에는 취소/Escape를 막습니다.
- locked이거나 busy이면 버튼, 입력, 적용이 비활성입니다. locked면 편집기가 숨겨집니다.
- 이름 바꾸기를 열면 열기/삭제 확인창이 닫히고, 열기/삭제를 요청하면 편집기가 닫혀 서로 겹치지 않습니다. 새 확인 모달은 만들지 않았습니다.
- 팀/밴픽/로스터/방 상태(boardKey, locked)가 바뀌면 render 중에 편집기를 닫습니다. 적용할 때는 기존 `createPracticeLoadGate` ticket을 앞뒤로 확인하고, 기존 `generation` token으로 늦게 온 결과를 버립니다.
- 성공 문구는 IDB 커밋 후, gate가 그대로일 때만 표시합니다. 그 사이 화면이 바뀌었으면 옛 성공 문구 없이 목록만 새로 읽습니다(실제 저장 상태 반영).
- 실패하면 원래 이름이 그대로 남고 기존 `practiceErrorText` 문구를 보여 줍니다. 이름 오류(NAME_*)일 때는 고칠 수 있게 편집기를 열어 두고, 그 밖의 오류는 닫은 뒤 목록을 새로 읽습니다.

## 신규 테스트 (`web/tests/practice-rename.test.mjs`)
가짜 IDB에 `put`, 탭 간 readwrite 직렬화, 커밋 직전 지연/abort hook을 추가했습니다. 검증 항목:
1. v1, v2(현재 로스터), v3(시즌) 항목의 이름을 바꾼 뒤에도 entry의 다른 필드, 본문 문자열, read 결과(session/roster/season)가 같은지
2. 자기 이름(완전히 같음 → 쓰기 없음, 대소문자 변경 → 허용)과 다른 항목 이름(case/공백/NFC 결합문자) 거부
3. 빈 이름, 길이 초과, 제어/bidi 문자, 잘못된 id, 없는 id, 삭제 후 rename → 변화 없음, 다시 생성되지 않음
4. summary 손상, 본문 JSON 손상, 본문 없음, 항목 없음, 형식이 깨진 raw 항목 → 거부되고 저장소 변화 없음. 5개가 차 있어도 정상 항목 rename 가능
5. 두 탭에서 rename과 save, rename과 rename을 같은 이름으로 동시에 → 하나만 성공. rename과 remove 경합 → 중복이나 고아 항목 없음
6. 커밋 abort → `FAILED`, timeout → `TIMEOUT`, 늦게 온 커밋은 버려져 원래 이름 유지

## 미검증
- **신규 테스트 실행**: `node --test tests/practice-rename.test.mjs`가 승인 단계에서 거부되었습니다. 지시대로 다시 시도하지 않았으므로 테스트는 **한 번도 실행되지 않았습니다**.
- typecheck/lint/build, 기존 practice 테스트(`draft-practice-library`, `practice-roster-bundle`, `season-practice-bundle`)도 실행하지 않았습니다. `read`의 검증을 `verifyStored`로 옮겼으므로 기존 테스트로 회귀를 확인해야 합니다.
- 브라우저에서 UI 동작(포커스, Enter/Escape, 레이아웃)을 확인하지 않았습니다.
- `web/package.json`의 `test` 목록에는 신규 테스트를 넣지 않았습니다(package는 소유 범위 밖).

한도 오류는 없었습니다.


## Codex 이름변경 통합 확인

관련21개 중 첫20개통과/마지막60ms abort시험이JSON검증보다먼저timeout돼실패했다. 테스트 timeout을1초/의도지연1.5초로분리한뒤신규6개모두통과. 제품timeout상수변경없음. JSX Escape핸들러를form에서input으로옮겨접근성lint통과. 타입통과,실제PC Enter적용/Escape취소/현재밴픽유지1개통과. 신규테스트등록. 전체369수치는이름변경직전통합이며이번변경후전체재실행은하지않았다.
