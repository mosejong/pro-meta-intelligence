# 과거 시즌 선수 · 실험 입력 미연결 상태 연결 결과 (2026-11-19)

작업: Claude Opus 5.5 (medium). 새 선수 효과 모델 없음. 기존 범위(과거 선수 = 연습·보관·관측 참고 지원, 가정 실험 입력 미지원)를 화면에 명확히 연결.

## 변경 파일
- `web/app/simulation-readiness-panel.tsx`
- `web/app/draft-lab.tsx`
- 이 문서

코어 `SimulationInputSnapshot`/파일 스키마, 엔진, 저장/복원, 기존 테스트, package는 건드리지 않음.

## 내용
### SimulationReadinessPanel
- 선택 prop `hasHistoricalPlayers?: boolean` (기본값 false), `onOpenRoster?: () => void` 추가.
- `usable = readiness.ok && !hasHistoricalPlayers`. `readySnapshot`은 `usable`일 때만 값이 들어가므로, 과거 선수가 있으면 부모에게 null을 보냄 (기존의 "바뀔 때만 알림" 로직 그대로).
- 과거 선수가 있으면 차단하는 것: "준비된 입력 고정" 버튼(`fix()`에도 가드), "입력 JSON 저장" 버튼(`download()`에도 가드), 선수 근거 패널 입력(null), "입력 준비 완료" 문구, 고정/재현 파일의 "현재 입력과 같음" 판정.
- 우선 안내(role=status): 과거 시즌 선수 구성은 연습·보관·밴픽 관측 참고용이고 현재 가정 실험 입력에는 연결되지 않으며, 선수가 사라지거나 저장에 실패한 것이 아님. 버튼 '선수 구성 확인'(`onOpenRoster`가 있을 때만 표시).
- 과거 선수가 있는 동안 기존 "준비 미충족 항목" 빈칸 목록은 숨김. 역할 선택 표는 그대로 두고 허위로 완성 처리하지 않음. 비어 있는 현재 선수 칸은 "현재 선수 입력 없음 (과거 시즌 선수 여부는 선수 구성에서 확인)"으로 표시.
- 요약 상태: "과거 시즌 선수 · 실험 입력 미연결".
- 이미 고정한 입력(과거 선수를 넣기 전에 고정한 것)은 바꾸거나 삭제하지 않고 보여 주기만 하며, 그동안 JSON 저장은 막음. "고정 해제"는 계속 가능.
- 과거 선수를 빼면 `usable`이 `readiness.ok`로 돌아가 원래 검사 흐름을 그대로 따름. 별도로 유효화하는 경로 없음.

### draft-lab
- `historicalPlayers = rosterMeta?.seasonPlayers ?? false` (기존 메타 값 재사용).
- `experimentReadyInput = historicalPlayers ? null : readyInput`을 `ExperimentReplayPanel`과 `DraftComparisonPanel`에 전달. 부모 state에 이전 readyInput이 남아 있어도 이 렌더부터 null이 넘어감.
- `onOpenRoster`는 기존 `showStudioTab("ROSTER")`로 탭만 바꾸고 해당 탭 버튼에 focus. 로스터·밴픽은 수정하지 않음.
- ExperimentReplayPanel: `readyInput`이 null이면 `canRun=false`(기존 로직)라 새 실행이 막힘. 이미 고정된 A/B 실행은 자기 snapshot을 그대로 유지하고 과거 값으로 바뀌지 않음.

## 판단
- 범위를 넘은 부분: 과제에 명시된 건 ExperimentReplayPanel이지만 비교 패널에도 같은 null 입력을 넘김. 비교 패널이 readyInput의 역할로 비교를 보강하므로, 과거 선수 상태에서 이전 입력을 쓰지 않게 하려는 것.

## 검증 구분
- 실행 검증 안 함: 타입 체크, lint, 테스트, 브라우저 (명령 실행 승인이 막힌 환경이라 Codex가 진행).
- 수동 코드 검토만 함: TS 좁히기를 위해 `readySnapshot = usable && readiness.ok ? readiness.snapshot : null` 형태 사용. `panelOf("ROSTER")-tab` id는 기존 aria-labelledby 패턴과 같음. 다시 확인할 점: ExperimentComparisonPanel이 `readyInput=null`일 때 기존 run을 표시하는 방식(코드상 원래 null을 허용함).


## 지원 범위 및 2015 통합 관문 확인

과거시즌선수로입력이바뀌면명확한미지원사유/선수구성확인탭이동을표시하고부모의이전readyInput도실험에전달하지않는다. 현재선수로복원하면원래준비검사를거쳐복구된다. 실제PC 현재준비완료→2015MaRin→실행/입력고정차단→선수구성보존확인→현재선수복원→실행가능1개통과. 타입/변경lint통과.

이번저장·카탈로그·2015연결통합npm test409/409통과. 첫통합의실패는예전연간자료없음문구를고정한검사1개(부모그룹포함fail2)였고실제연간근거제공안내에맞춰검사문구를갱신한뒤재실행했다. 로그outputs/web-history-integration-fixed-20261119.log. 예측효용증명이아니다. 다음Claude CLI76094는팀ID/공개지연을지키는최소경기결과기준선을오프라인연구도구로구현중이며아직실제성능실험미실행. 웹모델에자동연결하지않는다. 제품배포없음.
