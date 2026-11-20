# 동일 맥락 기준선 — Codex 예비 검토

2026-11-19 KST. Claude 사용 한도 대기 중 Codex가 **이미 작성된 파일을 수정하지 않고** 검증했다.
정식 구현 완료/회귀 완료/출시 승인 문서가 아니다.

## 검토 대상과 실행

- Claude 소유 ops/benchmark_metric_context_cohort.py, 미완료·미커밋.
- 실행 당시 소스 SHA256 9cd331b03d6ca94c47b07e63c8e164c11d95e677099bbffe65d898d940706fd9.
- Claude는 사용 한도429로 종료된 상태이며 재호출하지 않았다. 재개는20:25KST예약 그대로다.
- 신규 정식 tests/test_metric_context_cohort.py와 docs/METRIC_CONTEXT_COHORT_2026-11-19.md는 아직 없다.
- 제품/연구 소스 수정 없이 Codex 독립 tests/test_metric_context_cohort_review.py를 작성했다.
  참조선수가 부족해 지원0경기인 사례에서도 모든 기존예측을 보존하고 simulate를 전체시간순서로
  정확히1번호출하며, 비지원전체점수가원래전체점수와같고 빈지원점수를None으로남기는지 검사한다.
- 독립1개+기존지원집합10개=11개통과, Codex검증파일ruff통과.
- 신규CLI의lint는통과/format은미통과 상태 유지. Claude가format과남은구현/정식테스트를 끝내야한다.

## 실제 원본 시험 실행

보관본 fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de,
실제retrieved2026-11-11T02:19:29.155420Z를 기존adapter/policy로 실행했다. 새수집없음.
결과 outputs/metric-context-cohort-pretest-fcd2-20261119.json. 기존원본/결과를덮어쓰지않았다.

독립 대조:
- 전체878경기 partition은 outputs/supported-cohort-baselines-fcd2-20261119.json의all과 **전체동일**.
- query8,780/가능2,422/본인부족5,733/참조부족625/10명전원가능198/불가680은 이전
  outputs/pregame-metric-context-support-fcd2-20261119.json와 전체·각리그 status집계까지동일.
- 원래2,456경기시간순실행(워밍업1,578개)을유지. 878=198+680의정확분할.
- source최신경기는2026-11-10. 실제로과거당시공개되었는지재현한것아닌24h지연가정이다.

| 평가 집합 | n | 고정0.5 Brier | Blue Laplace Brier | 팀 Elo Brier | 팀 Elo logloss |
| --- | ---: | ---: | ---: | ---: | ---: |
| 전체 | 878 | 0.250000 | 0.243822 | 0.235459 | 0.662704 |
| 맥락 지원 | 198 | 0.250000 | 0.246299 | 0.251480 | 0.697510 |
| 맥락 미지원 | 680 | 0.250000 | 0.243100 | 0.230794 | 0.652569 |

Brier/logloss는낮을수록오차가작다. 이198경기에서팀Elo는고정0.5보다조금나쁘고
Blue Laplace보다도나빴다. 기존전체878경기점수를이집합의비교기준으로대신쓰면안된다.
향후선수모델은같은집합의세기준선과함께비교해야하며 약한Elo만이긴것을효용입증으로쓰지않는다.
이결과는표본선택차이이고선수지표효과/새모델/새독립검증/확률보정/실제교체효과가아니다.
개별평균/위치/선수·팀·경기ID/확률은출력하지않았다.

## 재개 시 주의

이번결과는위소스해시의예비실행이다. Claude가동작을고치면그최종본으로새출력경로에재실행하고
이표를자동승계하지않는다. 코드가안바뀌어도정식단위테스트와format은여전히필수다.
Codex 독립검증파일은Claude담당파일과겹치지않으며같이보존한다. 미완료모듈없이테스트만
커밋하면fresh clone에서깨지므로둘다최종통합전까지미커밋으로둔다.
제품push/merge/deploy·새source/API·유료/모델/계정우회없음.
