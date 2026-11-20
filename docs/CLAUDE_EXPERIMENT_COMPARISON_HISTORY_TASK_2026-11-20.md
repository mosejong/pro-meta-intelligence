# A/B 공통 시각의 자원 차이 흐름 — Claude 구현 / Codex 검증

근거: 기존 experiment-comparison-panel.tsx는종료4지표차이만비교하므로 어느시점부터달라졌는지보려면
두실행을수동으로따라가야한다. 방금완료된past-onlyresourceHistory/geometry/SVG를재사용해
**같은팀의 B실행 모델자원 − A실행 모델자원**을분별로보는기본접힘그래프/표를추가한다.
두팀사이격차나실전승률/선수기여를그리는것아니다.

소유: 신규 web/app/experiment-comparison-history.ts, 신규web/app/experiment-comparison-history-panel.tsx,
기존experiment-resource-history-panel.tsx(필요하면작은공통내부view를이파일에서export, 기존API/markup유지),
기존experiment-resource-history.ts(geometry에zeroY등꼭필요한순수확장만, resourceHistory행동불변),
기존experiment-comparison-panel.tsx(작은wiring), 기존experiment-replay-panel.css(최소공통style만),
신규web/tests/experiment-comparison-history.test.mjs, web/package.json(test파일추가만),
신규docs/EXPERIMENT_COMPARISON_HISTORY_2026-11-20.md. 다른제품/engine/gates/세션저장/링크/데이터변경금지.

최소읽기 experiment-comparison.ts의trustedRun/compareExperimentRuns·outcome gate,
resource-history두파일/기존단위fixture 및comparison.test.mjs. API와UI모두기존비교조건복제하지않고재사용.

순수helper:
- unknown A/B, shownMinuteB를받아기존trustedRun+compareExperimentRuns 검사. A/B같은run거부.
  B종료전·입력/시드/규칙/팀/로스터/역할/근거불일치·불신run이면차이시계열없음(사유/대기만).
  기존비교gate완화없음. 원본frozenrun읽기, 모델/build/batch재실행없음.
- 두실행공통진행구간 **0..min(A.endMinute,B.endMinute)** 만비교. 먼저끝난실행을상태고정해늘리거나
  보간/외삽하지않는다. 양쪽이미종료확인된후이므로공통끝분공개가능. 끝분이다르면그사실을표시한다.
- 각분의원시modelgold는기존resourceHistory/replayFrame에서읽고 sourceID로대응한동일팀의 B-A를계산.
  컬러/화면진영/표시명으로대응하지않는다. sourceID는내부결합만, UIrawID없음.
- 반환에는시간축·원래source순서·팀표시명·B-A만, 실제확률/승자효과/원시player관측없음.
  각point검산가능하도록a/brawmodelgold를내부구조에보존가능하나화면은차이임을명확히.
  호출자반환수정/현재input편집이원본/A/B에영향없음. NONE이면모든분의차이가0.

view/UI:
- 기존완료A/B비교안의기본접힘details '같은 시각의 모델 자원 차이'. B되감기전부숨김(미래point/축도없음).
- '같은 팀의 B−A이며 두 팀 사이 격차가 아닙니다. 두 실행이 모두 진행된 구간만 비교합니다.
  실제 골드·승률·선수 기여도가 아닙니다.' 짧게안내. MULTIPLE을한요인기여로귀속하지않음.
- 기존SVG/legend/분별table기능을작은표시view로재사용해복붙하지않는다. view는이미준비한데이터·
  제목/설명/단위formatter만받도록좁게추출가능. 새genericframework/외부lib금지.
- y축signed B-A, 0기준선. 0만있거나양쪽차이동일/음수여도좌표유효. 범례실선/점선+이름,
  접근성title/desc, optional분별표 현재경로재사용. 같은이름팀은팀1/팀2/실행진영등구별, rawID안내없음.
- 기존단일자원차트의외부API/선택자/캡션/기본접힘/미래차단불변. 추가A/Bwrapper가같은CSSroot를
  재사용하더라도단일차트와A/B차트를구별할class/label을제공. 기존PC/mobile검사범위를깨지말것.
- 입력/현재보고서/팀선택변경은완료run끼리의차이를바꾸지않음. 새로운B/기준A교체·해제·되감기때
  현재기준으로재검사하며이전차트가섞이지않게한다. 타이머/자동실행/저장/URL변경없음.
- 범례/summaryCSS specificity 이미고친패턴유지, 44px·모바일page가로넘침없음.

tests:
실제buildExperimentRun/freezeBaseline fixture로각분delta를원래A/B replayFrame으로직접검산,
SINGLE/MULTIPLE/NONE, 서로다른종료분일때공통끝까지만/외삽없음, 음수/양수/전부0좌표안전,
중간B/NaN/미신뢰복사/같은run/시드·근거·역할불일치거부, sourceID·동명팀구별,
입력/출력격리·A/B불변, SSR기본접힘/접근성/거부시SVG·값없음.
기존resource-history단위와관련비교단위는Codex가함께돌린다. Codex는별도브라우저E2E를쓴다.
Read/Edit/Write/Glob/Grep만. 명령/tests/git/network/subagent금지. Claude가구현/수정, Codex검증만.
실제한도면원문/reset남기고중단·모델/계정/유료우회없음. 완료보고짧게파일/미실행/리스크.
