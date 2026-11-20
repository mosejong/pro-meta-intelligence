# A/B 같은 시각의 모델 자원 차이 (2026-11-20, Claude 구현 / Codex 검증 대기)

과제: docs/CLAUDE_EXPERIMENT_COMPARISON_HISTORY_TASK_2026-11-20.md

## 무엇
완료된 A/B 비교 결과 안에 기본 접힘 `details.experiment-comparison-history` ("같은 시각의 모델 자원 차이").
같은 팀의 B 모델 자원 − A 모델 자원을 0..min(A 종료, B 종료)분 동안 분별로 그린다. 두 팀 사이 격차·승률·선수 기여 아님.

## 파일
- `web/app/experiment-comparison-history.ts` (신규, 순수)
  - `experimentComparisonHistory(baseline, candidate, shownMinuteB)` → `REFUSED{refusals}` | `PENDING` | `READY{changeKind, teams[2], commonEndMinute, endMinutes{a,b}, points[{minute, delta[2], a[2], b[2]}], minDelta, maxDelta}`.
  - 게이트는 기존 `compareExperimentRuns` 그대로(UNTRUSTED/RULESET/SEED/EVIDENCE/TEAMS/DRAFT/ROSTER/ROLES/INPUT), `outcome === null`이면 PENDING. 추가 거부: `SAME_RUN`(동일 객체 또는 같은 runId — frozen 복사 포함), `INVALID`(기록 판독 실패).
  - 값은 기존 `resourceHistory(run, common)`(= replayFrame)에서만 읽음. 두 실행 모두 `common`에서 잘라 보간/고정연장 없음. 팀은 sourceTeamOrder + sourceId→core로 짝지음. 라벨은 B의 `resourceHistory` 라벨(동명이면 "실행 당시 블루/레드"), 반환·UI에 raw ID 없음.
  - `comparisonDeltaSeries(ready)`: 차트 시리즈 형태로 변환(slot i = source 순서 i번째 팀, 선 스타일용).
- `web/app/experiment-resource-history.ts`: `resourceChartGeometry`에 4번째 인자 `{ includeZero }`(opt-in)와 `ResourceChartSeries` 타입. 지정 시에만 y범위에 0 포함 + `zeroY` + 0 tick. 미지정 경로/`resourceHistory` 불변.
- `web/app/experiment-resource-history-panel.tsx`: legend+SVG+분별표를 `ResourceChartView`로 추출(준비된 series/geo/labels/title/desc/caption/format만 받음). 기존 패널 markup·클래스·문구 동일. `geo.zeroY`가 있을 때만 `<line class="zero">`.
- `web/app/experiment-comparison-history-panel.tsx` (신규): PENDING이면 아무것도 렌더하지 않음, REFUSED면 사유 문장만(SVG/표 없음), READY면 접힘 details + 안내문 + 종료분 동일/상이 안내 + NONE/MULTIPLE 문구 + `ResourceChartView`(부호 formatter).
- `web/app/experiment-comparison-panel.tsx`: `comparison.outcome`이 있을 때만 위 패널 렌더, `key=A runId-B runId`로 쌍 교체 시 상태 초기화.
- `web/app/experiment-replay-panel.css`: 새 root 전용 규칙(44px summary, axis/tick/line/dot/zero, 표 정렬). 기존 규칙 수정 없음. 단일 차트 root 클래스(`experiment-resource-history`)는 재사용하지 않아 기존 E2E locator 유일성 유지; 내부 legend/chart/values 클래스는 공유.
- `web/tests/experiment-comparison-history.test.mjs` (신규), `web/package.json` test 목록에 추가.

## 미실행
명령/테스트/typecheck/lint/브라우저 미실행(과제 규칙). Codex가 단위·E2E 검증.

## 리스크
- 공통 끝분 상이 fixture는 실제 run 96개 탐색으로 찾으며 없으면 assert 실패(seed/가정 조합으로 보통 존재 예상).
- `.experiment-comparison :is(th,td)`가 같은 specificity로 표에 적용될 수 있어 새 root 아래 더 구체적인 규칙으로 우측정렬/nowrap 지정. 모바일 가로 넘침은 `.experiment-resource-history-scroll`(overflow-x:auto) 안에 갇힘 — E2E로 확인 필요.
- 단일 패널 `desc`/`caption`을 문자열 prop으로 바꿔 SSR 문자열은 동일하나 클라이언트 텍스트 노드 분할만 달라짐(innerHTML 동일).

## Codex 최종 독립 검증 — 2026-11-20

Claude session234ed5b7-e549-488c-b106-ede774fecd9b completed/is_error=false.
Codex는제품/연구소스를수정하지않고 tests/e2e/experiment-comparison-history-review.spec.mjs를작성했다.

- 신규A/B·기존단일그래프·비교 관련33개통과, TypeScript/변경lint/Pages계약5개통과.
- 실제Chrome desktop3/mobile-width3 총6개통과. 신규A/B4개+기존단일그래프재검증2개다.
- 실제A42분/B33분의서로다른종료fixture에서0~33분의각셀을원래A/B단일기록으로독립검산했다.
  먼저끝난뒤외삽/상태고정연장없음. 중간B엔차트없고종료때만추가된다.
- 입력란seed편집이기존차이를바꾸지않음, B되감기시전체차트제거/재종료시동일값,
  다른seed새run거부, 기준A해제·교체시이전차트제거, NONE이면모든분차이0/좌표유효 확인.
- 전체 npm test **517/517 통과**, outputs/web-ab-resource-history-integration-20261120.log(90.49초).
- 모바일캡처 outputs/ab-resource-difference-mobile-20261120.png를확인했고페이지가로넘침없음·44px확인.
  실제휴대폰·스크린리더·전체색대비평가는아니다.

미세시간시리즈는같은팀의모델자원B-A이지두팀간격차나실전효과가아니다. MULTIPLE변경을단일요인의
기여로해석하지않으며 기존동일밴픽/로스터/역할/자료/seed/신뢰기록/종료관문을유지했다.
새모델실행·학습·원본수집·source/API·저장schema·URL·제품push/merge/deploy 없음.
