# 15분 지표 경기 내 산술 정합성 진단 (2026-11-19)

상태: 구현 완료, **미실행**(테스트·실제 스냅샷 실행은 Codex 검증 대상). 연구 전용 진단이며 출시/완결성 주장이 아니다.

## 범위

- `ops/audit_lane_stat_consistency.py` (신규), `tests/test_lane_stat_consistency.py` (신규), 이 문서.
- 기존 추출기/제품/registry/adapter/기준선/실험계수는 변경하지 않았다.
- 재사용: `audit_performance_coverage.classify_value`, `_identity_reasons`, `raw_player_rows`,
  `_hash_hex`, `_iso`; `audit_pregame_history_support.validate_output_path`(web 발행 경로/원본
  아카이브/source/기존 출력/symlink 거부).

## 관계 (필드명 기반 진단 가설, source 사전 재확인 아님)

각 경기 × 5 role × 5 rule = 25 슬롯.

| rule | 정의 |
| --- | --- |
| `golddiffat15_blue_plus_red_is_zero` | blue golddiffat15 + red golddiffat15 == 0 |
| `csdiffat15_blue_plus_red_is_zero` | blue csdiffat15 + red csdiffat15 == 0 |
| `xpdiffat15_blue_plus_red_is_zero` | blue xpdiffat15 + red xpdiffat15 == 0 |
| `goldat15_difference_equals_golddiffat15_both_ways` | blue−red goldat15 == blue golddiffat15 **그리고** red−blue == red golddiffat15 |
| `csat15_difference_equals_csdiffat15_both_ways` | blue−red csat15 == blue csdiffat15 **그리고** red−blue == red csdiffat15 |

부호 대칭(rule 1–2)만 맞고 절대값이 수준 차와 모순되면 rule 4–5가 별도로 `inconsistent`가 된다.
tolerance는 abs 1e-6 / rel 0 고정이며 결과를 보고 조정하지 않는다.

## 상태 (상호배타, 우선순위 순)

`identity_unresolved` → `dependency_invalid` → `dependency_missing` → `arithmetic_unavailable` →
`consistent` / `inconsistent`.

- 의존 필드 각각을 `classify_value`로 분류. invalid가 missing보다 우선. 관측된 0·음수 diff는 유효.
  `goldat15`/`csat15`는 기존 규칙대로 음수 불가(`csat15` 정수).
- 계산 중 overflow/nonfinite → `arithmetic_unavailable`(판정 없음). 원값 자체가 nonfinite면 invalid.
- `gamelength`는 15분 관측 자격 판정에 쓰지 않는다(단위 미확인).

## identity fail-closed

경기 단위로 정확히 10행 / participantid 1–10 / blue·red 각 role 1명 / 고유 playerid / side 내
teamid 일관 / 양 side teamid 상이 / raw teamid == adapter record를 검사. 하나라도 실패하면 그 경기
25 슬롯 전부 `identity_unresolved`이며 원인을 경기 수로 센다(`row_count_below_10`,
`row_count_above_10`, `participantid_not_exactly_1_to_10`, `missing_side_role`,
`duplicate_role_in_team`, `duplicate_playerid_in_game`, `same_teamid_both_sides`,
`raw_teamid_differs_from_adapter_record` 등). 누락을 일치로 세지 않는다.

## 집계 범위

- adapter accepted + observed_at UTC 2026 + provenance hash 일치 경기만.
- 같은 match ID가 2회 이상이면(동일 사본 포함) 모든 사본 제외(`duplicate_match_id_records`).
- 범위 제외 사유는 `scope.scope_exclusions`, identity 실패는 슬롯에 포함해 `unresolved`로 회계.
- overall / by_league / by_patch, rule별 `slots/tested/consistent/inconsistent/missing/invalid/
  unresolved/arithmetic_unavailable` count만. `tested = consistent + inconsistent`.
  슬롯 합계 불일치 시 RuntimeError.
- 출력에 값·잔차·선수/팀/경기 ID·raw row·팀별 값 없음. 유일한 식별자는 source sha256.

## CLI

```
python -m ops.audit_lane_stat_consistency --input <csv> --retrieved-at <ISO+tz> \
  --content-hash <sha256> --output <new .json>
```

