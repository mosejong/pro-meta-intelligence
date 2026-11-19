# 웹 단위 검사 전체 프로세스 기한

Claude 제품/도구 구현 및 수정, Codex 검증. 실제 재현: outputs/test-deadline-probe.mjs는 node:test의 동기 assertion 한개가 끝난 후2.5초간 live interval을 둔다. node --test --test-timeout=250에서도 2.614초 후 정상exit0이었다. 즉 --test-timeout이 종료후남은handle에대한 전체프로세스 기한은아니다. 기존 docs/WEB_TEST_EXECUTION_2026-11-19.md의 무기한방지표현을 그대로확정하지말고 바로잡는다. 원인불명인 기존 practice-roster-bundle worker종료멈춤을 숨기지않는다. bounded4/120s 전체451pass70s/단독3pass2.4s는사실이다.

소유: 신규 web/scripts/run-unit-tests.mjs, 신규 web/tests/unit-test-runner.test.mjs, web/package.json test script(빌드prefix/기존62개목록순서보존+새runner검사1개추가만), docs/WEB_TEST_EXECUTION_2026-11-19.md. 기타제품/기존단언/CI/의존성/코어수정금지. 최소 package와현재문서만읽고Bash/git/network/tests/subagents금지. Codex가검사한다. Opus5.5 medium/한도오류시reset기록후중단우회금지.

기능: npm test는 npm run build && node scripts/run-unit-tests.mjs <동일파일목록> 으로호출. wrapper는process.execPath로node --test --test-concurrency=4 --test-timeout=120000 ...파일을spawn, stdio상속, 정상exit코드보존. wrapper전체단위자식프로세스실행기한기본300000ms(빌드제외5분). 기한넘으면자기spawn한PID의프로세스트리만종료하고124같은명시비정상exit. 테스트강제정상종료/--test-force-exit/실패무시/무한재시도금지. Windows는고유childPID만taskkill /PID <pid> /T /F, POSIX는spawn시detachedprocessgroup후해당그룹종료등안전한자기트리정리. 다른Node/Chrome사용자프로세스전역kill금지. timeout발생후자식exit0이어도성공으로바뀌면안됨. spawnerror/nonzero/부모SIGINT·SIGTERM시코드및timer/listener/자식정리정확히. 자식종료시타이머취소. 종료방식은현OS지원내에서현실적으로구현하고실패를숨기지않는다.

import시자동spawn안하는main guard; 검증용 exported runCommandWithDeadline(command,args,{timeoutMs,...}) 같은작은함수로단위fixture실행가능. 실제CLI에서기본5분과flags를임의env로우회하는기능추가금지. 외부shell문자열합치지않고spawn배열, 실행command/args비밀출력금지. 파일목록은nodeargv그대로전달하되빈목록이면실패(전체디렉터리자동발견아님).

단위는normal0/failure7같은exit보존, spawnfail, assertion끝난뒤interval유지하는작은node fixture에짧은기한으로TIMEOUT/비정상exit확인, timer유출없음/입력불변, importsideeffect없음. 임시파일이면test자기디렉터리만finally정리. timeout은2초정도로플랫폼시작여유두고5초이상live fixture를끊으며전체검사분단위대기를단위에서하지않는다. 테스트에서이runner자체를다시전체suite실행하는재귀금지. 자기fixture를spawn하는검사만.

문서엔테스트본체타임아웃vs전체프로세스deadline구별, CLI기본5분/4동시/120초본체, rootcauseunknown, Node22실행미확인(local24.15)표시. 구현완료/미실행만간결보고. 새소스/배포없음.
