# 완료한 가정 실험 요약 글 복사

역할: Claude가 제품 구현·수정, Codex가 검증·수정요청·통합. Opus5.5 medium. 읽기 최소 web/app/experiment-replay-panel.tsx, experiment-replay.ts의ExperimentRun/CORE_TEAM_IDS, simulation-core.ts의ManagerResult/isManagerInput, simulation-scenario.ts의SimulationInputSnapshot타입, solo-draft-history-panel.tsx의클립보드token패턴, tests/experiment-replay.test.mjs의실제runfixture. 다른기획/전체대화불필요.

소유 신규 web/app/experiment-result-text.ts, experiment-result-share-panel.tsx, 신규 web/tests/experiment-result-text.test.mjs, 기존experiment-replay-panel.tsx는child import+render만, 기존experiment-replay-panel.css 새share영역스타일만, web/package.json 신규test파일등록만(실행기명령·기존파일목록보존), 신규docs/EXPERIMENT_RESULT_TEXT_2026-11-19.md. 엔진/reducer/기존replay계산/새source/API/저장/공유링크/방/배포변경금지. Bash/tests/git/network/subagents금지, Codex검사. 한도오류실제reset기록후중단, 모델/유료우회금지. 결과짧게.

목적: 결과까지확인한단일고정가정실험을한국어일반글로친구에게보낸다. JSON아님. run이있으면결과영역의 child에버튼 '가정 실험 요약 복사' 표시, 현재표시시점이종료전이면disabled+결과까지확인후복사가능한짧은안내. 뒤로seek하면복사상태·textarea숨김. run없으면없음. 현재입력seed/가정값이바뀌어도복사는실행당시고정run만. 새run/뒤로seek/unmount/name환경변경등비동기늦은copy상태무효화. 이미시작한clipboard쓰기를취소할수있다고주장/자동삭제안함. 미지원/거부시readonly선택가능textarea,44px버튼/모바일넘침없음. 기존결과/비교/사건이동기능보존.

순수 buildExperimentResultText(run,shownMinute)→{ok:true,text}|{ok:false,reason}. nameOf/챔피언/선수기록은이번복사에필요없음(모델미사용). 실행번호/패치/자료기준시각/고정시드/규칙/고정양팀이름·당시진영·라인운영한타가정/종료모델시각·이유/모델내부승자/각팀모델자원·모델킬·추상오브젝트·기지내구도만짧게. 마지막 '사용자 가정과 작성 규칙에 따른 모델 내부 결과이며 실제 LoL 승패·승률 예측이 아닙니다. 실제 선수·챔피언·룬·아이템 효과는 반영하지 않았습니다.' 고정문장. 현재화면입력란과다를수있는실행당시기록임을표시. rawsourceID/playerID/원시snapshot/JSON/경기사건전체미출력.

이미계산한run.result.states/winner/reason/minute및run.teams/run.snapshot만읽는다. buildExperimentRun/simulateManager/replayFrame/비교생성기 호출없음. 결과는현재표시분이endMinute이상일때만포함(비유한/종료전전체거부). 기본형식검사: 실행번호/seed/종료분·result.minute일치·규칙일치/두coreteam·유일sourceID/실행input의가정과출력에쓸고정가정일치/알수없는winner/reason/유효하지않은상태수치거부. isManagerInput은검증함수만재사용해도됨. 상태는finite/nonnegative·base0..100, count성격정수검사. 의미불일치부분복사아님전체refuse. 날짜timezone ISO파싱확인. 이름·고정텍스트값은control/newline/bidi제거40자한도/빈값거부,최종글상한. 임의전체스키마재검증프로젝트로키우지말고가정실험내부typedrun전용에맞게. 입력불변.

childprops run,shownMinute. complete여부에따른tokencleanup및render일치guard. 단순현재분동일보다run참조+complete기준으로copy상태구분해도됨. readonlyfallback한국어aria-label. 기존스타일에맞추고newnav/기존복사기능refactor금지.

단위실제고정run fixture로일반글필수값/분리팀/시드·가정일치/결과전거부/끝에서복사/뒤로가면거부/무효숫자·승자·이유거부/이름주입과빈이름/결정성·입력불변/새모델실행이필요하지않은데이터읽기검사. 코드문자열assert금지. SSR은종료전disabled/완료후enabled/textarea초기없음 확인. 실제clipboard·newrun·seek·PC/모바일은Codex검증. 모든검사미실행이면정직하게표시.
