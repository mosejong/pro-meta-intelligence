# 실제 수치 관측의 유효성·누락 점검 (2026-11-19)

담당: Claude Opus 5.5 (medium). 이 단계는 로컬 진단만 한다. 기존 수용 경로, `audit_simulation_features.py`의
UNSUPPORTED 판정, 입수·선수 집계·시뮬레이션·웹 코드는 바꾸지 않았다.

## 상태 요약

| 항목 | 상태 |
| --- | --- |
| `ops/audit_performance_coverage.py` | 작성 완료 |
| `tests/test_performance_coverage.py` | 작성 완료, **실행 안 됨** (아래 참조) |
| ruff | **실행 안 됨** |
| fcd2 2026 실제 스냅샷 실행 | **실행 안 됨** — 실제 수치 결과 없음 |

`python -m pytest tests/test_performance_coverage.py -q`, `python -m ruff check …`를 각각 한 번씩
시도했는데, 이 세션 권한 정책이 둘 다 승인 필요로 막았다. 지시대로 다시 시도하지 않았다. 결과가
나오지 않았으므로 이 문서의 통과, 수치 주장은 모두 미검증이다. 테스트는 정적으로만 검토했다.

## 범위와 경계

- 대상: 로컬 CSV 1개. 실제 SHA-256을 `--content-hash`와 비교해 정확한 digest가 다르면 거부한다.
  어댑터의 `sha256:` 접두사는 비교할 때 표현만 정규화한다. 그 뒤 기존
  `OracleElixirCSVAdapter(SourceRegistry.load_default())`가 **수용한** `MatchRecord`만 본다.
- 원본 행 매칭: 정확한 `(league, gameid)` → `oe:{league}:{gameid}`, participantid 1–10.
  선수 이름은 키로 쓰지 않으며 아예 읽지 않는다.
- 연도: `--year`(기본 2026) = `observed_at`의 **UTC 연도**. 다른 연도의 수용 경기는
  `observed_at_utc_year_out_of_scope`로 따로 센다.
- 단일 스냅샷 점검이다. 다른 버전과의 수치 충돌은 살피지도, 해결하지도 않는다.
- 보고서 주장 표식: `NOT_PREGAME_FEATURE_ADMISSION`, `NO_MODEL_EFFECT`, `NO_STRENGTH_INFERENCE`,
  `MISSING_IS_NOT_ZERO`, `OBSERVED_ZERO_IS_VALID`, `UNITS_RAW_NOT_NORMALIZED`,
  `OUTCOME_NOT_READ_AS_METRIC`, `AGGREGATE_COUNTS_ONLY_NO_VALUES_IDS_OR_ROWS`,
  `SINGLE_SNAPSHOT_NO_CROSS_VERSION_RESOLUTION`, `ADAPTER_ACCEPTED_GAMES_ONLY`,
  `NOT_COMPLETE_SEASON_COVERAGE`.
- `result`, `playername`, `teamname`은 원본을 읽을 때 버린다. outcome은 metric이 아니다.
- 학습·예측·능력치·현재 경기 feature 사용을 허용하지 않는다. 기존 CSV/집계 정책을 넓히지 않는다.

## 식별(identity) 규칙

선수행마다 `playerid`·`teamid` 비어 있지 않음, `side` ∈ {Blue, Red}, `position` ∈
{top, jng, mid, bot, sup}이어야 한다. 경기 안에서는 팀(side)마다 역할이 유일하고, 같은 side의
teamid가 하나이며, playerid가 중복되지 않아야 한다. 하나라도 어긋난 행은 모든 metric에서
`identity_unresolved`로 센다. 숫자가 있어도 valid로 세지 않고 0으로 채우지도 않는다.
사유는 `invalid_reason_row_counts`에 행 단위로 남긴다(한 행에 사유가 여러 개일 수 있다).
기존 어댑터는 역할 집합과 팀 ID 일치는 이미 검사하지만 playerid 공백·중복은 검사하지 않는다.
그래서 실제로는 그 두 사유가 주로 나타날 것으로 예상한다.

## metric 규칙 (단위 `RAW_NOT_NORMALIZED`, 환산 없음)

| 분류 | 열 | 규칙 |
| --- | --- | --- |
| 비음수 정수(count) | kills, deaths, assists, total cs, csat15 | 유한, ≥0, 정수값 |
| 비음수 | totalgold, damagetochampions, visionscore, goldat15 | 유한, ≥0 (정수 여부는 문서 근거가 없어 검사 안 함) |
| 부호 | golddiffat15, csdiffat15, xpdiffat15 | 유한, 음수 허용 |
| 경기 상수 | gamelength | 유한, >0, 같은 경기 10행 동일(초/분 해석 안 함) |

분리 집계 상태: `valid` / missing{`blank`, `column_absent`} /
invalid{`nonfinite`(NaN·Infinity·overflow), `unparseable_string`(예: `1,000`, `1_000`, 문자),
`negative_not_allowed`, `non_positive`, `non_integer`, `inconsistent_within_game`} /
`identity_unresolved`. 실제로 관측된 0은 valid이다. 행마다 네 범주를 더하면 기대 선수행 수와
같아야 하며, 어긋나면 도구가 내부 오류로 멈춘다.

gamelength 불일치: 파싱에 성공한 값끼리 서로 다르면 그 행들을 모두 `inconsistent_within_game`으로
센다. 빈 값 1개에 나머지 9개가 같은 경우는 9 valid + 1 blank이다.

