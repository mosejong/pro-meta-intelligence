# C3c — 밴픽 승패 모델의 추가 정보량을 먼저 측정 (오프라인)

2026-11-17 자동 진행. Opus 5.5 Medium. 사용자 목표는 실제로 근거 있는 감독형 시뮬레이션.
가정 기반 simulation-core는 실제 모델이 아니므로 UI 승패 연결 전에 **팀 실력 기본값보다 밴픽 정보가 추가로 도움이 되는지** 확인한다.
commit/push/merge/deploy/새 네트워크 수집/패키지 설치/유료 설정 변경 금지. 한도 오류 시 상태 기록 후 중단, 반복 호출·모델 우회 금지.

## 소유·범위

새 `ops/draft_outcome_baseline.py`, 새 `tests/test_draft_outcome_baseline.py`, `docs/DRAFT_OUTCOME_BASELINE_RESULT.md`만 수정. 기존 src/web/워크플로/다른 docs는 수정 금지.
stdlib만 사용. 실제 데이터 원본·개인 자료·raw CSV를 커밋하지 않는다. outputs에 작은 aggregate JSON/로그만.
읽기: models.py의 MatchRecord/PickBanEvent, adapters/oracles_elixir.py(정확한 경로 탐색), 기존 ops/build_player_season_history.py 및 opponent/draft_scout_backtest.py의 source policy/시점 처리 패턴. 실행 전 해당 파일의 실제 인터페이스 확인.

## 고정된 실험 설계 (결과 보고 하이퍼파라미터 조정 금지)

- 승인된 로컬 archive만: outputs/oracles-elixir/raw/oracles-elixir-match-data/fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de.csv
  metadata 같은 stem의 `.20261111T021929155420Z.meta.json`. 원본 retrieved_at 2026-11-11T02:19:29.155420+00:00, 유효 경기 11/10까지. final까지 포함했다고 쓰지 않는다. source gate/원본 해시 검증은 기존 어댑터/아카이브 방식 재사용, 검증을 끄지 않는다.
- season2026 경기, 정확히 양팀 서로다름·winner둘중하나·양팀5픽(중복 없음)을 가진 경기만. 모든 필터/제외 사유 수 보고. 선수/역할/게임내 통계는 모델 입력에 사용하지 않는다.
- 평가 = 순차(walk-forward) 2026-08-01 00:00Z 이후. 이전 경기는 학습 warmup. 모든 예측은 경기 observed_at 직전(동일 시각 다른경기 레이블 불가). 모델 업데이트는 **관측 +24h의 시뮬레이션 공개 지연**을 충족한 경기만. 원본이 당시 확보됐던 사실로 주장하지 않는다.
- 유효시각 기준 대기 큐로 레이블을 업데이트하며 observed_at+24h가 현 경기 cutoff보다 이른 경우만. 원본 available_at는 bulk retrieval이라 과거 실측 아님: 별도 명시. 실제 source provenance를 미래 날짜로 가짜로 바꾸지 말고 시뮬레이션 평가 필드를 분리한다.
- 팀 Elo baseline: 초기1500, K20, scale400, side advantage0 고정. 예측 당시 prior Elo만. 팀 ID 기준, 이름조인 금지.
- Elo+draft: `sigmoid(logit(Elo_prob) + sum(blue champion weights) - sum(red champion weights))`.
  champ weights 초기0, online logistic gradient lr0.03, 업데이트된 경기의 예측 당시 feature/elo logit 기준 error(y-p)를 사용. 해당 픽 champion weights에 L2 factor0.9999 후 gradient, 한 경기에서 같은champ중복없음. 다른 팀/선수 가중치 추가 금지. **하이퍼파라미터 탐색하지 않는다**.
- 같은 경기에는 baseline/draft 두 확률(극단은 logloss계산에만 epsilon1e-12 clamp). 비교는 accuracy, logloss, Brier, 표본수. 50% baseline도 보고.
- overall뿐 아니라 league/patch 구분(최소표본표시), 특히 WLDs/LCK/LEC/LPL. 전부 global모델이며 지역비교가 인과적이라고 하지 않는다.
- 일자 단위 paired mean loss difference (draft-baseline)와 1000회 bootstrap95%CI(seed20261117), 같은날cluster 유지. 날짜 수가 부족하면 CI 미표시. interval은 이자료의 설명적 구간, 재튜닝 검증 아님.
- 결과 판정은 탐색적: draft가 logloss/Brier에서 baseline보다 낫다는 관측이 없으면 추천효과 미입증. 낫더라도 실제 밴픽 변경의 인과적 효과/승률/시뮬레이터 보정 입증 아님. 결과 UI에 연결 금지.

## 완료·검사

작은 합성 fixture로 no-future-label(당일 결과 바꾸어도 그날예측 동일), 동일시각/24h 경계, champion5수/중복/팀winner검증, frozen파라미터, 결정적 반복, Elo update 방향/제로champbaseline 일치 검사.
관련 pytest + ruff만 우선. 실제 archive 실험은 원본을 다운로드하지 않고 로컬에서 수행하고 small JSON outputs/draft-outcome-baseline-20261117.json. 막힌 실행은 우회하지 말고 보고.
문서에 데이터 기간·검증 방식·누락·전역/대회별 결과·한계·실행한검사/안한검사 명시. 패키지/제품 ML 기능이라고 부르지 않는다.
