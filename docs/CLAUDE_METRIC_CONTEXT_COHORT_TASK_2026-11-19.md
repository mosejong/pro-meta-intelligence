# 동일 맥락 지원 집합의 기준선 CLI — Claude 구현 / Codex 검증

소유 신규 ops/benchmark_metric_context_cohort.py, 신규 tests/test_metric_context_cohort.py, 신규 docs/METRIC_CONTEXT_COHORT_2026-11-19.md만. 기존 제품/모델/상수/추출기/CLI 변경 금지. Claude Opus5.5 medium 구현, Codex 실행·검증. Read/Edit/Write/Glob/Grep만; Bash/테스트/git/network/subagent 금지. 실제fcd2읽지말것.

최소읽기 ops/pregame_metric_context.py, ops/benchmark_supported_history_cohort.py(partition_predictions·assess_cohort·CLI), ops/audit_pregame_history_support.py(_game_issue·_observations·assess_support_with_ids supply/target scope), ops/benchmark_match_baselines.py(DEFAULT_CONFIG·clean_records·simulate·summarize). outputs/verify_pregame_metric_context_20261119.py는 Codex가 이미실행한 연결검증 예시일뿐 수정하지말것.

목적: 이전 순수helper의 지원 집계 재현 + 그 지원/미지원 집합에 기존 팀기준선 채점. 새선수모델/특징효과/정규화/확률출시/튜닝없음. 기존24h공개지연가정/known targetroster/실제retrieved별도 유지. 기존전체878 target 중 all10 context지원198이라는 검증 결과는 참고값이며 코드에하드코딩하거나 결과보고 기준완화하면안됨.

동일sourcehash/어댑터수용records, fixed DEFAULT_CONFIG observedUTC2026/evaluationStartJul1/majorleagues. supply는 기존지원auditor처럼 accepted season year 모든league 후보, duplicate match ID 모두제외, raw player1..10·identity/team/patch 검사와gamelengthconsistent 검사 기존helper재사용. target도기존cohort cleanrecords/evalstart로고정, raw unusable은상태제외집계. scorer전체에는지원안되는경기도유지.

support: league+role preindex는허용하되 PATCH prefilter금지(가용 다른패치중복 제외 동작보존). 각 target10명에 build_metric_context를 기본사양(golddiffat15·max20·valid5·peer5) 그대로호출, 각status/리그별querycounts/targetexclusions/supplycounts/all10available경기수를집계. target/peer means·position값/peer수개별분포/ID·rawrow/label/probability는JSON/로그출력하지않음. sourcehash외식별자는내부결합만. 평가 지원ID집합은함수내부frozenset으로리턴가능하나JSON직렬화안됨. support판정복제금지(기존helper호출). config는fixed DEFAULT_CONFIG 기본; lib테스트가BaselineConfig인자를쓰더라도 임의계수튜닝/CLI옵션노출없음.

baseline: 전체cleanrecords+simulate ONCE. 모든warmup/league타임라인/rating업데이트를원래대로유지. 이미생성된Prediction을기존partition_predictions로 all/supported/not_supported 나누고기존summarize 호출. supported만재학습/다시simulate 금지. all과기존지원집합CLI의all성능동일해야함. 각partition은n/empty상태/기존summary(리그별포함). all=supported+not_supported 정확cover검사, empty기존None보존.

CLI python -m ops.benchmark_metric_context_cohort --input --retrieved-at --content-hash --output required. 기존CLI의policy/adapter/actual timezone/hash/쓰기전후source불변/출력source/rawarchive/published-build/symlink/기존파일거부 재사용. 출력 aggregate/sourcehash/config/기준선전체한번상태/supportcounts/partition summaries/claims해석만.

해석명시: 이미탐색한집합이며공개사전등록/새독립검증아님. subset간성능차이는선택차이이고playerfeature효과아님. support198은기존13raw지표support256과조건다르므로 서로의점수대신쓰면안됨. NO_NEW_PLAYER_MODEL_FIT_OR_TUNING, 기존Elo시간순rating업데이트는유지한것이며NO_TRAINING문구로전부학습없다오해금지. 기존고정0.5/blueLaplace/teamElo만, 제품승률아님. RAW_UNITS_NOT_VERIFIED/NO_UI_OR_SOURCE_FETCH.

tests 최소적정: realadapterfixture로 peer6명/role각5historygames를만드는warmup15경기(3pair×5회) + target1지원/target1새player부족 같은구성을이용할수있음. 독립fulltimeline directsummary필터 reference와같음(지원만refit하면다른상황포함), defaultpeer5지원/미지원/빈집합, target+querycounts exactly회계, oldsourceimmutability/hash/outputguard/IDs·means·position·probability유출없음. fixture성적을얻기위해기준완화금지. 전체웹테스트불필요, Codex가실제원본/관련Python실행.

완료보고짧게, 미실행검사정직히. quota면실제error/reset남기고중단; 모델/유료우회없음.
