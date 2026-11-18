# 이름 붙인 연습 보관함 결과 (Claude, 2026-11-18)

작업 1(v4 포지션 보존) 위에서 구현했다. 작업 1 Codex 검증은 작업 2 시작 전 통과(265 tests, 14 browser) — 상위 지시로 전달받은 근거이며 본인 실행 아님.

## 리뷰 수정 2: 늦은 불러오기가 새 작업을 덮어쓰던 문제
Codex가 Chrome에서 재현: 저장 → 보드 초기화 → `IndexedDB.open` 1200ms 지연 → 작업 없음 상태에서 "열기" → 읽기 완료 전 챔피언 올림 → 옛 연습이 적용되어 진행도 0 대신 1. 수정:
- `draft-practice-library.ts`에 `createPracticeLoadGate()` 추가: 보드 revision과 lock revision 카운터. 값 비교가 아니라 변경 횟수라 A→B→A(올렸다 내림, 방 입장 후 퇴장)도 무효. `ticket()`은 사용자 동작 시점(작업 없을 때 "열기" 클릭, 또는 확인 대화 생성 시점)에 잡고, 읽기 시작 전과 `library.read` 완료 후 두 번 `check()`. 불일치면 적용하지 않고 `PRACTICE_GATE_TEXT` 안내("…적용하지 않았습니다. 필요하면 다시 열어 주세요.").
- `draft-lab.tsx`: `practiceBoardKey` memo(분석 기준 patch/cutoff, 양 팀, 선픽 진영, 이전 세트, 현재 선택, 올려놓은 챔피언, 명시 포지션, 방 활성, 가져오는 중, sessionReady)를 패널 `boardKey`로 전달. 선택·초기화·파일 가져오기·공유 링크 수락·매치업/선픽 변경·포지션 변경·다음 세트·방 입장/퇴장 모두 키가 바뀜.
- 패널: `useLayoutEffect`로 commit마다 gate에 관찰(같은 키 재관찰은 revision 불변). `onLoad`는 ref로 보관해 렌더마다 새 콜백이 와도 유효한 불러오기를 취소하지 않음. render-time 조정으로 lock 전환 시 모든 확인 대화(열기·삭제)를 지우고(잠금 해제 후 되살아나지 않음), 보드 변경 시 열기 확인을 지움. 확인 버튼도 저장된 ticket으로 재검사. 방 입장/퇴장 사이의 늦은 콜백은 LOCKED/LOCK_CHANGED로 차단.
- 기존 source/restore 경로(`restoreSession`, epoch 증가, reset 대화 닫기)와 자동 이어하기 저장은 그대로이며 중복 저장 없음.
- Codex 소유 `web/tests/e2e/draft-practice-library-review.spec.mjs`는 수정·실행하지 않음(브라우저 재현은 Codex 담당).

## 변경 파일
- 신규 `web/app/draft-practice-library.ts`: 별도 DB `pro-meta-practice-library` v1 (stores `entries` keyPath id, `scenarios` id→문자열). 기존 `pro-meta-draft` v1/`sessions/current`는 열지 않음. 레코드 `{schema_version:1,id,name,created_at,summary}` + 시나리오 문자열 원문(`serializeDraftScenario`, v4 positions 포함). 읽기 때마다 `parseDraftSession` 재검증. 이름 trim·NFC, 50 code point, 제어/줄구분/bidi 문자 거부, 중복 이름(대소문자·NFC 무시) 거부. 5개 제한·중복 검사는 저장과 같은 readwrite transaction 안에서 수행(손상 항목도 자리 차지, ID 있으면 삭제 가능). open/transaction 모두 bounded(기본 10초), timeout 시 abort, 늦은 open 성공은 close. 성공은 `complete` 뒤에만 resolve. 오류 코드 14종 + 한국어 문구.
- 신규 `web/app/draft-practice-library-panel.tsx`, `web/app/draft-practice-library.css`: 기본 접힌 `<details>` "내 연습 보관함 · n/5". 펼칠 때만 목록 조회(밴픽 불변). 저장/열기/삭제, 진행 중 작업(선택·이전 세트·올려놓은 챔피언)이 있으면 열기 전 확인, 삭제도 확인, 취소 버튼 focus·Escape 취소·트리거로 focus 복귀. 작업마다 세대 토큰으로 늦은/대체된 결과 무시; 결과 도착 시 방이 활성이면 적용 안 함. 저장 범위 안내 문구(가상 선수·감독/코치·시즌 라인업 미포함). 44px 버튼/입력, flex-wrap·overflow-wrap.
- `web/app/draft-lab.tsx`: 패널을 고급 설정(파일) 위에 배치. `scenario=saveSnapshot`(기존 memo, 명시 positions 포함, 방 활성/가져오는 중엔 null), `locked=room.active||!sessionReady||importing`, `onLoad`는 공유 링크 수락과 같은 경로(A/B epoch 증가, reset 대화 닫기, `restoreSession` → 타이머·자동 상대 초기화, 저장된 frozen report 사용).
- 신규 `web/tests/draft-practice-library.test.mjs`, `web/tests/e2e/draft-practice-library.spec.mjs`.

