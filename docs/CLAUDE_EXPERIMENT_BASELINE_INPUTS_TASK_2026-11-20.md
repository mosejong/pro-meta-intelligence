# 기준 A의 가정값을 입력란에 불러오기 — Claude 구현 / Codex 검증

근거: experiment-comparison-panel.tsx의동작은keep/clear뿐이고 A는숫자만표시한다. B를실험한후
A의시드·6가정값으로다시확인하려면7개를수동입력해야한다. 기준A를보존한채입력숫자만
불러오는명시버튼을추가한다. 밴픽/선수/역할/자료/실행복원기능이아니다.

소유: 신규web/app/experiment-baseline-inputs.ts, 기존web/app/experiment-comparison-panel.tsx,
기존web/app/experiment-replay-panel.tsx(이미있는applyLink 숫자setter 재사용/일반명칭변경정도),
기존web/app/experiment-comparison-panel.css(새button44px좁은style만),
신규web/tests/experiment-baseline-inputs.test.mjs, web/package.json(test목록추가만),
신규docs/EXPERIMENT_BASELINE_INPUTS_2026-11-20.md. 다른모델/비교gate/저장/URL/roster/seedparser변경금지.

최소읽기위패널들, experiment-comparison.ts의trustedRun, simulation-scenario.ts의sameSimulationInput,
experiment-input-link.ts의plainDecimal, replay.ts validateRunInputs. 기존fixture로trustedrun생성.
이전A/B차트와링크는이미완료됐고재구현금지.

순수plan helper:
unknownbaseline/현재readyInput/blocked를받는다. trustedRun으로만든A만가능, 임의copy/JSON/객체거부.
blocked·ready없음·sameSimulationInput(A.snapshot,currentreadyInput) false면숫자계획없음/이유만.
이exact비교는evidenceIdentity+canonical key라자료/진영/선픽/게임/밴픽/로스터/역할까지같아야한다.
외부가정값링크의patch/pair관문보다엄격한것이의도다. 다른밴픽을A로조용히덮어쓰지말것.
현재필드seed가달라도불러오기는가능(이작업이시드도A로돌리는것). A.seed와A두source팀의3가정을
손실없는plainDecimal/기존validateRunInputs로그대로옮기고복사된seedText/drafts만리턴한다.
MIN_VALUE/-0 등기존입력링크의숫자변환을재사용, 반올림/clamp/Number.toString지수표기거부이슈재발금지.
추가playerID/전체snapshot반환없음. 원본/A/currentcontext/반환수정격리. simulate/build/batch없음.

UI:
A가있으면 '기준 A의 가정값 불러오기' 명시버튼. callback미연결/blocked/현재readiness없음/
고정맥락불일치면disabled+짧은이유. 현재A와같은run이보여도불러오기허용(숫자편집후원상태회복가능).
부모에서현재blocked를넘기며방/restore/loading/과거선수미지원가드를우회하지않음.
legacy외부호출은새prop미제공시기본안전비활성(예optionalcallback과blocked기본true), 현재부모는실제로연결.
클릭시현재props기준다시plan검사, callback은현재두팀draft와seedText만변경. 다른팀draft엔트리보존.
현재run/재생위치/자동재생/기준A/밴픽/roster/roles/저장/URL은불변. 자동실행금지.
기존status영역에 'A의시드와두팀가정값만불러왔습니다. 결과를보려면직접실행하세요' 정도안내.
같은값을다시눌러도안전, A를새B로교체하거나지우지않음. 새폼/모달/중복초기화함수없음.
새버튼44px은기존 .experiment-replay button 규칙보다충분히구체적인선택자로맞춘다.

tests:
실제buildExperimentRun/freezeBaseline로중립/변경값/미세finite값의숫자손실없는plan과validation,
원본불변/반환격리, sourceID대응(표시명이나side아님), 불신/blocked/nullready/자료·draft·role·roster·
sourcepair·진영/first선택등불일치거부. 같은값·다른현재seed도정상계획. helper는현재UI필드값을안받아
현재필드에의존하지않음. 새prop미연결시SSR안전, 기존SSR초기버튼행동보존.
Codex가PC/모바일에서A1→B2→A숫자만로드(현재B2결과·A1·cursor불변)→명시run3로NONE0,
blocked/맥락변경거부·주소/저장/로스터불변을독립E2E한다.

Claude구현/수정, Codex검증만. Read/Edit/Write/Glob/Grep만. Bash/명령/tests/git/network/subagent없음.
실제한도면원문/reset기록후중단·모델/계정/유료우회금지. 간결한완료/미실행/리스크보고.
