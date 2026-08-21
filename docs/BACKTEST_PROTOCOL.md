# Historical Backtest Protocol

## 목적

이 프로젝트는 `다음 OP 챔피언을 맞힌다`고 주장하지 않는다.

검증 질문은 다음 하나로 제한한다.

> 특정 과거 시점까지 실제로 이용 가능했던 공개 정보만으로, 이후 프로 경기에서 의미 있게 등장한 비주류 전략을 제한된 검토 후보군 안에 얼마나 일찍 포함할 수 있었는가?

## Unit of evaluation

기본 단위는 `(patch, role, champion, cutoff_time)`이다. 필요 시 team/region context를 추가한다.

## Time travel contract

각 backtest run은 immutable `snapshot_id`를 갖는다.

```text
snapshot_id
cutoff_time
allowed_sources
source_versions
feature_version
model_version
prompt_version (agent 사용 시)
code_commit
```

`available_at > cutoff_time`인 데이터는 어떤 형태로도 feature/RAG/context에 포함할 수 없다.

## Target definition

Joker/meaningful adoption은 사전에 정의하고 tournament를 본 뒤 변경하지 않는다. 후보 정의 예:
- pre-window pro presence가 임계치 이하
- post-window에 Tier-1 pro 경기에서 최소 N회 pick/ban 또는 특정 series에서 전략적으로 채택
- role swap/flex는 별도 label

정확한 threshold는 exploratory set에서 고정하고 final holdout에는 변경하지 않는다.

## Baselines

복잡한 모델은 최소 다음 baseline과 비교한다.

1. Patch buff heuristic
2. High-elo pick-rate delta
3. High-elo win-rate delta (sample-size guard 포함)
4. Recent pro presence delta
5. Region-divergence ranking
6. Weighted linear score without LLM

멀티에이전트가 baseline을 실질적으로 이기지 못하면 제품 핵심 엔진으로 채택하지 않는다.

## Metrics

### Discovery quality
- Recall@K
- Precision@K
- Mean/Median Lead Time
- False Alerts per patch
- NDCG@K (priority ranking 평가 시)

### Workflow value
- Review Compression = 전체 champion-role 후보 수 / 사람이 검토해야 하는 K
- Evidence Coverage = 추천 중 provenance가 완전한 비율
- Contradiction Rate = 핵심 evidence끼리 충돌하는 후보 비율

### Calibration
점수를 probability처럼 노출하려면 calibration error/Brier score 등을 검증한다. 검증하지 않은 0~1 score를 `87% 확률`처럼 표현하지 않는다.

## Evaluation splits

권장:
- Development: 과거 여러 시즌/대회
- Validation: 이후 대회
- Final sealed holdout: 가장 최근의 사용 가능한 대회/기간 하나

Final holdout 결과를 본 뒤 feature/threshold를 바꾸면 해당 holdout은 폐기하고 다음 미래 구간을 기다린다.

## Ablation harness

동일 snapshot에서 비교:

```text
B0: simple statistical baseline
B1: engineered deterministic score
B2: + expert/OTP weak signals
B3: + historical similarity
B4: single strategy agent
B5: independent multi-agent harness
B6: multi-agent + human analyst decision
```

비교 목적은 `AI가 많을수록 좋다`를 증명하는 것이 아니라 **어떤 구성요소가 실제 incremental value를 만드는지 제거 실험으로 확인하는 것**이다.

## Anti-leakage tests

CI에서 최소 다음 테스트를 강제한다.

1. future rows rejected
2. feature materialization respects cutoff
3. RAG retriever cannot retrieve future documents
4. patch snapshot immutable
5. target labels not present in feature table
6. agent prompt receives only snapshot-scoped evidence IDs

## Failure reporting

좋은 결과만 골라 공개하지 않는다.

예시:

```text
Recall@10: 0.61
Baseline Recall@10: 0.57
Lead time: +2.1 days
False alerts/patch: +1.4

Interpretation:
Recall은 개선됐지만 false alert 비용이 증가했다.
현재 단계에서는 analyst review filter가 필요하다.
```

이 형태가 프로젝트의 기본 보고 규칙이다.
