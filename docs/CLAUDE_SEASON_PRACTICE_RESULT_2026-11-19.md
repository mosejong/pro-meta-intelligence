# 역대 시즌 선수 + 연습 보관 결과 · 2026-11-19

구현: Claude Opus 5.5 (medium). 기반: cc08e643(현재 선수 + 밴픽 보관). 지시서: `docs/CLAUDE_SEASON_PRACTICE_TASK_2026-11-19.md`.

## 상태 구분

| 단계 | 상태 |
| --- | --- |
| 구현 | 완료 (아래 파일) |
| 핵심 단위 테스트 작성 | 완료 `web/tests/season-practice-bundle.test.mjs` (4개 테스트) |
| 핵심 단위 테스트 실행 | **실행하지 못함.** `node --test tests/season-practice-bundle.test.mjs`를 Bash와 PowerShell에서 각각 한 번 시도했는데 둘 다 승인 요청 단계에서 막혔다("requires approval"). 지시에 따라 다시 시도하지 않았다. |
| 타입 검사 | 실행하지 않음(명령 실행 승인 없음). 수동 검토만 함. |
| 브라우저/통합/전체 npm | 지시에 따라 실행하지 않음 |

따라서 이 기능은 **구현 완료, 아직 검증 안 됨** 상태다. 다음 담당자가 먼저 `node --test tests/season-practice-bundle.test.mjs`와 `tests/practice-roster-bundle.test.mjs`, `tests/draft-practice-library.test.mjs`(회귀 확인)를 실행하고 타입 검사를 해야 한다. 공유 함수 `buildPracticeContent`/`parsePracticeContent`/`read`의 반환값에 `season` 필드가 추가됐고 `RosterMeta`에도 `season` 필드가 추가됐다.

## 저장 형식

- 연습 내용(scenarios store)
  - 기존 plain draft 문자열: 변경 없음(entry v1).
  - `practice-bundle` v1 `{artifact_type, schema_version:1, draft, roster}`: 변경 없음(entry v2).
  - **신규** `practice-bundle` v2 `{artifact_type, schema_version:2, draft, roster, season}`: entry v3.
  - `season = { catalog_id, cutoff, lineups: { [teamId]: { TOP..SUPPORT: SeasonCardRef | null } } }`. 선택한 카드의 `SeasonCardRef`(catalog_id/card_id/player_id)와 카탈로그 기준 식별자(catalog_id + cutoff)만 저장한다. 선수 이름, 경기 수, 챔피언 등 카드 내용은 저장하지 않는다.
- 항목 메타(entries store) v3: summary에 `roster: true, season: true`가 정확히 들어 있어야 한다. 읽을 때 메타와 내용이 맞지 않으면 CORRUPT로 처리한다. 예: v3인데 내용에 season이 없음, v2인데 내용에 season이 있음, v1 envelope에 season이 들어 있음.
- 크기: `MAX_SEASON_PART_BYTES = 8KB`, `MAX_PRACTICE_CONTENT_BYTES = draft + roster + season + 1KB`. 기존 draft/roster 개별 한도는 그대로다.
- IDB: 기존 단일 readwrite 트랜잭션(entries + scenarios 동시 기록, 같은 트랜잭션 안에서 5개 한도와 이름 중복 검사)을 그대로 쓴다.

## 검증 규칙

- 구조 검증 `parseSeasonPart`(저장과 읽기 모두, 카탈로그 없이 수행):
  - lineups의 팀 키가 roster의 두 팀과 정확히 같아야 한다. 각 팀은 역할 5개.
  - 모든 ref가 같은 catalog_id를 써야 하고, 형식은 해시 / 해시 / player_id다.
  - ref가 최소 하나는 있어야 한다.
  - 현재 선수가 있는 슬롯에는 시즌 선수를 넣을 수 없다.
  - 두 팀을 통틀어 현재 선수와 시즌 선수의 player_id가 겹치면 안 된다.
  - 어긋나면 `INVALID_SEASON`으로 전체를 거부한다.
