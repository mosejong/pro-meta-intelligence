# 밴픽 판단 도구의 효용 평가 (protocol v2)

현재 상태: **사람 평가 대기. 효용 입증 전.**

기존 픽 후보 적중률과 다른 평가다. 도구를 썼을 때 근거 있는 판단을 더 빨리
내리는지 확인한다. 승리 확률, 정답 밴픽, 감독 의도는 평가하지 않는다.
에이전트 리허설(`docs/DRAFT_AGENT_REHEARSAL_2026-11-11.md`)은 추가 효용을 입증하지
못했고, 사람 평가의 대체 증거가 아니다.

## v1에서 바뀐 점 (11/11 감사 반영)

- **조건은 팀(팩) 단위로 배정한다.** 같은 팀의 5개 포지션 사례는 같은 evidence와
  aids를 공유한다. v1은 한 분석가가 같은 팀을 사용·미사용 양쪽에서 볼 수 있었다.
  v2는 (팀, 분석가)마다 조건이 하나다. 각 팀은 사용 2명·미사용 2명이다.
  집계 단위도 사례가 아니라 팀이다. 사례 ID만 다르다고 독립 사례로 세지 않는다.
- **근거 인용은 공통 evidence 안의 JSON pointer만 허용한다** (예: `/target/player_pools/0`).
  존재하지 않거나 너무 넓은 경로(`/target`)는 거부한다. aids에만 있는 이름
  (`levers`, `deny_comfort` 등)이 답변이나 인용에 들어가도 거부한다.
  채점 자료에는 경로와 실제 값만 들어간다. 인용 경로로 조건이 드러나지 않게 하기 위해서다.
- **응답과 채점을 해시로 고정한다.** blind 단계에서 응답 전체(시간 포함)의
  해시를 기록한다. evaluate는 응답이 그 해시와 다르거나, blind 자료가 다른
  study의 것이면 거부한다. 보고서에는 study·응답·채점 해시가 모두 남는다.
- 채점자 2명의 ID는 study에 미리 고정한다. 등록되지 않은 채점자는 거부한다.
- 중대한 오류는 두 조건 모두 센다. 통과 판정은 그대로 도구 사용 조건 0건이다.
  채점자 간 점수 차이와 오류 판정 불일치도 보고한다.
- prepare가 git HEAD, 미커밋 변경 여부, 평가 코드 해시, 팩 파일 해시를 자동 기록한다.
- v1 study(`outputs/utility-20261111/study.json`)는 보관만 한다. v2 코드는 이를 거부한다.
  새 평가는 새 경로로 만든다.

## 사전 고정

`ops/draft_utility_study.py prepare`는 7팀 × 5포지션의 35사례와 분석가 4명의
140개 배정을 만든다. 순서는 고정 난수로 섞는다. 출력 파일이 이미 있으면 중단한다.
자료, 원본 파일 해시, 기준, 배정, 채점자, 빌드 기록 전체를 해시로 묶는다.
바꾸면 새 평가다. 해시는 변조 탐지용이며 외부 사전등록 증명이 아니다.
첫 응답 전에 책임자가 해시와 평가 계획을 날짜가 남는 외부 기록에 보관해야 한다.
여러 번 만들어 유리한 것만 공개하는 것은 코드로 막을 수 없다. 이 외부 기록이 유일한 방어다.

기준은 다음 세 가지다. 결과를 본 뒤에 바꾸지 않는다.

- 팀별 시간 비율의 중앙값 ≤0.85
- 팀별 품질 차이의 평균 ≥0
- 도구 사용 답변의 중대한 오류 0건

`≥0`은 "품질이 크게 떨어지지 않았다"는 조건일 뿐이다. 품질 개선이나 신뢰할 수 있는
비열등성의 증거가 아니다. 팀 7개·분석가 4명이라 불확실성이 크다.
모두 충족해도 예비 평가 통과이며 `proven_utility`는 false다.

## 자료의 시점

11/11 팩의 `collected_at`은 수집 시점이며, 경기 전 cutoff가 아니다.
이 팩에는 이미 끝난 T1–KC(11/06~07)와 T1–BLG(11/08~09) 경기가 들어 있다.
그래서 사례는 `RETROSPECTIVE_HYPOTHETICAL`로 표시한다. 과거 경기의 사전 준비를
재현한 평가가 아니다. 참가자와 채점자가 실제 결과를 안다는 점도 한계로 남는다.
사전 평가를 하려면 해당 경기 전에 실제로 보관한 팩(`outputs/frozen-scouting-before-20261111/` 등)을
쓴다. 현재 자료를 날짜만 바꿔 쓰지 않는다.

## 진행

```powershell
python ops/draft_utility_study.py prepare --version BUILD_ID --output outputs/utility-v2-RUN/study.json
```

