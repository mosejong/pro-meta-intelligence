# Web 단위 테스트 실행 방식 (2026-11-19)

## 변경
- `web/package.json` `test`: `npm run build && node scripts/run-unit-tests.mjs <파일 목록>`.
  - `npm run build &&` 접두와 기존 62개 테스트 파일 경로·순서는 그대로이고, 끝에 `tests/unit-test-runner.test.mjs` 1개만 추가했다(총 63개).
- 신규 `web/scripts/run-unit-tests.mjs`: `process.execPath`로 `node --test --test-concurrency=4 --test-timeout=120000 <파일...>`을 셸 없이 spawn(stdio 상속)하고, 자식 프로세스 전체에 wall-clock 기한을 건다.
- assertion, 제품 구현, 의존성, CI, 다른 스크립트는 바꾸지 않았다.

## 두 가지 제한의 구별
- `--test-timeout=120000`: **테스트 본체** 하나당 제한. 테스트 함수가 끝난 뒤 남아 있는 handle(interval, 소켓, worker 등)로 프로세스가 살아 있는 경우는 막지 **못한다**.
  - Codex 재현(`outputs/test-deadline-probe.mjs`): 동기 assertion 하나가 끝난 뒤 2.5초 live interval을 두면 `node --test --test-timeout=250`에서도 2.614초 후 exit 0으로 끝났다. 즉 `--test-timeout`은 전체 프로세스 기한이 아니다.
  - 이전 버전 문서의 "이 제한이 무기한 대기를 막는다"는 표현은 틀렸으며 이 문서로 바로잡는다.
- **전체 프로세스 기한**(신규 runner): 빌드를 제외한 `node --test` 자식 프로세스 전체에 기본 300000ms(5분). env나 플래그로 바꾸는 기능은 없다.

## runner 동작
- 기한 초과: 자기가 spawn한 PID의 프로세스 트리만 종료한다. Windows는 `taskkill /PID <child pid> /T /F`, POSIX는 자식을 detached 프로세스 그룹으로 띄우고 그 그룹에만 `SIGKILL`. 다른 Node/Chrome 프로세스는 건드리지 않는다. 종료 후 exit **124**. 자식이 kill 뒤 0으로 끝나도 성공으로 바뀌지 않는다.
- 정상 종료: 자식 exit 코드를 그대로 반환하고 기한 타이머를 취소한다.
- spawn 실패: exit 1. 파일 목록이 비었거나 `-`로 시작하는 인자가 있으면 exit 2(디렉터리 자동 발견 없음).
- 부모 `SIGINT`/`SIGTERM`: 자식 트리를 종료하고 130/143. 결과 확정 시 타이머와 signal listener를 모두 제거한다.
- kill 후 10초 안에 자식이 끝나지 않으면 기다리지 않고 실패(exit 124 또는 1)로 끝내며 "아직 실행 중일 수 있음"을 stderr에 알린다. 숨기지 않는다.
- `--test-force-exit`, 실패 무시, 재시도는 없다. 실행 command/args는 출력하지 않는다.
- import만 하면 실행되지 않는다(main guard). 검사용으로 `runCommandWithDeadline(command, args, { timeoutMs, ... })`, `resolveExitCode`, `buildNodeTestArgs`를 export한다.

## 단위 검사 (`web/tests/unit-test-runner.test.mjs`)
- exit 0/7 보존, spawn 실패의 비정상 결과, assertion 통과 후 30초 live interval을 유지하는 node:test fixture를 2초 기한으로 끊고 124 확인(15초 미만), 타이머·signal listener 유출 없음, 입력 불변, import side effect 없음, 빈 CLI 목록 실패.
- fixture는 `node -e`로 띄우며 임시 파일을 만들지 않는다. runner로 전체 suite를 재귀 실행하지 않는다.
- 부모 signal 경로는 단위 검사로 다루지 않았다(검사 프로세스 자체에 signal을 보내지 않기 위해).

## 근거 (Codex 실행 보고, Claude는 직접 실행하지 않음)
- 동시성·타임아웃 제한 없이 `npm test`: 451개 assertion 모두 통과, 그러나 `practice-roster-bundle` worker 하나가 종료되지 않아 Codex가 282초 후 해당 child worker만 중단했다.
- `practice-roster-bundle` 단독: 3개 통과, 2.4초.
- 62개 파일 `--test-concurrency=4 --test-timeout=120000`: 451/451 통과, 70초 (`outputs/web-season-comparison-bounded-20261119.log`), 로컬 Node 24.15.

## 한계
- `practice-roster-bundle` worker 종료 멈춤의 근본 원인은 **확인되지 않았다**. Vite 결함이나 동시성 결함으로 입증되지 않았다. runner는 무기한 대기를 실패(124)로 바꾸는 완화책이지 원인 해결이 아니다.
- 신규 runner와 단위 검사는 작성만 했고 **실행하지 않았다**. Node 22(CI)에서의 실행도 미확인이다(로컬 근거는 Node 24.15).


## Codex 검증 결과

신규 실행기6개 검사와 변경lint 통과. 앞서 --test-timeout=250으로는2.614초 살아 있던
동일한 fixture를 실제 node --test 자식 트리로 실행했다. 새 전체프로세스 기한1000ms에서
1,336ms 후종료, timedOut=true/killFailed=false/exit124를 확인했다. 결과는 강제 통과가 아니다.

실제 신규 npm test(빌드→실행기→63파일)457/457 통과, 단위 실행67.14초.
로그 outputs/web-season-comparison-runner-integration-20261119.log.
기존62개경로·순서와신규실행기검사1개만등록한것을확인했다. Node24.15/Windows에서의결과이며
CI Node22에서직접실행했다고말하지않는다. POSIX프로세스그룹종료/실제외부신호/정리실패상황의
실환경검증은추가범위다. 기존무제한worker멈춤의근본원인을해결했다고주장하지않는다.
