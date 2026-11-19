# 고정 기준 A와 비교 반환값 참조 분리

Claude Opus5.5 medium 구현·수정, Codex 검증. 이번은 목표핵심결함 수정이다. 읽기 최소 docs/GOAL_CORE_REVIEW_2026-11-19.md, web/tests/goal-core-review.test.mjs, web/app/draft-comparison.ts, roster-comparison.ts, 관련 draft-comparison/roster-scenario 테스트 중필요부분. 전체기획/대화불필요.

확정 반례(P2): 반환 roster changes[].a/b가캡처슬롯을직접노출한다. 공개자료로A생성→TOP/JUNGLE교환B생성→diff.roster.changes의a.player_id를b.player_id로바꾸면A의TOP선수ID도바뀐다. 독립agent와부모Codex 모두 신규회귀를실행해1fail확인. 실제화면에서이변조가발생하는사용경로는미확인. 사용자편집만으로A가바뀐다고과장하지말것. draft-comparison의selection/team변경반환도같은참조문제가능.

소유 제품 web/app/draft-comparison.ts, roster-comparison.ts만. 필요시 신규web/tests/draft-baseline-isolation.test.mjs, web/package.json 신규검사2개등록(이신규+기존Codex회귀goal-core-review.test.mjs)만. 기존실패회귀내용/기존단언/엔진/의존성/버전/입력·파일스키마/UI/원본보고서 변경금지. 신규docs/BASELINE_ISOLATION_FIX_2026-11-19.md에수정전·범위·한계기록. Bash/tests/git/network/subagents금지, Codex검사.

완료조건: compareDraftSnapshots/compareRosterCaptures의반환내용을수정해도A와B의선수ID/표시값/팀/선택/기준정보는바뀌지않음. rosterExport의반환basis.source_versions를고쳐도원capture를바꾸지않음. buildDraftComparisonSnapshot/captureRoster는원caller입력에서이미분리된경계이며원래report/로스터/선택/역할배열을동결하거나변경하지말것. 결과반환의defensivecopy/완전히분리된snapshotdeepfreeze 중기존호환성을보존하는가장작은명확한방법을선택해설명. typeddata의모든소비자를전면재작성하지말것. 불변가드용시뮬레이션재실행/새hash모델/새membership레지스트리추가없음. 기존v1/v2/v3파일은같은의미로재현되어야함.

추가동작회귀: returnedroster a와b의player_id/name수정→원A/BJSON불변, returnedselection champion_id수정→A/B불변, 팀교환변경반환라벨수정→source팀ID/이름불변, rosterExport.basis.source_versions변경→capture불변, 반환변경뒤다시비교하면원래diff그대로(또는freeze로수정거부됨). null슬롯/원본입력은수정가능한대로남아caller입력불변, side swap은팀ID기준로스터변경없음. 출력json/기존파일리플레이의의미보존. 테스트는TypeError를정상동결거부로인정하되 baseline불변assert를건너뛰지않음. 코드문자열검사금지. 기존실패1개고치려고검사내용을완화하지말것.

한도오류시실제reset/남은변경기록후종료, 과금/모델우회금지. max-turns는호출자내부작업상한이며서비스quota로오인하지말것. 결과짧게구현파일/설계선택/미실행만.
