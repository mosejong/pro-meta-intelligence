# 과거 선수 기록 지원 범위 재현 CLI

Opus5.5 medium. 이전 작업을 다시 설계하지 말고 새 세션에서 이 문서, ops/pregame_player_history.py, ops/audit_performance_coverage.py, ops/benchmark_match_baselines.py의 어댑터 호출/clean_records/DEFAULT_CONFIG, tests/test_performance_coverage.py의 fixture helper만 읽는다. 소유 신규 ops/audit_pregame_history_support.py, tests/test_pregame_history_support.py, docs/PREGAME_HISTORY_SUPPORT_CLI_2026-11-19.md 세 파일. 기존 파일/웹 변경 금지. Bash/git/network/tests/subagents 금지(Codex 검사). 결과는 짧게. 한도 오류시 중단·실제 reset 기록, 유료/모델 우회 금지.

목표: Codex가 임시 스크립트로 확인한 실제 878경기 지원 범위 검사를 재현 가능한 CLI로 만들기. 순수 추출기를 재구현하지 말고 extract_player_history를 호출한다. CLI python -m ops.audit_pregame_history_support --input --retrieved-at --content-hash --output 모두 필수. 기존 SourceRegistry/OracleElixirCSVAdapter와 정확 SHA 해시 확인(sha256: 표현 정규화), 실제 retrieved_at timezone 필수. 출력은 aggregate JSON only; 값/선수·팀·match IDs/이름/used_match_ids/개별 추출 결과를 절대 export하지 않는다.

대상은 기존 DEFAULT_CONFIG의 고정2026 observedUTC year, 주요리그, 2026-07-01 이후 탐색용 cohort. clean_records(...expected_hash=...)를 재사용한다. 이 config의 학습/검증 재분할·계수·리그 변경 없음. NO_MODEL_EFFECT, NO_TRAINING, EXPLORATORY_COHORT_NOT_UNTOUCHED_VALIDATION, SIMULATED_AVAILABILITY_24H_NOT_ACTUAL, TARGET_ROSTER_KNOWN_ASSUMPTION, RAW_NOT_NORMALIZED, NO_PUBLICATION 명시. baseline 결과/승률/labels는 계산하지 않는다. 어댑터가 결과를 사용해 수용한 원천과 특성으로 결과를 쓰지 않는 것을 구분.

전체 accepted2026 source 게임 중 raw_player_rows의 정확10 participant 1~10 및 audit_game.identity_valid인 게임만 HistoryObservation 공급. metric 값 유효성/누락은 pure 추출기에서 재사용. game별 gamelength 불일치가 있으면 그 게임의 해당 metric은 invalid로 집계할 수 있게 안전하게 반영(예 raw invalid문자 sentinel 전달은 하지 말고 해당 경기 관측을 보수적으로 공급 제외하고 이유별 count; 임의값 변조 금지). 기존 어댑터가 검사한 team/role 준수. 같은ID 중복 원천관측을 적당히 선택하지 말고 공급/타겟 모두 보수 제외·count한다. 원본헤더에 없는 metric은 metrics mapping에 넣지 말아서 column_absent가 유지되게. 과거 게임은 target cohort 리그만 아니라 모든 수용2026 게임이 후보이며 선수ID+역할+정확 patch로 조회한다. target 자체 식별 불가면 질의하지 않고 target exclusion 카운트에 남긴다. 각 target의10선수 각각 query cutoff=observed_at, target_match_id 정확 ID. 기본max20/min5 지연24h 고정.

전체/리그별 대상경기 수, target식별제외, 질의수, 이전관측0질의수, 이전5경기충족질의수, 10명전원5경기충족경기수, metric별 raw mean 유효(비None)질의수, 13개모두 raw mean 유효질의수, 10명전원13개유효경기수 집계. 입력hash/size/실제수집시각/관측기간/공급게임 제외 사유/cohort scope/파라미터를 보고한다. 비교시 256/878의 선택집합이므로 같은집합 baseline 비교 필요하다는 주석.

출력은 기존파일/입력/원본보관소/web/public/web/dist/web/dist-pages/web/.site-public/web/static-site 및 임의경로 web/public segment 거부. resolve로 symlink escape 막기. .json만 open x로 생성. 원본불변hash 재확인. 호출중 원본이 바뀌면 결과를 성공으로 발표하지 않기.

테스트 최소 fixture CLI 정상(고정범위 맞는 날짜·리그·patch로 여러games 생성), target현재게임과 미래게임 미포함으로 수치값을 보고하지 않아도 지원수검증, min5미달, missingmetric, 식별불가/중복보수제외, emptycohort 명시상태, 해시/기존출력/공개경로/timezone거부, noIDs/means leak, 입력불변. 코드문자열검사/과도한full테스트없음. 실제큰원본 실행은 Codex담당.
