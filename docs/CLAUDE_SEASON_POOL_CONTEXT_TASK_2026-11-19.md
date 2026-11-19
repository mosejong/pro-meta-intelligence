# 과거 선수 챔피언 기록과 지금 밴픽 상태 연결

Claude Opus5.5 medium. 다음작업은읽기전용관측정보연결. 현재SeasonLineupPanel에서선택시즌선수의top5챔프횟수만보인다. 지금 밴/픽/이전세트잠금과대조해, 남아있는관측챔프를쉽게확인하게한다. 자동추천점수/실전승률/AI선택로직/가정엔진/클릭자동픽변경금지.

소유 web/app/season-lineup-panel.tsx, roster-workshop.tsx(이미받는selections/previousPicks/focusChampionId prop전달만), 신규 web/app/season-pool-context.ts, 신규 web/tests/season-pool-context.test.mjs, docs/CLAUDE_SEASON_POOL_CONTEXT_RESULT_2026-11-19.md. 기존player-pool-evidence.ts/season-player-cards.ts읽기만. 다른파일/CSS/public/package/git/network/install/fulltest/browser/subagent금지.

기존player-pool-evidence의poolChampionState/championKey/PoolSelection 타입을그대로재사용하라. 순수helper는선택된SeasonCard, 현재selections/previousPicks/focusChampionId를받아 top5관측(횟수내림차순/챔프ID동률결정), 미사용관측최대3개, focus챔프관측행또는관측없음을분리반환. 입력불변. alias는기존key정규화. 동명alias행이여럿이면횟수합산하지말고최대행표시(누적관측을임의증폭하지않음). 이전세트밴은previousPicks에안들어오므로잠금으로추가하지말것.

UI 기존선택선수카드의top5문장에각상태라벨: 이번판밴/이번판픽/이전세트잠금/이번밴픽미사용. 추가작은줄에남은관측기록3개(모두없으면없음), focus가있으면이선수·역할·당시시즌에서X회관측또는관측기록없음을표시. 미관측=못함/0%/새로추측한실력으로표현금지. AVAILABLE을현재패치추천/확정선택가능으로표현하지말고단지이번밴픽미사용이라고표시. 챔프리워크/현메타차이를보정한추천이아님을짧게한번안내. 카탈로그가없거나ref못해석하면기존미확인안내유지. 현재선수근거패널과혼합하지말것.

관련단위:밴/픽/피어리스/남은관측보충/alias중복최대/정렬결정성/포커스없음과미관측구분/원본불변. 신규파일테스트만시도,승인거부는반복없이부모보고. 한도면실제오류/reset기록후종료과금모델우회없음. 결과문서에구현/미검증구분.
