# 가정 실험 재생: 사건 단위 빠른 이동

Opus5.5 medium. 다음 작은 이용자 기능이다. 읽기 최소: web/app/experiment-replay-panel.tsx, experiment-replay.ts의 ExperimentRun/replayFrame/playbackReducer, simulation-core.ts의 ManagerEvent타입, experiment-replay-panel.css, tests/experiment-replay.test.mjs의fixture. 전체기획/연구문서불필요.

소유 신규 web/app/experiment-event-navigation.ts, 신규 web/tests/experiment-event-navigation.test.mjs, 기존 web/app/experiment-replay-panel.tsx 및 css, web/package.json의신규test등록한부분, 신규docs/EXPERIMENT_EVENT_NAVIGATION_2026-11-19.md. 엔진/simulation-core/replay계산/reducer/API/원본/모델/저장스키마 변경금지. Bash/tests/git/network/subagents금지(Codex검사). 한도오류실제reset기록후중단·유료/모델우회금지. 결과짧게.

목적: 1분씩 여러번 누르지 않고 기존 고정 가정 실행의 모델 사건을 앞뒤로 살피기. run이 없으면버튼없음. 기존 재생/시드/가정값/seek/비교기능보존. 이미계산한run.result.log(실제필드확인)을읽기만하고buildExperimentRun/replayFrame/엔진을추가호출하지않는다. 실제LoL하이라이트/선수효과/예측을새로만들지않는다.

순수 helper eventNavigation(run: Pick<ExperimentRun,'result'|'endMinute'>, minute) → {previousMinute:number|null,nextMinute:number|null,endMinute:number|null,eventMinutes:number[]}. 이벤트는기존표시사건 SKIRMISH/OBJECTIVE/BASE만, GROWTH제외. 같은분여러사건은유일분1개, 정수0..endMinute유효분만, 정렬; 입력불변. prev는현재보다엄격작은분, next는엄격큰분. cursor는replayFrame과같이유한값floor+0..endclamp, 비유한0. endMinute잘못된형식/범위이면전부null/empty로refuse, 0은유효. 사건없어도endMinute는유효하며결과버튼으로이동가능. 전후사건없으면해당버튼disable.

UI는기존재생조작아래 details 기본접힘 '사건 단위로 이동' 안에 '이전 사건','다음 사건','결과까지 이동' 3버튼. 다음사건은다음기록시각으로, 결과까지는run.endMinute로 기존dispatch만. 클릭시PAUSE다음SEEK로멈춘상태표시(기존SEEK는재생지속이므로기존reducer를수정하지않고두action순서사용). 마지막시간에서결과버튼disable. '고정 실행의 표시 위치만 이동하며 다시 계산하지 않습니다' 짧은설명. 숫자없는실제승패/실력새claim금지. 실행뒤current입력이바뀌어도기존고정run으로이동해야한다. 44px터치/모바일줄바꿈/가로overflow없게기존css디자인재사용.

단위fixture이벤트분정렬/중복/GROWTH제외/앞뒤엄격경계/빈이벤트/끝/잘못된분/입력불변 및 실제고정run연결검증. navigation은run.result와snapshot해시/결과/seed변경없이표시만이동함을검사. SSR버튼은run존재전없음(현컴포넌트실행상태초기이므로helper만실제run테스트). 코드문자열검사는하지않는다. React후크/실제UI는Codex브라우저검증대상. API타입은문서필드잘못예시를따르지말고실제ManagerResult확인. 범위밖기능추가없음.