hash/timezone 검증 → 출력 경로 검증 → 실제 adapter import → adapter hash 재확인 → 쓰기 전 source
hash 재확인 → `open("x")`(덮어쓰기 금지) → 쓰기 후 source 변경 시 보고서 철회.

Claims: `NO_NETWORK`, `NO_MODEL`, `RAW_UNITS_NOT_VERIFIED`, `RELATIONSHIPS_ARE_DIAGNOSTIC_HYPOTHESES`,
`NO_CHANGE_TO_HISTORY_ADMISSION` 외.

## 해석 한계

- 불일치는 데이터 오류나 선수 잘못의 판정이 아니며 기존 관측·history 지원 판정을 바꾸지 않는다.
- 선수 효과/실력/승률/정규화/상성/스왑 해석 없음. 새 소스 검증 아님.
- 관계 정의는 필드명 추정이다. 예: diff가 라인 상대가 아닌 다른 기준이거나 반올림된 값이면
  체계적 불일치가 나올 수 있으며, 그 경우에도 tolerance를 바꾸지 않고 가설 자체를 재검토한다.
- 실제 fcd2 스냅샷 결과는 Codex 실행 후 별도 기록.

## Codex 실제 검증 — 2026-11-19

Claude session 800ea1f6-5188-49df-8012-ad1e55eb0c31 completed/is_error=false.
Claude가 지정된 신규3개 파일을 구현했다. Codex 제품 코드 수정 없음.
작성 도중 검사에서 테스트의 과도한 GAME 문자열 차단과 사용하지 않는 변수 경고가 있었으나,
Claude 최종본이 두 부분을 자체 수정했다. 최종본 관련80개·ruff check/format 통과.
Python 전체 **751개 통과**, outputs/python-lane-stat-integration-20261119.log (17.62초).
이번 작업은 웹/엔진/기존 관측 판정을 바꾸지 않았으며 웹 전체 재실행은 하지 않았다.
이전 cb3f6919 시점 웹484 통과와 구분한다.

### 실제 보관 원본

원본 sha256 fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de,
실제 수집 시각2026-11-11T02:19:29.155420Z, 79,467,277 bytes.
신규 CLI를 실제 실행해 outputs/lane-stat-consistency-fcd2-20261119.json 생성. 재요청/가공 원본 없음.
기존 어댑터 수용9,262/거부642경기, observed UTC year2026 범위9,262, 범위제외0.
전체 slots 231,550 = 9,262 × 5역할 × 5관계.

| 각 관계의 상태 | 관계당 수 | 5관계 합계 |
| --- | ---: | ---: |
| 계산 가능·일치 | 44,305 | 221,525 |
| 계산 가능·불일치 | 0 | 0 |
| 의존 지표 누락 | 65 | 325 |
| 의존 지표 형식 오류 | 0 | 0 |
| 선수 식별 부족 | 1,940 | 9,700 |
| 산술 계산 불능 | 0 | 0 |
| 전체 | 46,310 | 231,550 |

식별 부족은388경기의 playerid 누락이며, 기존 수치 점검의 완전 식별8,874경기와 정확히 일치한다.
기존 점검의 goldat15/csat15/세 diff 지표 각각 누락130행·10명 모두유효8,861경기와도 대조했다.
5관계×5역할 슬롯은 독립 경기 표본이 아니다. 하나의 경기에서 여러 관계를 확인한 회계다.
전체/리그/패치 버킷마다 슬롯 합, tested=consistent+inconsistent, 리그/패치 경기 합계를 별도 검산했다.

### 해석

이 보관본의 계산 가능한 관측은 고정된 산술 가설과 일치했다. 원시 지표 사이 관계 점검을
통과했다는 뜻이며 단위 정의나 선수 효과/실력/시대 보정·예측력을 입증한 것이 아니다.
필드 의미는 원본 사전에서 재확인 전이고 15분 전에 끝난 게임의 처리 규칙도 여기서 추정하지 않았다.
일치 결과를 근거로 기존13지표 지원 판정이나 과거 선수 실행 가드를 해제하지 않는다.
새 원본/API/학습/웹 수치 노출/푸시/배포 없음.
