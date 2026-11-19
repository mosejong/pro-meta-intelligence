# 시즌 카드 추가 시 기존 구단 보존

Claude Opus5.5 medium. 현재2015추가병합검토본은outputs/season-cards-2015-merged-preview.json, 아직publiccurrent는기존2022/2026다. 구단 저장v2는SeasonCardRef.catalog_id만저장하므로 새카드추가시다른catalog_id로거부된다. 저장원본을덮어쓰지않고, 저장당시카드내용이현자료에서도완전히같을때만명시불러오기를안전하게지원.

소유 web/app/guest-club-panel.tsx, roster-workshop.tsx(최소prop연결만), season-catalog-loader.ts, 신규 web/app/club-season-compat.ts, 신규 web/tests/club-season-compat.test.mjs, docs/CLAUDE_CLUB_CATALOG_COMPAT_RESULT_2026-11-19.md. 기존guest-club.ts/season-player-cards.ts읽기만, public/catalog/package/git/네트워크/설치/fulltest/browser/subagent금지.

1. loader에보존catalog_id만받는함수추가. 구단v2에는cutoff없으므로없던시점검증한다고주장금지. hash형식선검증, 같은publicationRoot의history/catalogs/<hash>.json 한경로만요청, 기존boundedfetch/parse/SHA검증/정확catalog_id필수. abort보존. 새외부URL/key없음. 기존연습loadPublished... 기대cutoff검증은유지.
2. pure helper는저장club의seasonref를oldcatalog에서정확id/player/role로해석, 현재catalog의동일card와전체내용을canonical키정렬비교해완전히같을때만ref.catalog_id를현재id로바꾼분리복사본반환. 이름join/사용횟수변경/없는카드/역할변경/identity변경/섞인oldcatalogref는거부. source_hashes와championcounts포함한전체카드동일성,원본불변. 현재와같은catalog는기존경로. 실제경기효과추가없음.
3. GuestClubPanel 불러오기확정에서 현재seasonCatalog가있고저장ref다른경우 oldcatalog를한번읽어검증/helper후기존applyGuestClub/중복검증을통과시켜 runtime클럽만적용. localStorage저장club/id/revision/createdAt원본불변. 적용한seasonslots는현재catalogref이므로다른진영과혼합자료문제없음. 다르면정확한국어거부+기존로스터보존. publicationRoot는roster-workshop에서전달. 로딩중취소/팀·진영·basis·roster·season변경/방시작/unmount/타탭저장변경은abort또는generation/token로늦은적용·성공문구차단. await후저장club변경도재확인. busy상태로중복작업차단,취소는가능. 이미한쪽자료를바꾼뒤실패하지않도록검증후한번적용. 기존삭제/일반현재선수저장호환유지.
4. 관련helper단위: 동일카드만버전변환/입력불변/통계·sourcehash·역할·이름·ID변경·누락거부/혼합버전거부. loader무효hash와SHA위조차단가능하면단위추가신규파일에서. 단위해당신규파일만시도,승인거부는반복없이보고. 한도면오류/reset기록후종료과금우회없음. 문서에미검증/구단v2시점한계명시.
