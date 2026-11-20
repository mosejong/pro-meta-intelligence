# 현재 팀으로 가정 실험 예시 입력 준비

Claude Opus5.5 medium 구현·수정 / Codex 검증. 목표핵심인 고정 밴픽·현재로스터·명시역할 입력을 쉽게 체험하게 한다. 별도 익명장난감/엔진을 만들지 말고 기존준비검사를 그대로 통과한 입력만 사용한다. 읽기최소: web/app/draft-lab.tsx의 import,positionContext/state/hasCurrentWork/canSelect,chooseChampion의자료고정부분,SIMULATION탭render; draft-agent.ts의draftSequence/applyDraftSelection; simulation-scenario.ts의buildSimulationReadiness타입/동작; roster-comparison.ts LiveRoster. 전체기획/대화/파일전부읽기불필요.

소유 신규 web/app/simulation-example.ts, simulation-example-panel.tsx, simulation-example.css, 신규web/tests/simulation-example.test.mjs, 기존draft-lab.tsx는import+검증된예시적용handler+SIMULATION탭child연결한부분만, web/package.json 새test한개등록만, docs/SIMULATION_EXAMPLE_2026-11-19.md. 다른제품/엔진/입력스키마/기존테스트/소스/API/저장/언어/의존성/배포변경금지. Bash/tests/git/network/subagents금지. 한도오류실제reset기록후중단, 모델/과금우회금지. 답변짧게.

문제: 처음가정실험체험에20번밴픽+10역할지정이필요하다. 입력미지원가드를우회해실행버튼부터열면안된다. 사용자명시버튼으로빈첫세트에만합법적인예시밴픽과알려준역할을한번배정하고, 실제현재선수구성/자료와기존readiness로검증한다. 모델은자동실행하지않는다. 공식경기재현/메타추천/선수능력으로표시하지않는다.

순수 buildSimulationExample({report,blueTeam,redTeam,firstPickSide,roster}) → {ok:true,selections,roles,snapshot}|{ok:false,message}. 실제report의두팀/LiveRoster basis·teamIds·빈/중복/미상선수등을기존buildSimulationReadiness로검증. 제공된현재로스터그대로쓰고빈슬롯을다른선수/원관측으로자동채우지말것. roster없음/기준불일치/역할미관측은거부. 부모 hasHistoricalPlayers면별도거부; 과거선수guard절대우회안함. BLUE/RED선픽모두지원. sourcecaller객체불변/비동결. snapshot은표시검증용일뿐readyInput으로부모에직접게시하지않음.

예시는작성자고정구성이고공식전략/메타추천아님. 예: BLUE TOP Gnar/JUNGLE LeeSin/MID Orianna/BOTTOM Jinx/SUPPORT Leona; RED Renekton/Vi/Ahri/Ashe/Nautilus. 밴10개는이픽과겹치지않는SHARE_CHAMPIONS의고정유효ID(Akali,Azir,Caitlyn,Draven,Ezreal,Gwen,Jax,Kalista,Lucian,Rumble등)로명시. 모든ID기존championasset/SHARE목록검증. sequence와applyDraftSelection을재사용해20턴을차례대로만들며별도게임규칙재구현안함. roles는알려준고정예시배정이며픽순서/선수기록에서추론한포지션이아님. 클릭은이배정을명시적으로채택하는행동이고수동수정가능. 정상USER_ASSIGNED역할경로사용. 읽기만하고엔진/추천기/explain/모델은호출하지않음.

UI: SIMULATION탭준비구역앞에기본접힌 details '처음이라면 예시로 체험' 하나. 열면현재양팀이름,10역할·챔피언/현재선수이름preview, '예시의 밴픽·포지션 배정을 사용하며 실제 경기나 팀 전략이 아닙니다. 선수 구성은 바꾸지 않고 실험은 직접 실행합니다.' 짧은안내. '이 예시로 입력 준비' 버튼. live roster/자료미준비면명확한이유(추정선수보충없음). 현밴픽selections>0/이전games>0/올려놓은pendingChampion/친구방/준비·복원·자료로딩/과거선수있으면적용금지. 기존작업덮어쓰기·자동reset·자동실행없음. 기존작업있을때짧은비활성사유. 44px/키보드/모바일1열/넘침없음, 새상단메뉴없음.

적용handler는현재부모값으로동기재검증하고guard통과때만한번에selections+positionState(현재positionContext,roles,unassigned빈값)를적용한다. 일반첫선택과같은seriesReport고정을반드시재사용(현재표시report를고정;단순liveReport로교체하지말것). readyInput직접설정금지; 원래readiness가새입력을검사해게시한다. 로스터/시즌선수/현재팀/선픽/이전세트/보관함/기준A/기존실행은바꾸지않고, 올려놓기/검사focus/자동선택이력/타이머같은임시UI만필요범위에서정리. 역할새객체는기존positionContext/normalizer경로에맞게복사해set. read-onlypreview와실제적용의기준다름방지. handler를새저장·가져오기우회경로로쓰지않음.

단위 실제공개feed+현재관측defaultroster로 BLUE/RED각20合法/중복없음/5픽5밴/10명·10역할ready검증, 역할예시정확맵, missing/wrongbasis/빈슬롯/중복/다른팀/잘못된선픽거부, 입력불변·snapshot분리, UI는초기접힘·불가사유/키보드buttonmarkup. guard는부모handler와UI같은순수조건함수재사용가능(원한다면helper로정의). 코드문자열검사없음. 새부모guard테스트이유로거대한AST구조검사만들지말고실제브라우저로Codex검증.

선택예시와개인/팀능력효과를혼동시키는문구금지. 2015마린을넣고실행되는척하거나roster를삭제해가드를우회하지말것. 사용자의현재선수구성이불완전하면어떤팀을확인해야하는지만안내. API권한/출처정책을확대하지않는다.
