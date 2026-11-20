# 같은 평가 집합의 팀 기준선 — 연구 전용

Claude Opus5.5 medium 구현/수정, Codex 검증. 프런트 예시 입력은 구현/검증중이며 이 작업과 파일이 겹치지 않는다. 목적은 과거선수수치가준비된256경기와기존878경기의선택차이를분리하는것이다. 선수모델/학습/승률출시/새원본요청없음.

최소읽기: ops/benchmark_match_baselines.py의DEFAULT_CONFIG,Prediction,clean_records,simulate,summarize와CLI검증; ops/audit_pregame_history_support.py와기존14개테스트의fixture. 필요한경우ops/pregame_player_history.py의publicAPI. 전체웹/기획/대화금지.

소유 기존ops/audit_pregame_history_support.py(같은계산에서지원대상ID를내부적으로받는작은helper분리만, 기존assess_support/CLI JSON의값·스키마유지), 신규ops/benchmark_supported_history_cohort.py, 신규tests/test_supported_history_cohort.py, 신규docs/SUPPORTED_HISTORY_COHORT_2026-11-19.md. 다른제품/기준선계수/registry/수집기/웹/기존단언수정금지. Bash/tests/git/network/subagent금지(Codex실행). 한도오류실제reset기록후중단·유료/모델우회금지.

새 CLI python -m ops.benchmark_supported_history_cohort --input --retrieved-at --content-hash --output 필수. 검증/SourceRegistry/OracleElixirCSVAdapter/SHA(sha256:표현)/timezone/출력보호는기존CLI재사용. source·공개web path·원본보관소·기존출력거부. 쓰기전후원본불변검사. 전체원본의수용레코드만쓴다.

지원집합: 기존지원auditor와동일한모든10선수·정확role/patch·최대20이전경기·각13metric유효5개이상, observed+24h<=target시각, 현재게임제외. 이판정로직복제금지. 기존계산을작은내부helper로분리해 report와 frozenset[supported target match_id]를별도로받게할수있다. IDs는라이브러리의내부연결만허용하고JSON/로그/메타데이터에절대출력하지않는다. 기존assess_support는똑같은집계dict반환·CLI출력값유지. callback로중간row/metric값을유출하지말것.

기준선: DEFAULT_CONFIG의고정2026/Jul1/주요리그, 기존clean_records+simulate를전체시간순서로한번적용. 지원경기만으로Elo를다시맞추거나업데이트/워밍업을제거하면안된다. 이미생성한Prediction의match_id로세그룹 all/support/not_supported를분리하고기존summarize로같은고정0.5/blue Laplace/teamElo를각집합에서채점. 지원/비지원합이all과정확히같고겹침/누락없음검사. 리그별n/Brier/logloss/accuracy와표본·empty명시(기존함수None의미보존)만. output은sourcehash/수집시각/관측범위/config/support집계/partition성능의aggregate만. ID/값/선수·팀별성적/개별확률/labels출력없음.

주장명시: EXPLORATORY_ALREADY_SEEN_COHORT, SIMULATED_24H_NOT_ACTUAL_AVAILABILITY, TARGET_ROSTER_KNOWN_ASSUMPTION, HISTORY_GATE_NOT_FEATURE_ADMISSION, NO_PLAYER_OR_CHAMPION_EFFECT, NO_UI_NO_TRAINING_NO_SOURCE_FETCH, NOT_CAUSAL_EFFECT_OR_RELEASED_WINRATE. 지원집합의기준선이전체보다좋아져도playerfeature덕분이아니라선택된집합차이임을설명. 같은집합을향후모델비교바닥으로쓸수는있지만새독립검증으로부르면안된다. 파라미터튜닝/최적화없음.

단위: 실제adapter fixture생성으로supported/unsupported/empty 분리, clean전체prediction을필터해구한reference summary와같음(전체업데이트순서유지), 지원없음None/빈cohort정직표시, 입력불변/hash/timezone/output거부, JSON에sourceid외개별IDs/means/probabilities유출없음, 지원auditor기존dict동일성(기존테스트도Codex가돌림). 구현문자열/자기구현복사테스트금지. 최소테스트만. 큰fcd2실행은Codex가한다. docs에는코드·가정·미실행만짧게.
