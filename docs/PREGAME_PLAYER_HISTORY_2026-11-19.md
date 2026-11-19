# 경기 이전 선수 관측 추출 (연구 전용) — 2026-11-19

파일: `ops/pregame_player_history.py`, `tests/test_pregame_player_history.py`. 기존 파일은 수정하지 않았다.

## 범위
- 순수 함수 `extract_player_history(observations, query, config)` → 로컬 연구용 dict. 웹·CLI·수집·모델·라벨·출시 없음.
- metric 목록/분류는 `ops/audit_performance_coverage.METRICS`, `classify_value`, `ROLES` 재사용.

## 가정
- 가용 시각은 `observed_at + publication_delay`(기본 고정 24h) **시뮬레이션**이며 실제 공개/수집 시각이 아니다. snapshot의 실제 `retrieved_at`은 별도 provenance로, 사용·과거 위장하지 않는다.
- 현재 경기 roster(조회 player/role)는 호출자 가정(`known_target_roster_assumption`)이다.
- `maximum_games=20`, `minimum_games=5`는 추출기 연구 사양이며 성능으로 고른 값이 아니다.

## 규칙
- timezone-aware 시각만, 지연 > 0, limit은 양의 int(bool 거부), min ≤ max. 빈/공백 ID, 미지원 role, 빈 patch, 미지원 metric 키(`result` 등), 비문자열 값 거부.
- 같은 player_id + role + 정확한 patch_id만. target_match_id는 항상 제외. `observed_at + delay <= cutoff`(경계 포함).
- 같은 player+role+match_id 관측이 둘 이상이면(내용 동일·patch/시각 차이 포함) 전부 제외하고 `duplicate_match_ids`/`duplicate_match_observations`로 보고. 중복 판정은 target 제외·가용성 필터 후, patch 필터 전에 수행한다. 아직 가용하지 않은 중복은 과거 기록을 지우거나 평균을 바꾸지 못한다.
- `(observed_at, match_id)` 정렬 후 최신 `maximum_games`개 사용. 입력 순서 무관.
- metric별 valid/missing(blank vs column_absent)/invalid 수, `mean_raw`는 유효값 ≥ `minimum_games`일 때만. 평균은 fsum → 오버플로 시 값/n 합산으로 재시도, 여전히 비유한이면 `None` + `nonfinite_mean_not_reported`. 누락·invalid를 0으로 채우지 않고 관측된 0은 유효.
- 출력에 `used_match_ids`, `latest_simulated_available_at`을 남겨 누출 검사 가능. `publication_permitted: False` — 공개 파일/웹 export 금지.
- 입력 목록·객체·호출자 metrics dict 불변(관측 객체는 읽기 전용 사본 보관).

## 미검증
- Claude는 검사를 실행하지 않았다. 이후 Codex가 신규 35개 및 기존 연구 검사와 합친 88개를 통과시켰고 ruff를 확인했다. 웹 타입 검사는 이번 순수 Python 변경에 해당하지 않는다.
- 실제 OE snapshot → `HistoryObservation` 변환기는 없다(범위 밖). match_id가 다른 형태로 들어온 현재 경기는 탐지할 수 없다.
- 실제 공개 지연 분포, roster 사전 가용성은 검증하지 않았다.
- `gamelength`의 경기 내 일관성 검사(10행 비교)는 단일 선수 관측이라 적용하지 않는다.


## Codex temporal review

The initial implementation counted duplicate match IDs before filtering availability. A future
conflicting observation could therefore erase eligible past history. A regression failed before
and passed after filtering simulated availability first. Duplicate rejection now applies only to
observations available at the query cutoff. Current-match exclusion still precedes aggregation.
This does not resolve actual multi-snapshot correction provenance or admit features to a model.


## 실제 보관본 연결 검사

Codex가 어댑터 수용·10명 식별 유효 게임의 선수행만 순수 추출기에 연결해, 이전 기준선과
동일한 탐색용 878경기·8,780선수 질의에 적용했다. 실제 fcd2 해시·수집시각은 관측 점검
문서와 같고, 추가 요청은 없다. 신규 CLI나 공개 데이터셋을 만든 것은 아니다.

- 같은 선수·역할·정확 패치의 5경기 이상: 3,770명-경기, 10명 모두 충족: 265경기.
- 최근 최대20개 중 13개 수치 각각 유효 5개 이상: 3,704명-경기, 10명 모두 충족: 256경기.
- 선수 질의 2,466개는 같은 패치의 가용 이전 관측이 전혀 없다.
- 모든 질의에서 사용 경기 수가 독립 계산의 min(20, 이전 경기 수)와 일치했고, 현재 경기 ID
  제외 및 가장 늦은 가정 가용시각 <= 대상 경기 시각을 확인했다.

결과: outputs/history-extractor-real-cohort-20261119.json (ID·평균값 없는 집계만).
탐색용 스크립트: outputs/verify-history-extractor-20261119.py.
과거 자료가 많다는 이유만으로 현재 패치의 선수 효과를 계산할 수 없다. 패치 간 이전은
별도 설계·정규화·검증이 필요하며, 이 256경기만 고르면 평가 집합 자체가 달라진다.
그 집합의 성능을 기존 878경기 기준선과 직접 비교해 개선이라고 부르면 안 된다.
