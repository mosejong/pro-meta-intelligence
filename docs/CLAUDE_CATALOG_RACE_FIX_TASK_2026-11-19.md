# 독립 검토 R1: 늦은 수동 카탈로그가 복원을 덮어쓰는 결함 수정

Claude Opus5.5 medium. docs/CATALOG_RESTORE_REVIEW_2026-11-19.md와 web/tests/catalog-restore-review.test.mjs를 먼저 읽는다. 실제 재현된 P2 결함만 수정한다.

소유 web/app/season-lineup-panel.tsx, 신규 web/tests/season-catalog-race.test.mjs(필요한 경우만), docs/CLAUDE_CATALOG_RACE_FIX_RESULT_2026-11-19.md. 기존 독립 검토 보고서/검사는 읽기만, 다른 소스/package/git/network/install/fulltest/browser/subagent 금지.

외부 보관함 복원이 catalog를 설정하거나 편집 컨텍스트가 disabled로 바뀌면 이미 시작된 수동 카탈로그 요청을 layout 단계에서 무효화한다. 요청 완료 적용 직전에도 자신이 최신 요청이며 시작한 카탈로그/컨텍스트가 유효한지 확인한다. unmount/취소/외부 복원 이후에 옛 응답이 onCatalog를 호출하지 않게 한다. 자기 요청이 성공해 onCatalog를 호출하는 정상 경우와 실패 후 재시도는 계속 작동해야 하며 busy가 영구히 남지 않게 한다. 카드 참조를 현재 카탈로그로 강제 바꾸거나 검증을 완화하는 방식은 금지한다. 부모가 넘긴 onCatalog를 오래된 클로저로 잘못 호출하지 않도록 한다.

기존 load 함수만 AST로 추출한 독립 검사는 React effect를 실행하지 않아 수정 후에도 기존 재현을 그대로 보여줄 수 있다. 그 검사를 조용히 통과시키려고 제품을 왜곡하지 말고, 새 검사나 문서에 effect/세대 무효화 조건을 정확히 설명한다. Codex는 별도로 실제 브라우저의 수동 요청 보류→과거 보관함 복원→수동 응답 완료 순서를 검사한다. 구체적인 작은 수정만 하며 불필요한 저장 형식/아키텍처 변경은 하지 않는다. 단위 명령 승인 거부는 반복하지 말고 보고한다. 한도 오류면 실제 오류와 reset을 기록하고 종료한다. 추가 과금·모델 우회 금지.