- 카탈로그 검증 `verifySeasonPart`(복원 시): 현재 공개 카탈로그와 비교해 다음을 확인한다.
  - `catalog_id`와 `cutoff`가 같아야 한다. 다르면 `CATALOG_CHANGED`.
  - 각 ref는 card_id + player_id + 역할이 모두 맞는 카드로 해석돼야 한다. 기존 `validateSeasonLineup`/`resolveSeasonRef`를 그대로 재사용하며, 실패하면 `CARD_MISSING`.
  - 카탈로그가 없으면 `NO_CATALOG`.
  - 실패하면 한국어로 "현재 밴픽과 선수 구성은 그대로 유지합니다"라고 안내한다.
- 카탈로그 로딩: 신규 `web/app/season-catalog-loader.ts`가 기존 `fetchJsonWithTimeout` → `parseSeasonCardCatalog` → `verifySeasonCardIntegrity`를 같은 순서로 호출한다. 카탈로그를 새로 만들지 않고 이름으로 연결하지도 않는다. `season-lineup-panel.tsx`의 인라인 로더는 소유 파일이 아니어서 그대로 뒀다(같은 단계의 중복).
- 저장 가능 조건(roster-workshop `RosterMeta.season`):
  - 시즌 선수가 배정돼 있고, 카탈로그가 로드돼 있고, 모든 ref가 현재 로스터와 함께 공용 규칙을 통과할 때만 season part를 만든다.
  - 시즌 선수는 있는데 이 조건을 못 채우면 선수 구성 저장을 막고 안내한다. 이때 밴픽만 저장할 수 있다.
  - 시즌 선수를 현재 선수 로스터에 넣어 저장하지 않는다.

## 복원 흐름 (panel → draft-lab → roster-workshop)

1. `library.read`로 구조 검증까지 마친다.
2. 게이트를 확인한다.
3. season이 있으면 "시즌 자료 확인 중"을 표시하고, `AbortController`를 걸어 카탈로그를 불러온다. 이 동안 "불러오기 취소" 버튼을 보여준다.
4. 로드가 끝나면 다음을 다시 확인한다.
   - generation 토큰(새 요청이나 언마운트)
   - 게이트(밴픽·팀 변경, 로스터·시즌 변경, 방 시작·잠금)
   - 사용자 취소 여부
5. `verifySeasonPart`를 실행한다.
6. 모두 통과했을 때만 `onLoad(session, roster, {catalog, lineups})`를 **한 번** 호출한다. 실패하면 아무것도 적용하지 않는다.
7. 진행 중인 카탈로그 요청은 boardKey나 잠금이 바뀌거나 컴포넌트가 언마운트되면 즉시 중단(abort)한다. 늦게 도착한 결과는 게이트 검사에서 거부된다.
8. draft-lab: `restoreSession(session)`을 실행하고, liveRoster를 일단 비운 뒤 `rosterRequest {token, roster, season}`를 보낸다. 기존 토큰 방식을 그대로 써서 한 번만 적용된다.
9. roster-workshop: 기본 정보(basis)와 팀 조합(pair)이 일치하는 편집기만 적용한다.
   - `validateRosters`와 `validateSeasonLineup`을 다시 확인한다. 실패하면 로스터와 시즌 둘 다 적용하지 않고 기존 상태를 유지한다.
   - 성공하면 `seasonCatalog`, `seasonLineups`, `rosters`를 함께 설정한다.
   - 이 기기에 저장하는 사본은 기존대로 현재 선수만 담는다(시즌 제외).
10. 명시 복원 effect는 장치 사본 복원 effect보다 먼저 선언돼 있다. 이 순서를 유지하므로 장치 로스터가 나중에 덮어쓰지 않는다. 로스터 준비 gate(`restored` 전에는 게시하지 않음)도 그대로다.
11. v1 bundle 복원은 기존과 같다(시즌 배정 해제). plain draft 복원은 로스터를 바꾸지 않는다.

시즌 기록은 당시 관측일 뿐이며, 능력치나 승률로 쓰거나 표시하지 않는다. 추천, A/B 비교, 시뮬레이션에도 연결하지 않았다.

