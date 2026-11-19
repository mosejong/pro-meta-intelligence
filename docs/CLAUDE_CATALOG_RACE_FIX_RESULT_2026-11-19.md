# R1 수정 결과: 늦은 수동 카탈로그가 복원을 덮어쓰는 결함 — 2026-11-19

Claude Opus 5.5 (medium). 대상 결함: `docs/CATALOG_RESTORE_REVIEW_2026-11-19.md` R1(P2).

## 변경 파일

- `web/app/season-lineup-panel.tsx` (제품 수정)
- `web/tests/season-catalog-race.test.mjs` (신규 검사)
- 이 문서

다른 소스·package·저장 형식·부모(`roster-workshop.tsx`) 연결은 바꾸지 않았다. git/network/install/full test/browser/subagent 미사용.

## 수정 내용 (`season-lineup-panel.tsx`)

1. **최신 props ref**: `live = useRef({ catalog, disabled, onCatalog })`를 매 commit의 `useLayoutEffect`에서 갱신한다. 적용은 `live.current.onCatalog`로만 하므로 시작 시점 클로저의 오래된 `onCatalog`를 호출하지 않는다.
2. **layout 단계 무효화**: `useLayoutEffect(() => () => invalidate(), [catalog, disabled])`. 같은 편집기에 보관함 복원이 카탈로그를 commit하거나 `disabled`가 바뀌거나 unmount되면, 이 cleanup이 진행 중 요청을 abort하고 `request.current = null`, `setBusy(false)`로 정리한다(busy 영구 잔존 방지). 기존 unmount 전용 `useEffect`는 이 cleanup이 대체한다.
3. **적용 직전 재확인**: `valid()` = `request.current === controller` && 미중단 && `live.current.catalog === 시작 당시 카탈로그(null)` && `!live.current.disabled`. 성공 적용(`onCatalog`, 연도 보정)과 실패 메시지 모두 `valid()`일 때만 실행한다.
4. **busy 정리**: `finally`는 자신이 아직 최신 요청일 때만 `request.current = null; setBusy(false)`. 무효화된 요청의 busy는 `invalidate()`가 이미 해제했고, 새 요청이 대체한 경우 새 요청의 busy를 건드리지 않는다.
5. 진입 가드: 이미 카탈로그가 있거나 disabled면 `load()`는 아무것도 하지 않는다. 연도 보정은 `setYear(y => …)` 함수형으로 바꿔 오래된 `year` 클로저를 쓰지 않는다.

자기 요청 성공 시: `onCatalog` → `finally`에서 request 해제 → 이후 catalog commit의 cleanup은 대기 요청이 없어 무동작. 실패 후 재시도: 실패 메시지·busy 해제 후 버튼으로 새 요청 가능.

카드 참조를 현재 카탈로그로 강제 이전하거나 검증을 완화하지 않았다.

## 무효화 조건과 남은 한계

- 무효화 시점은 **React commit(layout) 단계**다. 부모의 복원이 `setSeasonCatalog(old)`를 호출했지만 아직 commit되지 않은 아주 짧은 구간에 수동 응답이 도착하면, `live.current.catalog`는 아직 null이므로 `onCatalog(current)`가 같은 배치 뒤에 큐잉되어 이길 수 있다. 이 구간을 닫으려면 부모가 함수형 setter/세대 토큰을 써야 하며 소유 범위 밖이라 변경하지 않았다. Codex의 실제 브라우저 순서 검사(수동 보류→복원 완료·화면 반영→수동 응답)는 이 구간 밖이므로 차단되어야 한다.
- `fetchJsonWithTimeout`은 signal로 중단되지만, 이미 받은 데이터의 parse/verify는 계속될 수 있다. 결과는 `valid()`에서 버린다.

## 기존 독립 검사와의 관계

`web/tests/catalog-restore-review.test.mjs`의 첫 검사(R1 재현)는 `load` 선언만 AST로 추출하고 `request/onCatalog/...`만 주입한다. 수정 후 `load`는 `live`·`invalidate`를 참조하므로, 그 검사는 이제 `ReferenceError`로 **실패할 것으로 예상**된다(재현 단언에 도달하지 못함). 이는 React effect를 실행하지 않는 검사의 구조적 한계이며, 검사를 통과시키려고 제품을 왜곡하지 않았다. 해당 파일은 읽기 전용이라 수정하지 않았다. 나머지 5개 검사는 이 파일을 쓰지 않아 영향이 없을 것으로 본다.

## 신규 검사 (`web/tests/season-catalog-race.test.mjs`)

실제 `invalidate`·`load` 선언을 AST로 추출해 공유 ref로 묶고, layout cleanup은 "catalog/disabled가 바뀌면 `invalidate()` 후 `live.current` 갱신"으로 모사한다(React 미mount). 이 모사가 소스와 일치하는지 소스 문자열로 effect 배선을 확인한다.

1. 소스 배선: `[catalog, disabled]` layout cleanup과 `live` 갱신 effect 존재.
2. 보류 중 외부 복원 commit → 응답 완료 후에도 `onCatalog` 0회, 복원 카탈로그 유지, busy=false.
3. disabled 전환 / unmount → `onCatalog` 0회, busy=false.
4. 자기 요청 성공 → 시작 후 바뀐 최신 `onCatalog`로 1회 적용, busy=false, 이후 자기 catalog commit 무해.
5. 실패 → 메시지·busy 해제 → 재시도 성공. 대체된 이전 요청 응답은 무시되고 새 요청의 busy를 해제하지 않음.

## 실행 결과

**미실행.** `node --test tests/season-catalog-race.test.mjs tests/catalog-restore-review.test.mjs` 실행을 PowerShell과 Bash에서 각각 한 번 시도했으나 명령 승인이 거부되어 반복하지 않았다. typecheck/lint도 실행하지 않았다. 따라서 위 기대 결과(신규 5/5 통과, 기존 R1 재현 검사 실패)는 코드 추적에 근거한 예상이며 검증되지 않았다.


## 최신 통합 확인

저장 경합·게시 staging 격리·친구방 공개경로 차단·세트 글공유를 포함한 웹429개통과. 타입/변경lint통과, 실제카탈로그경합 수정전실패/수정후보존1개, 실제피어리스3세트완료/글공유/전환시옛표시해제1개통과. 신규공유검사의실제U+2028/2029가포함된정규식구문오류는코드포인트검사로수정했다. 세부현재상태는 IMPLEMENTATION_CHECKPOINT_2026-11-19.md에모았다. 공개제품기능배포없음.
