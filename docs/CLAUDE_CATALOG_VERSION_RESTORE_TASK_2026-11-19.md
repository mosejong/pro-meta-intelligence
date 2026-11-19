# 연습 보관본의 시즌 카탈로그 버전 복원

Claude Opus5.5 medium. 기존연습은catalog_id/cutoff정확일치만복원한다. 새시즌카드추가때옛연습이불필요하게열리지않는문제를 줄이기 위해, 같은 사이트에 보존된 불변 카탈로그로의 안전한 fallback을 추가한다. 버전을 무시하거나 ref를이름/현재카드로매핑하는작업아님.

소유 web/app/season-catalog-loader.ts, draft-practice-library-panel.tsx, draft-lab.tsx, 신규 web/tests/season-catalog-loader.test.mjs, docs/CLAUDE_CATALOG_VERSION_RESTORE_RESULT_2026-11-19.md. 다른파일/public카탈로그/git/package/네트워크/설치/fulltest/browser/subagent금지.

loadPublishedSeasonCatalog에 선택적 기대 {catalog_id,cutoff} 인자를추가하고, 기존2인자호환유지. 현재정적카탈로그를기존bounded fetch+parse+hashverify로확인. 기대버전과다르면 오직같은publicationRoot의 history/catalogs/<64소문자hex catalog_id>.json 하나만 fallback으로요청(유효hash와timezone-aware cutoff만허용, path삽입금지). fallback도parse/hashverify 및기대id/cutoff정확일치필수. 현재요청이네트워크/timeout/404실패한경우 유효기대버전이있으면fallback한번허용, abort면절대fallback안함. 총재시도루프없음. 검증실패/둘다없음은명확한한국어오류, 상태대체없음. 선택적fetch 의존성주입이나테스트용window설정으로비네트워크단위검사가능. 자료위조/잘못된hash/future형식은기존검증재사용.

panel은savedSeason의id/cutoff를 loader(signal, expected)에전달하도록확장(선택적인자라기존1인자대역호환). 나머지검증/gate/abort/원자복원유지. draft-lab loader는publicationRoot와expected연결. verifySeasonPart은변경금지,정확일치계속유지. 실제구단저장/수동시즌패널까지자동마이그레이션확대하지않음. fallback카탈로그정적파일보존은Codex가확인뒤별도준비.

단위: 현재일치1요청/다른버전fallback정확2요청/현재404fallback/잘못된해시요청전거부/원격URL삽입거부/위조catalog거부/abort추가요청없음. 테스트해당파일만시도,승인거부시반복없이보고. 실제효과·승률추가없고명시한도시정확오류/reset기록후종료,과금우회없음.
