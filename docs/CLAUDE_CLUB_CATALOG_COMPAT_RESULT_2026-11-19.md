# 구단 시즌 카드 버전 호환 결과 (2026-11-19)

작업: Claude Opus 5.5 (medium). 근거 과제: `docs/CLAUDE_CLUB_CATALOG_COMPAT_TASK_2026-11-19.md`.

## 배경
- 공개 current 카탈로그는 아직 기존 2022/2026 카드다. 2015 추가 병합 검토본은 `outputs/season-cards-2015-merged-preview.json`에만 있다.
- 구단 저장 v2의 `SeasonCardRef`는 `catalog_id`, `card_id`, `player_id`만 저장한다. 카드가 추가되면 `catalog_id`가 바뀌어서, 지금까지는 저장된 구단이 무조건 거부됐다.

## 변경 내용
1. `web/app/season-catalog-loader.ts`: `loadPreservedSeasonCatalogById(publicationRoot, catalogId, signal, options)`를 추가했다.
   - 요청 전에 hash 형식(소문자 hex 64자리)부터 검증한다. 요청은 같은 publicationRoot 아래 `history/catalogs/<catalogId>.json` 한 경로만 보낸다. 같은 origin/경로 접두사인지도 확인한다.
   - 기존과 같은 bounded fetch → strict parse → SHA-256 무결성 검증을 거치고, `catalog_id`가 정확히 같아야 받아들인다. abort는 그대로 다시 던진다.
   - cutoff는 검증하지 않는다. 구단 v2에 cutoff가 없기 때문이다. 기존 연습용 `loadPublishedSeasonCatalog`의 catalog_id+cutoff 검증은 바꾸지 않았다.
2. `web/app/club-season-compat.ts` (신규, pure 함수만):
   - `savedSeasonCatalogId(club)`: 구단 ref들이 함께 쓰는 단 하나의 catalog_id를 돌려준다. ref가 없으면 null이고, 여러 버전이 섞여 있으면 거부한다.
   - `migrateClubSeasonSlots(club, saved, current)`: 각 ref를 저장 당시 카탈로그에서 id/player/role이 정확히 같은 카드로 해석한다. 현재 카탈로그에서 같은 id의 카드를 찾아, 키를 정렬한 canonical JSON으로 전체 내용을 비교한다(이름, 팀명, 경기 수, 챔피언별 횟수, 패치, source_hashes 포함). 모든 카드가 완전히 같을 때만 `catalog_id`를 현재 id로 바꾼 분리 복사본을 돌려준다. 원본은 바꾸지 않는다. 이미 현재 버전인 구단은 바뀌지 않은 복사본을 돌려준다. 경기 효과는 추가하지 않았다.
3. `web/app/guest-club-panel.tsx`의 불러오기 확정:
   - 현재 seasonCatalog가 있고 저장된 ref 버전이 다를 때만 보존 카탈로그를 한 번 읽는다. 그다음 helper → 기존 `applyGuestClub`(기준·중복·양 진영 시즌 검증) 순서로 모두 통과해야 roster와 season slots를 한 번에 적용한다. 검증이 끝나기 전에는 어느 쪽 상태도 바꾸지 않는다.
   - localStorage에 저장된 구단(id/revision/createdAt/ref)은 다시 쓰지 않는다. 런타임 상태에만 현재 버전 ref가 들어가므로, 다른 진영과 서로 다른 버전 자료가 섞이지 않는다.
   - 늦은 결과 차단: 팀, 진영, basis, rosters, seasonLineups, seasonCatalog, disabled(방 시작), publicationRoot가 바뀌거나 unmount되면 effect cleanup에서 abort한다. 취소 버튼(로딩 중에도 누를 수 있음)과 다른 탭의 storage 변경도 abort한다. await 뒤에 abort 여부를 다시 보고, localStorage의 저장 구단이 그대로인지도 다시 확인한다. 성공 문구는 적용한 뒤에만 표시한다.
   - busy 상태라 작업이 중복되지 않는다. 실패하면 한국어 사유를 보여 주고 기존 로스터를 유지한다. 삭제와 일반(현재 선수) 저장 경로는 그대로다.
4. `web/app/roster-workshop.tsx`: `publicationRoot` prop만 연결했다.
5. `web/tests/club-season-compat.test.mjs` (신규): 다음 경우를 다룬다.
   - 동일 카드만 버전 변환, 입력 불변
   - 현재 버전 그대로
   - 경기 수, 챔피언 횟수, source hash, 이름, 팀명, 패치가 바뀌면 거부
   - 누락, 역할 변경, player_id 변경, 위조 ref, 자리 이동 거부
   - 섞인 버전, 엉뚱한 저장 카탈로그 거부
   - loader: 단일 요청 경로, 무효 id는 요청 0회, SHA 위조, current를 old 경로로 바꿔치기, 404, abort

## 미검증 / 한계
- **테스트를 실행하지 못했다.** `node --test web/tests/club-season-compat.test.mjs` 실행에 승인이 필요했고, 지시대로 다시 시도하지 않았다. typecheck, lint, 전체 테스트, 브라우저 확인도 하지 않았다.
- 구단 v2에는 cutoff가 없다. 그래서 이 경로는 "저장 당시 공개되어 있던 시점의 자료"인지 검증하지 않는다. 보장하는 것은 저장된 catalog_id의 내용 무결성(SHA)과, 저장 카드와 현재 카드가 내용 면에서 완전히 같다는 점뿐이다.
- 보존 아카이브(`history/catalogs/<id>.json`)가 공개되어 있지 않으면 불러오기는 실패한다. 이때 사유를 보여 주고 기존 로스터를 유지한다. 2015 병합본을 public current로 올릴 때는 기존 2022/2026 카탈로그 아카이브도 함께 게시되어 있어야 한다. 이번 작업에서는 public 파일을 건드리지 않았다.
- 저장 구단 자체는 이전 catalog_id를 계속 가리킨다. 불러올 때마다 아카이브를 한 번씩 읽는다.


## 2015년 카드 로컬 연결 완료

구단구버전참조는보존본해시검증후선택카드전체내용이현자료와완전히같은경우에만runtime ref를맞춘다. 저장club원본id/revision/시각/refs는수정하지않는다. 내용변경시거부. 관련27개와카탈로그통합관련26개통과. 실제PC에서예전카탈로그로너구리구단저장→현재확장카탈로그로재접속→보존본확인→기존구단복원/저장원본불변→2015 MaRin선택114경기표시1개통과. 변경컨텍스트에서늦은응답이적용되지않도록layout단계abort로보강했다. 타입/변경lint통과.

로컬현재카탈로그는2015·2022·2026총1,324카드로연결했다. 기존1,184카드는내용을그대로보존하고2015 140개만추가했다. 기존/새카탈로그2개는해시별보존파일로명시허용목록에추가한다. 제품push/공개배포없음. 실제선수효과/승률계산에과거선수를연결한것은아니다.