## 수정 파일

- `web/app/practice-roster-bundle.ts`: bundle v2, `parseSeasonPart`, `verifySeasonPart`, 크기 상수.
- `web/app/draft-practice-library.ts`: entry v3, `entryHasSeason`, `INVALID_SEASON` 오류 문구. `save`에 season 인자, `read`에 season 반환을 추가했다.
- `web/app/draft-practice-library-panel.tsx`: season 저장 체크/문구, 카탈로그 확인 복원, 취소 버튼, abort 처리.
- `web/app/roster-workshop.tsx`: `RosterMeta.season`, season을 포함한 명시 복원, 안내 문구.
- `web/app/draft-lab.tsx`: season 연결, 저장 차단 조건 변경, 카탈로그 로더 주입.
- 신규 `web/app/season-catalog-loader.ts`, 신규 `web/tests/season-practice-bundle.test.mjs`.
- 다음 파일은 변경하지 않았다: `season-player-cards.ts`, `guest-club.ts`, `season-lineup-panel.tsx`, `package.json`. 새 테스트는 package.json의 test 스크립트에 등록돼 있지 않다.

## 테스트가 다루는 내용 (작성만 함, 실행 결과 없음)

1. 왕복: draft + 현재 로스터 + season ref를 저장 후 읽으면 같고, 입력이 변형되지 않는다. 저장 내용에 이름이 들어가지 않는다. `verifySeasonPart`가 통과한다. v1 bundle과 plain draft도 그대로 읽힌다.
2. 카탈로그 불일치: 카탈로그 없음, catalog_id 다름, cutoff 다름, card_id 없음, player_id 다름, 카드 제거, 다른 역할 슬롯.
3. 중복: 현재 선수가 있는 슬롯에 시즌 선수, 두 팀에 같은 시즌 선수, 시즌 player_id가 현재 선수와 같음, roster 없이 season만 있음. 모두 거부되고 아무것도 기록되지 않아야 한다.
4. 손상과 한도: season 키 없음, 여분 키, 잘못된 해시, 섞인 catalog_id, 빈 시즌, v1 envelope에 season, v3 메타에 v1 내용, v2 메타에 v2 내용, 크기 초과, season 8KB 초과, 5개 한도, v3 summary 위조.

## 남은 위험 / 확인 필요

- 테스트와 타입 검사를 실행하지 않았다. 픽스처(현재 feed의 팀, 실제 카탈로그 카드)가 가정과 다르면 테스트를 조정해야 할 수 있다.
- 패널의 비동기 경합(취소, 게이트)은 단위 테스트 범위 밖이다. 브라우저 통합 배치에서 확인해야 한다.
- 장치 사본에는 시즌 배정이 들어가지 않는다(기존 설계 그대로). 새로고침하면 시즌 배정이 사라지고, 다시 보려면 연습 보관함이나 구단 저장에서 불러와야 한다.


## Codex 후속 확인

Claude 완료 세션 ea8d44c9-6218-45bc-9e50-ab6bde16c8d9, is_error=false. 첫 기본환경 실행은 DNS ENOTFOUND로 구현 전에 종료됐고, 네트워크 허용 환경 실행에서 구현했다. Claude의 실행 승인 제한으로 미실행한 검사를 Codex가 직접 수행했다. 신규+기존 저장 핵심 15개 통과. 특수 팀 ID `__proto__`가 자기 키로 유지되지 않는 신규 결함을 재현한 뒤 안전한 자기 속성 작성으로 수정했고 회귀 검사를 추가했다. 테스트를 package.json에 등록했다. 타입/변경 파일 lint 최종 결과는 아래 체크포인트를 따른다. 실제 브라우저 시즌복원·취소/팀변경 경합과 전체 회귀는 아직 미검증이다. 제품 배포 없음.

최종 변경 범위 확인: 저장 관련 15/15, TypeScript, 변경 파일 ESLint, git diff --check 통과. 전체/브라우저 검사는 이번에 실행하지 않았다.
