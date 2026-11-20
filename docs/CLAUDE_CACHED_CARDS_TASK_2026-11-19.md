# 서버 보관 원본으로 시즌 카드 사전 생성

이 worktree는 제품과분리된 운영전용 feat/cached-season-cards-20261119. Claude Opus5.5 medium. 현재 cached-history-audit.yml 신뢰artifact검증/복원/감사를 그대로 유지하면서 선택적 build_cards boolean workflow_dispatch input(defaultfalse)을 추가한다. true면 성공한 requested year admission이 USABLE 또는 USABLE_WITH_REJECTIONS인지 JSON으로확인한뒤 기존 build_season_player_cards.py를 오프라인으로실행: archive-dir 기존복원경로, feed web/public/feed/current.json, candidate-season 2022와requested year, output outputs/cached-season-cards/season-player-cards.json. 생성실행stdout집계report는같은디렉터리build-report.json. 별도의 조건부 upload-artifact로 이2파일만14일보관. 기존 감사보고서 업로드2개는변경하지않는다.

중요: 공급자요청/ledger갱신/repack/공개피드/Pages/gitpush/생성catalog저장소수정/출처추가 없음. permissions read유지, manualonly, 미선택일때기존동작동일. unsafe input쉘주입없게 env 사용, year는기존정수검증만. 생성실패면 기존감사는보존, 새카드artifact는성공시에만. artifact는사전검토용이며공개반영아님. source raw/key/token출력금지. 기존 artifact다운로드 validator 및암호복원코드 건드리지말것.

소유 .github/workflows/cached-history-audit.yml, 신규 tests/test_cached_season_cards_workflow.py, docs/CACHED_HISTORY_AUDIT.md. 다른파일수정/네트워크/설치/git/fulltest/subagent금지. 신규핵심테스트작성하고그것과기존test_cached_history_audit_workflow.py만실행시도. 승인단계거부는반복말고부모보고. 한도오류면정확오류/reset기록후종료. 구현결과docs에요약. 실제서버실행/생성완료는아직아님.
