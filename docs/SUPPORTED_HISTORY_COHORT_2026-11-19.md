# 과거선수수치 지원 집합의 팀 기준선 (연구 전용, 2026-11-19)

상태: 구현 완료. Codex 검증: 신규·기존 cohort/support/baseline 테스트 37개 통과, fcd2 실행 성공.

## Codex 보고 실제 결과 (fcd2)
support.overall/by_league/history_supply는 이전 고정 artifact와 정확히 동일. 분할 878 = 256 + 622.

| partition | n | team Elo Brier | team Elo logloss |
|---|---|---|---|
| all | 878 | 0.235459 | 0.662704 |
| supported | 256 | 0.248682 | 0.691387 |
| not_supported | 622 | 0.230017 | 0.650899 |

참고: fixed 0.5는 Brier 0.25 / logloss 0.693147. supported에서 Elo는 0.5와 거의 같고
not_supported보다 나쁘다. 이것은 **선택된 집합 차이**일 뿐이며 player feature 효과나 새 검증이 아니다.
기존 시간순 team Elo rating 업데이트(warmup 포함)는 전체 timeline에서 그대로 유지했고,
새 player model 적합·튜닝은 없다.

## 코드
- `ops/audit_pregame_history_support.py`: 기존 계산을 `assess_support_with_ids()`로 옮기고
  지원 대상 match_id `frozenset`을 함께 반환. `assess_support()`는 그 dict만 그대로 반환(값·스키마·CLI 불변).
  지원 = 해당 target의 10개 쿼리 모두 minimum_games 충족 + 13개 metric 모두 유효 raw mean.
- `ops/benchmark_supported_history_cohort.py`: `python -m ops.benchmark_supported_history_cohort
  --input --retrieved-at --content-hash --output`. 검증·adapter·SHA·timezone·출력 보호는 기존 auditor 재사용.
  `DEFAULT_CONFIG`로 전체 시간순 `clean_records`+`simulate` 한 번 → 만든 Prediction을 ID로
  all/supported/not_supported로 나누고 기존 `summarize`로 채점. 겹침·누락 검사(`partition_check`).
- `tests/test_supported_history_cohort.py`: 기존 auditor fixture(`write_csv`) 재사용.

## 출력
source hash/수집시각, config, baseline_run 집계, support 집계(auditor overall/by_league), partition별
리그 n/Brier/logloss/accuracy. 빈 집합은 `EMPTY_COHORT` + 기존 None 점수. ID·선수/팀·확률·label 없음.

## 가정과 해석
- 이미 본 탐색 cohort, 24h 가용성은 시뮬레이션, target roster는 알려진 것으로 가정.
- 지원 게이트는 feature 채택이 아님. 기준선은 팀 정보만 쓰므로 supported가 더 좋아 보여도
  player feature 효과가 아니라 **선택된 집합 차이**다.
- supported 집합은 향후 모델의 같은-집합 비교 바닥으로 쓸 수 있으나 새 독립 검증이 아니다.
- 파라미터 튜닝·재적합·최적화 없음. 인과 효과나 출시 승률 아님.


## Codex 독립 재현

관련 신규/기존37개 및 ruff 검사·포맷 통과. 실제 fcd2 로컬 원본의 SHA와 수집시각
2026-11-11T02:19:29.155420+00:00를 확인해 CLI 실행했다. 결과
outputs/supported-cohort-baselines-fcd2-20261119.json. 기존 지원 보고서의 overall,
by_league, history_supply와 새 support 집계가 정확히 같아 리팩터 전 의미 보존을 확인했다.

| 평가 집합 | 경기 | 항상0.5 Brier | 팀 Elo Brier | 팀 Elo 로그오차 |
|---|---:|---:|---:|---:|
| 전체 | 878 | 0.250000 | 0.235459 | 0.662704 |
| 선수 과거 기록 충족 | 256 | 0.250000 | 0.248682 | 0.691387 |
| 미충족 | 622 | 0.250000 | 0.230017 | 0.650899 |

리그별 충족 집합: LCK76경기 Elo Brier0.262690, LPL36경기0.211366,
WLDs29경기0.196850. 작은 표본과 이미 본 탐색 자료이므로 리그 우열·유의성·출시 정확도로
발표하지 않는다. 특히 같은 팀 Elo라도 집합이 달라지면 점수가 달라진다. 이후 선수 feature를
연구한다면 전체878경기 점수를256경기의 경쟁 기준으로 그대로 가져오면 안 된다.

추가 원본 요청·원본 변경·새 선수모델 학습·계수 최적화·UI 승률 연결·제품 배포 없음.
정상 Elo 시간순 업데이트는 기존 기준선 프로토콜 그대로이며 별도 선수 학습 허가를 뜻하지 않는다.
