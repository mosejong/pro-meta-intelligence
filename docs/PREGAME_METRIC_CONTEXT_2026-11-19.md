# 경기 이전 동일 맥락 지표 위치 (golddiffat15) — 2026-11-19

구현: `ops/pregame_metric_context.py`, 테스트: `tests/test_pregame_metric_context.py`.
기존 소스 변경 없음. 로컬 연구 helper이며 웹·엔진·CLI·학습·저장/직렬화 경로에 연결하지 않는다.

## 무엇인가
한 선수의 경기 이전 `golddiffat15` 과거 평균이, 같은 league·role·정확 patch의 다른 선수
과거 평균들 사이에서 어디 위치하는지를 기술한다. 선수 실력, 매치 승률, 교체 효과, 시대 보정,
출시 feature가 **아니다**. 지표는 이 진단 전에 로컬에서 고정한 연구 사양이며, 이 진단의 성능을
보고 고른 것이 아니다. 공개·외부 사전등록(preregistration)은 **없었다**. 같은 코호트를 이전 로컬
연구에서 이미 탐색했으므로 이 결과는 독립 검증이 아니다.
값은 RAW_NOT_NORMALIZED; 단위·공식 확인이나 다른 지표 합성은 하지 않는다.

## API
- `ContextObservation(league: str, observation: HistoryObservation)` (frozen, 타입 검증)
- `build_metric_context(observations, query, *, league, config=None, minimum_peer_players=5) -> dict`
  - league 공백/주변공백 → ValueError, 비문자열 → TypeError. `minimum_peer_players`는 양의 int
    (bool 거부). 입력 dataclass/리스트는 변경하지 않는다.

## 기준집단 규칙
1. 같은 league만 입력에 남긴 뒤, peer 후보 발견 단계부터 role·정확 patch·target match 제외·
   `observed_at + publication_delay <= cutoff`를 적용한다. 미래에만 있는 선수나 target match에만
   있는 선수는 후보 수와 결과에 영향이 없다.
2. 조회 선수 본인은 reference에서 제외. 각 peer마다 동일 target/role/patch/cutoff + 그 peer ID로
   기존 `extract_player_history`를 호출해 누출·중복·latest 20·minimum 5 동작을 그대로 재사용한다
   (복제하지 않음). 미래 revision은 과거 기록을 지우지 않고, 가용 중복은 모두 drop된다.
3. 본인/peer 평균은 extractor의 `mean_status == "computed"`(valid ≥ minimum_games, 유한 평균)일 때만
   사용. peer는 선수당 평균 1개, 동일 가중.
4. `position_fraction = (peer < target 수 + 0.5 × 정확히 같은 수) / eligible peer 수`.
   동등은 유한 평균의 정확 비교(튜닝 tolerance 없음). [0,1] 기술값이지 확률·실력 백분위가 아니다.
   전체 평균/표준편차/z점수/회귀/label/result 열은 읽거나 계산하지 않는다.

## status
- `target_insufficient`: 본인 평균 없음.
- `peers_insufficient`: 본인 충분, eligible peer < `minimum_peer_players` (0명 포함; 0 나눗셈 없음).
- `descriptive_context_available`: 둘 다 충분.
지원 없음(insufficient)은 0 실력이나 평균 실력이라는 뜻이 아니다. 비지원 시 less/equal/greater,
`position_fraction`, `reference_degenerate`는 모두 None.

## 반환
`local_research_only=True`, `publication_permitted=False`, claims, metric, unit, status,
`query_context`(league/role/patch_id/cutoff — 선수·경기 ID 없음), config(delay 초, maximum/minimum
games, minimum_peer_players), `history_delay_basis`, `known_roster_assumption`,
target(valid_count/games_used/mean_raw), peers(candidate/eligible/insufficient count), position.
peer별 값·ID 리스트는 반환하지 않는다.

**`target.mean_raw`는 내부 연구 전용이며 출시·웹·CLI·파일 export에 노출하면 안 된다.**