## 리뷰 수정 3: lint `jsx-a11y/no-noninteractive-element-interactions`
- Codex 보고: 수정 2 후 web 272 tests·typecheck 통과, 늦은 읽기 재현(데스크톱/모바일)·실제 두 탭 5번째 자리 경쟁 통과(상위 근거, 본인 실행 아님). 남은 lint 1건: 확인 `role="alertdialog"` div의 `onKeyDown`.
- 수정(패널만): div의 `onKeyDown` 제거, 규칙 비활성화 없음. 확인 대화가 떠 있는 동안에만 `document`에 capture 단계 `keydown` 리스너를 등록하고, Escape이면서 이벤트 대상이 확인 대화(`confirmRef`) 안일 때만 preventDefault·stopPropagation 후 닫고 트리거로 focus 복귀(기존 동작 유지). 대화가 사라지면 리스너 해제.
- 검사: typecheck 통과. 대상 파일 eslint는 이 세션에서 명령 승인이 거부되어 **실행하지 못함**. 브라우저 확인은 상위 담당.

## 실제 검사
- `npm --prefix web run typecheck`: 통과.
- 리뷰 수정 2 후 재실행: typecheck 통과, `node --test tests/draft-practice-library.test.mjs` **7/7 통과** (gate 회귀 테스트 1건 추가: 작업 없을 때 열기 후 챔피언 올림 → BOARD_CHANGED, A→B→A 무효, 같은 키 재관찰은 유효, 초기화/가져오기/매치업/모드/다음 세트 변경 무효, 방 입장 LOCKED·입장 후 퇴장 LOCK_CHANGED). 패널의 React 배선 자체는 Node에서 렌더하지 않았으므로 실제 지연 재현은 Codex 브라우저 spec 결과에 의존.
- 최초 실행: `node --test tests/draft-practice-library.test.mjs`: **6/6 통과**. 테스트 내 메모리 IndexedDB 대역(새 패키지 없음, readwrite 직렬화·완료 시 원자 commit) 사용: 이름 규칙, v4 왕복·원문 보존·frozen report·`pro-meta-draft` 미생성, 5개 제한/중복/손상 항목, 두 탭 동시 저장(제한·같은 이름 각각 1개만 성공), 잘못된 시나리오/16MB 초과/손상 본문/없는 ID/quota(원자적 무변경), open 지연·차단·늦은 성공 close·transaction 지연 timeout 후 미커밋.
- 실행 중 실패 2건은 테스트 쪽 결함이었고 수정함: 대역이 lock 전 snapshot을 잡던 문제, 밴만 있는 6수 시나리오를 v4로 가정한 문제.
- **브라우저 spec은 작성만, 실행하지 않음** (접힘·목록 무변경, 저장→새로고침→확인/취소/Escape→열기→삭제, 5개 제한, 390px·44px).
- lint/전체 테스트는 실행하지 않음(Codex 담당).

## 미지원/남은 항목
- 실제 브라우저 IndexedDB의 다중 탭 동작은 대역으로만 검증; 실기기 확인 필요.
- 보관함 문구는 한국어 고정(번역 키 미추가). 다른 locale 필요 시 Codex가 locale-messages 통합.
- 이름 변경·덮어쓰기 저장·내보내기는 없음(조용한 덮어쓰기 방지 위해 의도적으로 제외).
- 불러온 연습은 기존 자동 이어하기(`sessions/current`)에 기존 규칙대로 저장됨(파일 가져오기와 동일).
- timeout된 쓰기는 abort를 시도하지만 브라우저가 이미 커밋 중이면 반영될 수 있어 "목록을 다시 확인" 문구로 안내.
- `package.json` 테스트 등록은 Codex.


## Codex 독립 검증 완료(Claude 자체 실행과 구분)

작업 1은 실제로 Codex 독립 웹 265개·브라우저 14개 검증 뒤 작업 2를 시작했다. 작업 2에서 Codex가 늦은 읽기의 새 작업 덮어쓰기를 실제 브라우저로 재현했고 Claude에 수정하도록 되돌렸다. 수정 후 웹 전체 272개·타입·lint·Pages 4개 및 PC/모바일 보관함 12개가 통과했다. 실제 두 탭의 다섯 번째 자리 경쟁도 통과했다. 접근성 수정 뒤 Escape/포커스·저장 복원 2개를 별도 재확인했다. [독립 검토 상세](CODEX_PRACTICE_LIBRARY_REVIEW_2026-11-18.md).