## 출력

`overall`, `by_league`, `by_patch` 각각에 다음만 담는다.

- `accepted_games`, `expected_player_rows`(=경기×10)
- `identity`: valid/invalid 행, 사유별 행 수, 10행 모두 식별된 경기 수
- `metrics[열]`: valid, missing(종류별), invalid(종류별), identity_unresolved, 10행 모두 valid인 경기 수
- `metric_groups`(kda/gold/cs/damage/vision/diff_at_15/game_length): 그룹의 모든 열에서 10행이 valid인 경기 수

함께 기록: 소스 해시, byte 길이, 실제 수집시각, 어댑터 발견·수용·거부 수와 거부 코드별 수,
연도 밖·해시 불일치·원본행 불일치 제외 수, 관측 범위(첫/마지막 UTC), 원본에 있거나 없는 metric 열.
값 자체, 선수/팀 ID, match ID, 원본 행, 팀별 성적은 내보내지 않는다.

출력 거부: `web/public`(저장소 경로와 임의의 `web/public` 세그먼트 모두), `outputs/oracles-elixir/`(원본
보관소), 입력과 같은 경로, `.json`이 아닌 경로, 이미 있는 파일(`open("x")`). 입력은 읽기만 하고,
쓰기를 마친 뒤 해시를 다시 확인한다.

## 테스트 범위

합성 단위: 정상 0, 빈 값·열 없음 ≠ 0, signed 음수 허용, 비음수 음수 거부, NaN/Infinity/1e999
거부, 잘못된 문자열, 잘못된 정수, gamelength 0·불일치·한 행 누락, 역할 오류·중복, playerid
공백·중복, teamid 누락·불일치, side 오류, 행 수 합계 불변식, 입력 행 불변.
실제 어댑터 fixture(`tests/fixtures/oracles_elixir_game.csv`에 metric 열 추가): 정상 수용 경기
집계, 어댑터 미수용 경기(`INCOMPLETE_GAME`) 제외, 2025 경기 연도 제외, 어댑터가 수용한 경기의
playerid 중복 검출, 열 없음, `sha256:` 접두 해시 허용, 값·ID·이름·match ID 누출 없음, 입력 바이트 불변,
해시 불일치·web/public·원본 보관소·입력 경로·기존 보고서·timezone 없는 시각 거부.

## 재현 명령

```
python -m pytest tests/test_performance_coverage.py -q
python -m ruff check ops/audit_performance_coverage.py tests/test_performance_coverage.py
python -m ops.audit_performance_coverage \
  --input outputs/oracles-elixir/raw/oracles-elixir-match-data/fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de.csv \
  --retrieved-at 2026-11-11T02:19:29.155420+00:00 \
  --content-hash fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de \
  --output outputs/performance-coverage-2026-fcd2-20261119.json
```

원본 헤더와 실제 실행을 확인했다. 지정한 metric 13개 열이 모두 들어 있다.
fcd2 스냅샷은 수집 시점(2026-11-11)까지만 담고 결승 이후 경기는 없다. 따라서 결과가 나와도
연간 전체 커버리지를 뜻하지 않는다.


## Codex 통합 검증 결과

2026-11-19 기존 로컬 원본 fcd2를 위 명령으로 읽었다. 공급자 요청·학습·배포는 없었다.
원본 팀 행과 선수 팀 ID의 일치는 기존 어댑터가 PLAYER_TEAM_MISMATCH로 거부한다
(src/pro_meta_intelligence/ingestion/oracles_elixir.py). 이 검사를 중복 구현하지 않는다.

- 수용·연도 범위 내 9,262경기, 기대 선수행 92,620개.
- 선수 식별 유효 92,000행, 불가 620행(선수 ID 공백). 10명 모두 식별된 경기 8,874개.
- KDA·피해량·시야·경기 길이가 모두 유효한 경기: 각 8,874개.
- 15분 골드·CS·차이값까지 모두 유효한 경기: 8,861개. 관련 열에 빈 선수행 130개.
- 이 수용 집합에서 수치 형식 오류는 관측되지 않았다. 결측·식별 불가는 오류 없음과 별개다.

| 리그 | 수용 경기 | 식별·KDA 완전 경기 | 15분 차이 완전 경기 |
|---|---:|---:|---:|
| LCK | 502 | 502 | 502 |
| LPL | 548 | 548 | 536 |
| LEC | 383 | 383 | 382 |
| LCS | 283 | 283 | 283 |
| LCP | 286 | 286 | 286 |
| WLDs | 106 | 106 | 106 |
| MSI | 71 | 71 | 71 |
| FST | 45 | 45 | 45 |
| EWC | 232 | 232 | 232 |

표는 주요 리그 일부이며 전체 9,262경기와 합이 같을 필요가 없다.
결과 파일: outputs/performance-coverage-2026-fcd2-20261119.json.
단위 검사 40/40, ruff 검사·포맷 통과. 초기 테스트의 정수 키 kwargs 호출 오류는
테스트 fixture에서 수정했다. 제품 수치 검증 결함으로 세지 않는다.

이는 사전 시점 feature 승인이나 선수 실력·아이템 효과의 근거가 아니다.
다음 단계는 경기 이전 관측만 모으는 별도 연구용 추출기이며, 현재 경기 통계와
실제 과거 수집 가능 시점을 아는 것처럼 섞지 않는다.
