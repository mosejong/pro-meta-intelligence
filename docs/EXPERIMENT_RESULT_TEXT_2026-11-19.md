# 완료한 가정 실험 요약 글 복사 (2026-11-19)

구현: Claude (Opus 5.5). 검증: Codex.

## 범위
- `web/app/experiment-result-text.ts`: 순수 `buildExperimentResultText(run, shownMinute)` → `{ok:true,text}` | `{ok:false,reason}`.
  - 이미 계산된 `run.result`(winner/reason/minute/states/input)와 `run.teams`·`run.input`·`run.snapshot`만 읽습니다. 모델 실행·재생 프레임·비교 생성은 호출하지 않습니다.
  - `shownMinute`가 유한하고 `endMinute` 이상일 때만 글을 만들고, 그 전이면 `NOT_COMPLETE`를 돌려줍니다.
  - 전체를 거부하는 경우: 실행 번호·시드·종료 분 형식 오류, `result.minute`≠`endMinute`, 규칙 불일치, `result.input`이 없거나 실행 input과 다름(규칙/시드/core ID/가정값), 두 팀의 source ID 중복이나 같은 진영, 스냅숏의 이름·ID와 다름, 출력할 가정값≠모델 input, 알 수 없는 승자나 종료 이유, 상태 값이 0 이상 정수가 아님(기지 0..100), 종료 이유와 상태가 맞지 않음(기지 파괴인데 진 팀 기지가 0이 아님, 시간 제한인데 45분이 아니거나 점수 규칙상 승자가 다름), 시간대가 없는 자료 기준 시각.
  - 이름·패치·기준 시각은 제어문자(`\p{Cc}`)와 bidi 문자를 지우고 공백을 합친 뒤 40자로 자릅니다. 비면 거부합니다. 최종 글은 최대 2000자입니다.
  - 마지막 줄은 고정 문장: 「사용자 가정과 작성 규칙에 따른 모델 내부 결과이며 실제 LoL 승패·승률 예측이 아닙니다. 실제 선수·챔피언·룬·아이템 효과는 반영하지 않았습니다.」
  - 원시 source/player ID, 챔피언, 스냅숏, JSON, 사건 목록 전체는 출력하지 않습니다.
- `web/app/experiment-result-share-panel.tsx`: '가정 실험 요약 복사' 버튼. 종료 전이면 비활성화하고 안내를 보여줍니다. 복사 상태는 run 참조와 완료 여부에 묶여 있어, 새 실행·뒤로 이동·unmount 때 지워지고 늦게 끝난 clipboard 결과는 무시합니다(이미 쓴 내용을 되돌리지는 않음). 미지원이거나 거부되면 읽기 전용 textarea(한국어 aria-label)를 보여줍니다.
- 결과 영역 안 child로 연결(`experiment-replay-panel.tsx`), 공유 영역 CSS(44px 버튼, 넘침 방지), `package.json` 단위 테스트 목록에 등록했습니다.

## 검증 상태
- `web/tests/experiment-result-text.test.mjs`는 **Claude가 실행하지 않았습니다** (이번 작업은 Bash/tests 금지). Codex 보고: 이전 실패(`result.input` 누락/null 통과, `undefined` 분이 기본 인자로 끝 분이 되던 문제)와 lint 오류(no-control-regex, no-useless-escape)는 수정했습니다. 수정 후 재실행 결과는 Codex 확인이 필요합니다.
- 실제 clipboard, 새 실행, seek, PC/모바일 화면은 Codex가 검증합니다.


## Codex 검증

초기 호출은 서비스 사용량 오류가 아닌 로컬 --max-turns16 상한으로 종료됐다.
같은 Claude 세션에서 발견 결함만 수정했다: result.input 누락/null/규칙불일치 거부,
undefined 시각 테스트의 default 인자 착시, lint3건, side literal widening 타입오류.
제품 수정은 모두 Claude가 맡았고 Codex는 추가 회귀와 검사를 수행했다.

관련 요약·재생·A/B28개, 변경lint, 타입검사, Pages빌드 통과.
실제 Chrome PC/모바일4개 통과: 종료전 복사차단→종료후 고정값복사→입력란시드변경에도
기존고정값유지→되감기/새실행에서옛글제거, 늦은clipboard완료 무시 및 정상완료표시.
복사전후 모델 상태/실행번호가보존되고,44px버튼/가로넘침없음을확인했다.
캡처 outputs/experiment-result-readable-copy-mobile-20261119.png.
최신 전체457 통과는 이 변경 직전 fb5296d4 시점이며 이번 관련28개와 구분한다.

별도 A/B 핵심 경계 검토에서 발견된 반환객체 alias 문제는 이 공유기능 결함으로 섞지 않고
GOAL_CORE_REVIEW_2026-11-19.md와 신규 회귀로 추적해 Claude 수정대상으로 넘긴다.
제품 push/머지/배포 없음.
