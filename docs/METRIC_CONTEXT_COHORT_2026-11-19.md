# 동일 맥락 지원 집합의 기준선 (metric context cohort)

2026-11-19 작성, 11-20 KST 보완. 로컬 탐색 연구 진단이며 출시/모델/특징 채택 문서가 아니다.

## 무엇을 하는가

`python -m ops.benchmark_metric_context_cohort --input <csv> --retrieved-at <ISO+tz> --content-hash <sha256> --output <new .json>`

1. **지원 판정**: 고정 `DEFAULT_CONFIG` cohort(2026년 관측 UTC, 메이저 리그, 평가 시작 7월 1일)의
   식별 가능한 target마다 10명 각각에 기존 `build_metric_context`를 **기본 사양 그대로** 호출한다
   (golddiffat15, 최근 20경기, 유효 5, peer 5, 24h 공개 지연 가정). 10명 모두
   `descriptive_context_available`이면 "맥락 지원" 경기. 판정 로직은 복제하지 않는다.
2. **공급(supply)**: 기존 지원 auditor와 동일 — 모든 리그의 accepted season-year 기록, 반복 match ID는
   모든 사본 제외, `_game_issue`(raw player1..10/identity/team/patch)와 within-game 일관성 검사,
   `_observations` 재사용. 사전 색인은 league+role만, **patch 사전 필터 없음**(다른 패치 중복 제외 동작 보존).
3. **기준선**: 전체 `clean_records` + `simulate` **1회**(warmup·리그 타임라인·시간순 Elo 업데이트 유지).
   생성된 예측을 기존 `partition_predictions`로 all/supported/not_supported로 나누고 기존 `summarize`로 채점.
   부분집합 재학습/재시뮬레이션 없음. all은 기존 지원집합 CLI의 all과 동일해야 한다.
4. **출력**: 집계 JSON만 — source hash, config, 기준선 1회 실행 상태, status/query/target 제외/supply 집계
   (전체·리그별), partition 점수, claims/해석. 선수·팀·경기 ID, raw row, target/peer 평균, 위치값,
   query별 peer 수, label, 확률은 쓰지 않는다. 지원 ID 집합은 프로세스 내부 frozenset으로만 쓴다.

정책 재사용: 해시 검증, adapter 해시 대조, retrieved-at 시간대 필수, 실행 전후 source 불변 검사,
raw archive/web 공개 경로/symlink/기존 파일/비 .json 출력 거부.

## 해석 (반드시 함께 읽기)

- 이미 로컬에서 탐색한 cohort·사양이다. 공개 사전등록도, 새 독립 검증도 아니다.
- supported/not_supported 간 성능 차이는 **선택 차이**이며 선수 특징 효과가 아니다.
- 맥락 지원과 이전 13개 raw 지표 history 지원은 **서로 다른 지원 기준**이다(13개 지표 vs 1개 지표 +
  같은 리그 peer 조건). 어느 쪽이 다른 쪽을 포함한다고 단정할 수 없고, 서로의 점수를 대신 쓰면 안 된다.
- `NO_NEW_PLAYER_MODEL_FIT_OR_TUNING`: 새 선수 모델 적합/튜닝이 없다는 뜻이다. 기존 팀 Elo의 시간순
  rating 업데이트는 원래대로 유지된다("학습이 전혀 없다"는 뜻이 아님).
- 점수는 기존 고정 0.5 / blue Laplace / team Elo 기준선뿐이며 제품 승률이 아니다.
- 24h 공개 지연은 가정이며 실제 공개 시각이 아니다. target roster는 known 가정. 실제 retrieved-at은
  별도 provenance. 단위 미검증(`RAW_UNITS_NOT_VERIFIED`), UI/소스 수집 없음(`NO_UI_OR_SOURCE_FETCH`).
- 실제 보관본 결과 수치는 Codex 검증 문서에 기록하며 이 코드/테스트에 하드코딩하지 않는다.

## 테스트

`tests/test_metric_context_cohort.py` (실제 adapter fixture, 3 roster × 5 warmup + target 2개):
지원 1/미지원 1(새 선수 target 부족), status·query 정확 회계, 독립 전체 시간순 reference와 partition 점수
동일, 지원만 refit 시 Elo가 달라짐(=refit 안 함), 기존 cohort CLI all과 동일, 기본 peer5에서 peer 부족 →
빈 지원 partition(None 점수, 이전 13지표 지원은 1경기로 기준이 다름), 중복 supply 제외, identity 불량
target 제외, target 없음, 바이트 해시 불일치 거부, ID/평균/위치/확률 비노출, 출력/입력 거부·source 불변.
Codex 독립 `tests/test_metric_context_cohort_review.py`는 별도 보존.

Claude는 명령/테스트를 실행하지 않았다. 실행·ruff·실제 원본 재실행은 Codex 검증 대상이다.

## 2026-11-20 재개·최종 검증

Claude 원세션 e335ca8a-a3b2-4e10-9b8a-68c4e9e9f146을 사용자 재개 요청으로 이어서 실행했다.
outputs/claude-metric-context-cohort-resume-20261120-result.json은 completed/is_error=false.
이것은 수동 재개 성공이며 어제20:25예약이 실제실행됐다는 근거는 아니다.
Claude가 정식 테스트/문서와 format/표현 수정을 완료했다. Codex는 제품·연구 소스를 대신 수정하지 않았다.

- 신규/독립/과거기록/기준선 관련84개와 ruff check/format 통과.
- Python 전체 **798개 통과**(19.90초), outputs/python-context-cohort-integration-20261120.log.
- 최종 코드SHA256 c709b3a31bf39e6ec3f7057295c1bd65fd3f58da498377981ef2c69bcd4b9a53.
- 실제 fcd2 원본으로 outputs/metric-context-cohort-final-fcd2-20261120.json 새로생성.
- partition전체와context지원집계는 예비실행과 정확히같다. all878 partition은 이전지원집합보고서all과도전체동일.
- 기존15분자동개발예약복원은 도구응답·저장설정으로확인. 아직 다음예약실행을 증명한것은아니다.
- 웹·엔진 변경없음. 웹전체484는 이전cb3f6919시점이며 이번에웹검사를재실행하지않았다.

| 집합 | n | 고정0.5 Brier | Blue Laplace Brier | 팀 Elo Brier | 팀 Elo logloss |
| --- | ---: | ---: | ---: | ---: | ---: |
| 전체 | 878 | 0.250000 | 0.243822 | 0.235459 | 0.662704 |
| 맥락 지원 | 198 | 0.250000 | 0.246299 | 0.251480 | 0.697510 |
| 맥락 미지원 | 680 | 0.250000 | 0.243100 | 0.230794 | 0.652569 |

Brier/logloss는낮을수록좋다. 같은지원집합에서Elo는단순0.5보다도조금나빴고 Blue Laplace보다나빴다.
미래선수모델은세기준선과같은집합에서비교해야하며 약한Elo하나만이긴것을효용입증으로쓰지않는다.
새선수모델을학습하거나지표효과를입증한결과가아니고, 이미탐색한집합의선택차이다.
새원본/API/프로필수치공개/제품push/merge/deploy 없음.
