# 양쪽 시즌 선수의 관측 챔피언 비교

Opus5.5 medium. 작은 이용자 기능 한 조각이다. 기존 과거 선수 선택/저장/관측 상태를 재사용한다. 읽기 최소 web/app/season-lineup-panel.tsx, season-player-cards.ts, season-pool-context.ts, player-pool-evidence.ts의 championKey/poolChampionState, 관련 season-pool-context.test.mjs 및 season-team-preset.test.mjs. 다른기획/연구/대화전체읽지말것.

소유 신규 web/app/season-player-comparison.ts, season-player-comparison-panel.tsx, season-player-comparison.css, 신규web/tests/season-player-comparison.test.mjs, 기존season-lineup-panel.tsx는새child import+render만, web/package.json 신규test등록만, 신규docs/SEASON_PLAYER_COMPARISON_2026-11-19.md. loader/async/ref/선수배정/저장/시뮬레이션/추천 변경금지. Bash/git/tests/network/subagents금지. Codex검사. 한도오류실제reset기록후중단, 유료/모델우회금지. 응답짧게.

목적: 2015마린 vs2022너구리처럼 같은 역할의 양쪽 시즌 선수를 배정했을 때, 실제 사용한 공통/서로다른 챔피언 기록을 한곳에서 비교한다. 승패/능력치/우열/현메타추천/시대보정은 만들지 않는다. 현재선수만배정되면이패널불필요. 적어도한시즌ref존재할때기본접힌 details '시즌 선수 관측 비교'를 기존시즌선수선택영역아래에표시. 같은역할 양쪽ref있을때만그role표시. 한쪽뿐이면양쪽을배정하면관측비교가능하다는짧은안내. 다른팀/역할로대체하지않기.

순수 helper compareSeasonCards(blue:SeasonCard,red:SeasonCard,selections,previousPicks) returns {ok:true,...}|{ok:false,reason}. 같은role필수/같은player_id는시즌달라도거부(부모와동일규칙). 원본카드는파서검증된것으로받되게임수/챔피언관측 count 유효성확인(양의정수/카드game_count이하). championKey정규화 alias들은각카드에서max게임count만채택, 합산금지. 두카드별top3(게임countdesc/IDasc), 공통챔피언전체수+최대5개 IDasc(공통count값을합쳐강함으로랭크하지않음), 한쪽에서만관측된챔피언최대3개씩countdesc/IDasc. 공통행은blue_games와red_games분리. 없는상대기록은0아니라미관측, 단독행에상대0표시금지. poolChampionState 재사용해현재밴/픽/이전세트잠금/미사용표시. 양쪽sample/season/patch목록과출처source_id보존, 카탈로그기준시각UI표시. 같은챔피언ID여도리워크/시대차이있고관측기간/표본상이하다는1줄. 입력불변.

childprops catalog,lineups,teams,selections,previousPicks,nameOf. 팀side BLUE/RED별정확하나없으면배정하라고안내또는숨김; 추정팀매핑금지. 각ROSTER_ROLES에서양ref를resolveSeasonRef(role,catalog)로검증, 실패하면그role미확인표시·다른선수로대체안함. 한role오류가다른role의정상비교를지우지않음. 팀이름은부모관측명 그대로Reacttext. 챔피언명nameOf, CSS기존톤·모바일1열/가로넘침없음·새상단메뉴없음. 상세패널은접힘기본. selector가바뀌면그시점props비교만하며새fetch나새모델호출없음.

단위: 공통/단독/정렬·제한/alias중복max/잠금/밴픽상태/같은역할아님/같은선수다른시즌거부/입력불변/미관측0없음. 실제catalog의2015MaRin과2022Nuguri찾아순수helper·SSR연결검사(둘다TOP이며서로다른stableID). null/한쪽ref/역할불일치/카탈로그불일치UI숨김or안내검사. 코드문자열검사없음. 기존2015~2026전체기간완전수집/능력효과확인claim없음.