전체 study.json은 진행자 전용이다. 참가자와 채점자에게 공유하지 않는다.
참가자에게는 자기 배정 순서대로 해당 사례의 질문과 evidence만 제공한다. 사용 조건에는
같은 evidence에 aids를 추가한다. 이 평가는 요약·추천 자료의 효용을 본다.
실제 웹 화면 조작 속도는 평가하지 않는다. 모든 참가자는 평가 사례가 아닌 같은 연습을
두 조건으로 먼저 한다. 검색·다른 도구 사용 조건도 동일하게 고정한다.
aids에서 얻은 판단도 근거는 공통 evidence 경로로 적어야 한다고 미리 안내한다.

진행자는 시작부터 제출까지 시간을 직접 기록한다. 진행자는 조건을 알고 있으므로
시간 기록은 맹검이 아니다. 응답은 JSON 배열이다.

```json
[{"assignment_id":"a000-0","elapsed_seconds":120,"decision":"판단과 교환안, 한계",
  "evidence_refs":["/target/player_pools/0"]}]
```

```powershell
python ops/draft_utility_study.py blind --study outputs/utility-v2-RUN/study.json --responses outputs/utility-v2-RUN/responses.json --output outputs/utility-v2-RUN/blind.json
```

blind가 aids 인용이나 잘못된 경로 때문에 실패하면, 실패한 배정과 수정 내역을 기록한다.
조용히 고쳐 다시 돌리지 않는다. blind 이후에는 응답을 바꾸지 않는다.

채점자에게는 blind.json의 `responses`와 공통 evidence만 전달한다.
배정표, study 전체, aids, 시간은 숨긴다. 응답 ID는 응답 파일 없이 복원할 수 없다.
답변 문체로 조건을 짐작할 가능성은 남는다.

채점은 다음 방식으로 한다.

- 미리 등록한 두 채점자가 서로 상의하기 전에 각각 채점한다.
- 항목은 근거 정확성(evidence), 실행 가능성(actionability), 누락 여부(completeness)이고,
  각각 0~4점이다. 0=없거나 틀림, 1=중대한 부족, 2=부분 충족, 3=대체로 충족,
  4=충분하고 추적 가능.
- 근거 경로의 존재는 프로그램이 확인한다. 내용과 주장이 맞는지는 사람이 확인한다.
- 다음 경우 critical_error=true다: 금지되었거나 이미 선택된 챔피언 추천, 근거 조작,
  확인하지 않은 준비 상태를 사실로 단정.

```json
[{"response_id":"blind.json의 ID","rater":"judge-a","evidence":3,
  "actionability":3,"completeness":3,"critical_error":false}]
```

```powershell
python ops/draft_utility_study.py evaluate --study outputs/utility-v2-RUN/study.json --responses outputs/utility-v2-RUN/responses.json --blind outputs/utility-v2-RUN/blind.json --ratings outputs/utility-v2-RUN/ratings.json --output outputs/utility-v2-RUN/report.json
```

응답 140개와 응답당 독립 채점 2개가 모두 있어야 결과를 계산한다. 하나라도 없으면 대기다.
중대한 오류는 두 채점자 중 한 명이라도 표시하면 센다.

집계는 다음 순서로 한다.

1. 팀마다 분석가별로 그 팀 사례의 평균 시간과 평균 품질을 구한다.
2. 시간은 팀마다 두 조건의 분석가 중앙값 비율을 구하고, 그 비율들의 중앙값을 낸다.
3. 품질은 팀별 조건 차이의 평균을 낸다.

시간 입력은 관찰 기록이며, 프로그램이 실사용을 자동 인증하지 않는다.

## 남은 한계

- 사례에 현재 밴픽 진행 상태(금지·확정 픽·이전 게임 피어리스 잠금·준비 미확인)가 없다.
  그래서 "금지·이미 선택된 챔피언 추천" 오류는 거의 일어날 수 없다. 사례 상태를
  추가하기 전에는 오류 0건을 강한 안전 근거로 쓰지 않는다.
- 독립 단위는 7팀이고 분석가는 4명이다. 같은 팀·같은 분석가 안의 상관이 크다.
  7팀은 2로 나누어떨어지지 않아 분석가마다 사용 조건 팀 수가 3 또는 4로 다르다.
- 채점자 ID 검사만으로 실제 사람의 독립성은 인증할 수 없다.
- 확증 연구는 기준과 모델을 고정한 뒤, 이후 경기의 새 사례와 외부 사전등록으로 따로 한다.

## 해석과 공개

좋지 않은 팀·포지션 결과와 오류도 보관한다. 원본 응답과 참가자 식별자는
outputs 아래 비공개로 유지하고, 실제 수집한 집계만 공개 검토한다.
