# 병렬 B 결과: 친구 방 재시작 복원 · 2026-11-19

## 상태
- 구현과 필수 수정 2건(TS narrowing, 공개 경로 차단 강화)을 마쳤다.
- **이번 세션에서는 테스트와 타입체크를 실행하지 못했다.** `node --test …`, `npx tsc --noEmit …`가 모두 권한 승인 대기로 막혔고, 반복 시도는 하지 않았다. 아래 "검증"은 정적 검토 결과이며 통과 기록이 아니다. 통합 관문에서 실행해야 한다.

## 변경 파일 (소유 범위만)
- `web/server/draft-room-persistence.ts` (신규): 파일 백엔드, 상태 encode/decode, 복원 검증, 경로 가드.
- `web/server/draft-room-store.ts`: 선택적 `persistence` 옵션, 트랜잭션 방식 create/join/act, `storage` getter, sweep 정리.
- `web/server/draft-room-http.ts`: `persistence` 옵션 전달, `/health`의 `storage` 값이 실제 모드(`ephemeral`|`file`)를 따름.
- `web/server/run-draft-room.ts`: `DRAFT_ROOM_STATE_FILE`이 있을 때만 파일 모드 사용. 경로와 토큰은 로그에 남기지 않음.
- `web/tests/draft-room-persistence.test.mjs` (신규, 8 tests).
- Codex 소유 `draft-room-persistence-review.test.mjs`, `draft-room-restart-review.test.mjs`는 수정하지 않았다. 별도 HTTP 재시작 테스트(`draft-room-persistence-http.test.mjs`)는 만들지 않았다. Codex의 restart-review가 같은 범위를 다룬다.

## 필수 수정
1. **TS18046 (`action` unknown)**: `fail`을 `never`를 반환하는 *함수 선언*으로 바꿨다. 화살표 const로는 TS가 타입을 좁히지 않는다. 액션 항목은 타입 가드 `isActionEntry(value): value is [string, string]`로 검증한다. `stat`/`bytes`의 non-null `!`와 any 우회는 없앴고, `stat`은 `Stats`로 명시했다.
2. **공개 경로**: 차단 패턴을 `public|static|www|htdocs|_site|build|out|dist(-*)|.next|.output|.vercel|.netlify`로 넓혔다(대소문자 무시). 이 패턴으로 `dist-pages`, `dist-room-pages`, `.next`가 막힌다.
   - 경로의 가장 가까운 기존 상위 디렉터리를 `realpathSync.native`로 해석해 나머지 경로를 다시 붙이고, 원래 경로와 실제 경로를 둘 다 검사한다. 그래서 junction이나 symlink 상위 폴더를 거쳐 public이나 forbiddenRoot에 닿을 수 없다. forbiddenRoot 쪽도 realpath로 비교하며, Windows에서는 대소문자를 무시한다.
   - 포함 여부 판정(`inside`): `path.relative` 결과가 정확히 `..`이거나 `..` 뒤에 플랫폼 구분자가 올 때만 root 밖으로 판정한다. 이전 구현은 `startsWith("..")`를 써서 `..cache`처럼 점 두 개로 시작하는 정상 하위 폴더를 root 밖으로 잘못 보고 허용했다(Codex 리뷰 지적, review 테스트의 custom served root 회귀 케이스). realpath 해석과 Windows 대소문자 정규화는 그대로 유지했다.
   - 이 가드는 생성 시점뿐 아니라 **매 load/save 직전에도** 다시 실행된다. 실행 중에 링크를 바꿔치기하는 경우를 막기 위해서다.
   - runner는 cwd 기준 `public`, `dist`, `dist-pages`, `dist-room-pages`, `.next`와 feed 디렉터리를 forbiddenRoots로 넘긴다.

## 동작 계약
- 기본은 ephemeral(메모리 전용)이다. 빈 문자열 `DRAFT_ROOM_STATE_FILE`은 `INVALID_PATH`로 시작을 거부한다.
- 복원 조건: schema/version이 맞고, feed identity(공개 report JSON의 sha256, patch_id, cutoff, model_version)가 같아야 한다. 공개 report는 `isRadarReport`로 다시 검증한다. 드래프트는 store가 쓰는 검증기(`completeFearlessGame`, `applyDraftSelection`, `fearlessLocks`)로 다시 재생해 저장값과 정확히 같아야 한다. 토큰은 형식과 중복을 검사하고, seat와 guest 일관성, status 재계산, 액션 키와 지문도 확인한다.
- 위 조건 중 하나라도 어기면 서버 시작이 거부된다(`PersistenceError` 코드만 내보내고 경로와 토큰은 넣지 않음). 원본 파일은 덮어쓰지 않는다.
- 만료된 방은 복원하지 않고 버린다. `expiresAt`은 연장하지 않으며, now+TTL보다 먼 값이면 `EXPIRY_INVALID`로 거부한다. sweep과 만료 접근 때 파일 정리를 시도하되, 실패해도 무시한다(만료는 시간으로 결정되므로 다음 복원에서 어차피 버려진다).
- 트랜잭션: 복제한 snapshot과 actions에 변경을 적용하고, 원자적으로 저장한 뒤에야 메모리에 반영하고 notify하고 응답한다. 저장이 실패하면 503 `STORAGE_UNAVAILABLE`을 돌려주고 메모리, 리스너, 파일, 액션 ID 어느 것도 바뀌지 않는다.
- 원자적 쓰기: 같은 디렉터리에 임시 파일을 `wx`, 0600으로 열어 write와 fsync를 한 뒤 rename한다. 실패하면 임시 파일을 지운다.
- 멱등성: 액션 지문을 `[kind, championId]`의 sha256(base64url)로 바꿔 크기를 고정했다. 의미는 기존과 같다.
- 제한: 파일 8 MiB, 방 수 min(1000, maxRooms), 방당 액션 256, selections 20, games 9.

## 보안 한계 (과장 금지)
- 상태 파일은 host/guest/invite/view 토큰을 **평문**으로 담는 서버 전용 민감 credential 파일이다. 암호화는 없다.
- POSIX에서는 0600으로 만들고 chmod를 시도한다. Windows에서는 POSIX 모드가 무시되고 ACL을 따로 강화하지도 않는다. 디렉터리 권한은 운영자가 관리해야 한다.
- 단일 프로세스, 단일 writer만 지원한다. 다중 프로세스 lock, 분산 DB, 동시 writer는 지원하지 않는다.
- 경로 검사와 실제 open/rename 사이의 TOCTOU 경쟁을 완전히 없애지는 못한다. 같은 호스트에서 쓰기 권한을 가진 공격자는 위협 모델 밖이다.
- 쓰기는 동기식이고 매 변경마다 전체 파일을 다시 쓴다. 프로토타입 규모에서만 적절하다.

## 검증 (미실행, 정적 검토만)
- 실행해야 할 명령(web cwd 기준): `node --test tests/draft-room-persistence.test.mjs tests/draft-room-persistence-review.test.mjs tests/draft-room-restart-review.test.mjs tests/draft-room-store.test.mjs tests/draft-room-http.test.mjs`, 그리고 타입체크.
- 정적 확인 내용: review 테스트의 4개 폴더는 패턴에 걸리고, junction 별칭은 realpath가 `public`으로 해석돼 `PUBLIC_PATH`가 된다. restart-review의 snapshot deepEqual, 401/403/409, `storage: "file"`, 멱등 revision 2도 코드상 맞다. 기존 store/http 테스트가 의존하는 동작(오류 코드, 분리된 snapshot, ACTION_ID_REUSED)은 그대로다.
