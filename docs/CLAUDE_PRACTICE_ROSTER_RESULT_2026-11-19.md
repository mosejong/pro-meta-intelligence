# 연습 보관함 + 현재 선수 로스터 함께 보관 — 결과 (2026-11-19, Claude Opus 5.5)

## 구현
- **신규 `web/app/practice-roster-bundle.ts`**: 저장값 = (a) 옛 plain draft 문자열 그대로, 또는 (b) `{artifact_type:"practice-bundle", schema_version:1, draft, roster}` 봉투(키 정확히 4개). draft는 기존 `parseDraftSession`(v2/v3/v4 불변), roster는 기존 `parseRosterScenario`(roster-scenario v1 불변)로 **draft의 frozen report basis / blue·red pair / 그 report teams의 index**에 엄격 검증. roster 오류는 무시하지 않고 전체 `INVALID_ROSTER`/`CORRUPT`/`TOO_LARGE`로 거부. 크기상한 draft 16MB·roster 64KB 유지.
- **`draft-practice-library.ts`**: DB 이름/버전/store 불변. entry v1 그대로 읽음 + v2(`summary.roster:boolean`) 수용. `save(name, draft, roster?)` — roster 없으면 기존과 동일한 v1 entry + verbatim draft(기존 테스트 형식 유지), 있으면 v2 + 봉투. `read`는 `{entry, session, roster|null}` 반환(기존 필드 호환). read 시 metadata summary(patch/세트/선택수/포지션)와 roster 포함여부가 내용과 다르면 `CORRUPT`. 5개 한도·원자적 트랜잭션·이름검증 그대로. 오류문구 `INVALID_ROSTER` 추가.
- **`draft-practice-library-panel.tsx`**: 체크박스 "현재 선수 구성도 함께 저장"(기존 CSS 재사용, 별도 클래스 없음). 준비된 roster가 있을 때만 기본 선택, 없거나 차단되면 비활성+안내(시즌 선수 사유는 부모 문구). roster 문자열·체크 상태를 gate key에 포함 → roster 변경/체크 변경이 대기 확인과 늦은 load를 무효화. 목록에 "선수 구성 포함", 확인 모달에 로스터 교체 안내, 불러오기 후 포함/미포함 안내. `onLoad(session, roster|null)` 한 번 호출.
- **`roster-workshop.tsx`**: `onRosterMeta({seasonPlayers})`(언마운트 시 null)와 `restoreRequest {token, roster}` 추가. 요청은 basis·pair가 맞는 editor만, token당 1회(외부 ref로 remount 간 유지) 적용, `validateRosters`로 재검증, 시즌 선택 해제, localStorage에도 기록. 요청 effect가 기기복원 effect보다 먼저 timer를 걸고 기기복원 timer는 `restoreDone`을 발화 시점에 재확인 → 오래된 localStorage가 나중에 덮어쓰지 않음. 같은 로스터여도 `publishTick`으로 재게시.
- **`draft-lab.tsx`**: `practiceRoster` = live roster가 seriesReport basis와 현재 pair에 정확히 일치하고 시즌 선수 없음일 때만 serialize. 불러오기에 roster가 있으면 `restoreSession` 재사용 + `setLiveRoster(null)`(A/B·simulation 중간상태 고정 방지) + 새 token 요청. 다른 복원 경로(자동저장/공유/파일)는 `restoreSession`에서 미적용 요청을 지움. roster 없는 옛 항목은 기존 동작(현재 로스터 유지).
- 포함하지 않음: 시즌 선수(차단·안내, 조용히 버리거나 현재선수로 저장하지 않음), 가정실험·기준A·AI이력·친구방 credentials. autosave/구단DB 무변경.

## 검증 상태
- **실행하지 못함**: 이 세션에서 `node --test`, python 등 명령 실행이 권한으로 막혀(반복 시도 안 함) 신규 테스트·기존 library 테스트·typecheck·lint 모두 **미실행/미검증**. 정적 검토만 함.
- 신규 `web/tests/practice-roster-bundle.test.mjs`: v1 read 호환 / 현재선수 bundle 왕복(roster-scenario 텍스트 동일) / basis·pair 불일치·중복선수·손상 roster·메타 불일치 거부 / report 불변. 실행: `cd web && node --test tests/practice-roster-bundle.test.mjs tests/draft-practice-library.test.mjs`.
  - 가정: `public/feed/current.json` 팀≥3, 첫 두 팀 중 하나에 CURRENT 관측 선수가 있음(없으면 중복선수 케이스 assert 실패 가능).
- 브라우저 동작(체크박스 기본값, 같은 basis/pair 재적용, 시즌선수 차단, 늦은 load 무효화) 미확인.

## 후속 수정 (부모 핵심 실행 실패 대응)
- 실패: 테스트 139행 "v1 entry must not carry a roster"가 CORRUPT 대신 OK.
- 원인: 라이브러리 아님. 테스트의 fake IDB는 readwrite 커밋마다 store `data` Map을 새 객체로 교체하는데, 테스트가 `lib.save("옛")` 이전에 잡은 `scenarios` 참조에 변조를 써서 실제 저장소에 반영되지 않았고, read는 정상 plain draft를 읽어 OK가 맞게 나온 것.
- `read`의 정합검사(`entryHasRoster(entry) !== (content.roster !== null)` → CORRUPT)는 v1 entry(`entryHasRoster` 항상 false)가 봉투 roster를 가지면 이미 거부함. 라이브러리 로직은 바꾸지 않음(옛 v1 읽기 영향 없음).
- 테스트 수정(약화 아님): 저장 후 store Map을 다시 가져와 변조하고, 변조 전 legacy가 plain draft로 저장됐는지 확인하는 assert 추가. 기대값 CORRUPT는 그대로.
- 재실행은 부모가 담당. 이 세션에서는 미실행.
- `.tmp-patch-library.py` 삭제 완료.