Claims: NO_MODEL_NO_LABELS_NO_OUTCOME, EXACT_LEAGUE_ROLE_PATCH_ONLY, EACH_PEER_EQUAL_WEIGHT,
TARGET_PLAYER_EXCLUDED_FROM_REFERENCE, LOCAL_RESEARCH_ONLY_NOT_FOR_EXPORT,
NOT_STRENGTH_OR_WINRATE_OR_FEATURE_ADMISSION, 그리고 delay가 기본 24h이면
SIMULATED_24H_NOT_ACTUAL_AVAILABILITY, 다른 값으로 설정되면
SIMULATED_CONFIGURED_DELAY_NOT_ACTUAL_AVAILABILITY.

## 알려진 한계
- 같은 match/player가 여러 league 태그로 들어오면 요청 league 행만 본다.
- 같은 match_id가 같은 선수·role의 다른 patch 행으로도 있으면 extractor 규칙상 중복으로 모두 drop된다.
- 실제 CSV로 실행하거나 검증하지 않았다.

## 검증 상태
Claude는 명령·테스트를 실행하지 않았다. pytest/ruff/typecheck는 Codex가 실행해야 한다.

## Codex 검증 및 실제 지원 범위

제품·연구 구현/수정은 Claude session 147cf172-59cb-4388-8019-b1a1848acdd4가 담당했다.
Codex는 코드 검토와 독립 tests/test_pregame_metric_context_review.py만 추가했다.
신규·기존 과거기록 관련 **83개 통과**. 독립2개는 가용 다른패치중복의 보수적 제외와 미래자료
추가 시 반환 전체 불변을 검사했다. 최초 관련검사 후 Claude가 설명의 사전등록 과장을 수정했다.
공개/외부 사전등록을 하지 않았으며 이미 탐색한 집합을 새 독립 검증으로 부르지 않는다.

### 실제 보관본 연결

Codex 검증 실행기 outputs/verify_pregame_metric_context_20261119.py를 실제 실행했다.
순수 helper의 raw 평균/위치/선수·경기 ID를 파일로 보내지 않고 **지원 상태 수만** 저장했다:
outputs/pregame-metric-context-support-fcd2-20261119.json. 이 실행기는 outputs 아래 검증용 로컬
산출물이며 신규 제품 CLI가 아니다. fresh clone에 공개한 정식 지원 집계 명령으로 주장하지 않는다.

원본 sha256 fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de,
실제 수집2026-11-11T02:19:29.155420Z. 재요청·원본수정 없음. 원본은 전체 결승/완료 시즌이 아니다.
기존 어댑터·기준선의 동일2026년/7월1일 이후 주요리그878경기, 8,780선수 질의.
고정20경기창·유효5개·참조선수최소5명·경기시각+24시간 가정. 실제 과거 공개시각이 아니다.
기존 supply game 신원 검사와 game-constant 검사 재사용. 조회 로스터는 사전에 알고 있다는 가정이다.
기존 cohort.describe 메타데이터의 Elo계수는 그대로 들어가지만 이번 검증에서 Elo를 실행하거나
모델을 학습·채점하지 않았다.

| 지원 상태 | 선수 질의 수 |
| --- | ---: |
| 기술 비교 가능 | 2,422 |
| 본인 과거 기록 부족 | 5,733 |
| 본인 충분하지만 참조 선수 부족 | 625 |
| 전체 | 8,780 |

10명 전원 기술 비교 가능한 경기는 **198/878 (22.6%)**. 나머지680경기는 미지원이다.
LCK719/LPL358/WLDs270 등의 비교 가능 수는 **선수 질의 수**이며 경기 수가 아니다.
기존 전체리그 과거13지표 지원256경기와는 지표와 참조집단 조건이 달라 단순 성능 증감 비교가 아니다.

### 해석과 다음 관문

새 상대위치 값은 단위·역할·패치·리그 차이를 보정한 선수 능력이 아니다. 같은맥락에 한정해
표현한 기술값이며 참조선수들의 일정·상대강도·표본크기·선수활동중단 차이는 보정하지 않는다.
다수 비지원 결과를 보고 창·최소수·리그/패치 합치기를 몰래 바꾸지 않는다. 확장하려면 별도 사양과
탐색 기록이 필요하다. 이후 모델을 비교할 때는 **같은 지원 경기 집합**의 단순 기준선부터 다시
채점해야 하며 이전256/878 집합 성능을 그대로 대신 쓰지 않는다.
새수집/API/선수효과출시/학습/웹연결/과거선수가드해제/푸시/배포 없음.
