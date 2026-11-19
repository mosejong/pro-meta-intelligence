# 과거 선수 기록 지원 범위 CLI (2026-11-19)

## 실행

```
python -m ops.audit_pregame_history_support --input <OE csv> --retrieved-at <ISO+tz> \
  --content-hash <sha256 hex | sha256:hex> --output <new .json>
```

네 인자 모두 필수. timezone 없는 `--retrieved-at`, 해시 불일치(입력 bytes·어댑터 report 모두), 기존 출력, 입력 자체, `.json` 이외, `outputs/oracles-elixir`, `web/{public,dist,dist-pages,.site-public,static-site}` 및 임의 경로의 `web/<같은 segment>`는 거부한다(symlink는 resolve 후 검사, 출력 symlink 거부). 쓰기 전·후 원본 해시를 재확인하고, 쓰기 후 바뀌었으면 출력을 지우고 실패로 종료한다.

## 동작

- 어댑터: 기존 `SourceRegistry.load_default()` + `OracleElixirCSVAdapter`, source timezone UTC.
- 대상 cohort: `benchmark_match_baselines.DEFAULT_CONFIG` 그대로(2026 observed UTC year, 기존 주요 리그, `observed_at >= 2026-07-01`). `clean_records(..., expected_hash=...)` 재사용. 분할·계수·리그 변경 없음.
- 공급 후보: 같은 `clean_records`를 리그 제한만 "입력에 있는 모든 리그"로 넓혀 호출 → 모든 수용 2026 게임.
- 공급 게임 조건: raw participant 정확히 1~10, `audit_game(...).identity_valid`, 선수 행 teamid가 어댑터 레코드 blue/red team id와 일치, patch 비어있지 않음. gamelength가 10행에서 불일치하면 그 게임 관측 전체를 공급 제외(`gamelength_inconsistent_within_game`); 값 변조·sentinel 없음.
- 같은 match_id가 어댑터 출력에 2회 이상(동일 사본 포함)이면 공급·대상 모두 제외하고 `duplicate_match_id`로 집계.
- 원본 헤더에 없는 metric은 mapping에 넣지 않아 extractor에서 `column_absent` 유지.
- 질의: 식별 가능한 대상 게임의 10명 각각, `player_id + role + 정확 patch`, cutoff=대상 observed_at, target_match_id=정확 ID. `HistoryConfig()` 고정(24h, max20, min5). (player, role) 사전 색인은 extractor 자체 scope와 동일.
- metric "raw mean 유효" = extractor `mean_raw is not None`.

## 출력 (aggregate only)

`overall` / `by_league[league]`: target_games, target_games_excluded(이유별), queries, queries_zero_prior_observations, queries_min_games_met, games_all_10_min_games_met, queries_metric_raw_mean_valid(metric별), queries_all_metrics_raw_mean_valid(13개), games_all_10_all_metrics_raw_mean_valid. 그 외 source(hash/size/실제 retrieved_at), history_supply(관측 기간, 공급 제외 사유, metric 컬럼 유무), cohort_scope, parameters, `status`(`OK` 또는 `EMPTY_COHORT`).

값, 평균, 선수/팀/match ID, 이름, used_match_ids, 개별 extractor 결과는 출력하지 않는다. baseline·승률·label 계산 없음.

Claims: NO_MODEL_EFFECT, NO_TRAINING, EXPLORATORY_COHORT_NOT_UNTOUCHED_VALIDATION, SIMULATED_AVAILABILITY_24H_NOT_ACTUAL, TARGET_ROSTER_KNOWN_ASSUMPTION, RAW_NOT_NORMALIZED, NO_PUBLICATION. 어댑터는 결과(winner) 컬럼을 게임 수용 검증에만 사용하며, history metric에는 결과/이름 컬럼이 들어가지 않는다.

## 비교 주의

지원 충족 게임(예: 878 중 256)은 선택된 부분집합이다. baseline과 비교하려면 같은 부분집합에서 baseline을 다시 채점해야 한다.

## Codex 검증 및 남은 범위

- Claude는 검사를 실행하지 않았다. Codex가 신규14개·ruff를 통과시켰다. 신규13개 시점 연구 합산101개도 통과했다.
- 테스트 fixture가 가정하는 것: 어댑터 match_id 형식 `oe:{league}:{gameid}`, 날짜만 다른 복제 게임을 어댑터가 모두 수용, 플레이어 행 teamid = 어댑터 blue/red team id.
- 비-cohort VCS 과거6경기가 같은 선수·역할·패치 LCK 대상1경기의 10명 질의에 공급되는 실제 어댑터 fixture 검사를 추가해 통과했다.
- 쓰기 후 원본 변경 시 출력 삭제 경로는 테스트 없음.


실제 fcd2 CLI 실행은 outputs/pregame-history-support-cli-20261119.json에 보존했다.
878대상/8,780질의, 이전5경기 이상3,770질의/전원265경기, 모든13개 평균 준비
3,704질의/전원256경기, 이전관측 없음2,466질의로 독립 임시 연결 검사의 집계와 일치했다.
공급 제외는 선수식별 불가388경기였다. 입력 불변·해시 확인을 거쳤으며 네트워크 요청은 없다.
이것은 실제 수치 관측 지원 범위 재현이며 승률·학습·인과적 효과·새 독립 검증 결과가 아니다.

최초 privacy 검사는 설명문 안의 mean_raw 단어까지 데이터 누출로 오인했다.
설명문은 보존하고, 실제 반환 키를 재귀 확인하며 값/ID canary도 검사하게 고쳤다.
비-cohort fixture 최초 실패는 팀행 participant IDs를11/12로 잘못 지정한 테스트 작성 오류였다.
실제 fixture의100/200으로 수정한 뒤 통과했다. 두 건을 제품 정보 누출이나 공급 결함으로 세지 않는다.
