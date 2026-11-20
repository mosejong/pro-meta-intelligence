# 경기 이전 선수 관측 추출 — 연구 전용

Claude Opus 5.5 medium. 작고 독립적인 순수 Python 모듈 하나만 구현한다. 전체 대화/기획/저장소를 읽지 말고 이 문서와 ops/audit_performance_coverage.py, tests/test_performance_coverage.py, 필요한 타입만 읽는다. 도구 호출은 관련 파일 읽기/편집만. git/network/Bash/install/fulltest/subagent 금지. Codex가 검사한다. 한도 오류면 재호출·유료/모델 우회 없이 종료하고 실제 reset을 기록한다.

소유 신규 ops/pregame_player_history.py, tests/test_pregame_player_history.py, docs/PREGAME_PLAYER_HISTORY_2026-11-19.md 세 파일만. 기존 파일 수정 금지. 웹/모델/소스 수집/출시/CLI는 이번 범위 아님.

목적: 나중의 경기 예측 연구에 필요한 과거 선수 관측을 시간 누출 없이 모으는 순수 추출기. 현재 경기의 결과·통계는 절대로 사용하지 않는다. 실제 사전 수집 가용성 재현이 아니라 observed_at + 고정 24h 공개 지연 가정임을 명확히 한다. 실제 snapshot retrieved_at은 별도 provenance이며 과거시각으로 위장하지 않는다. 현재 경기 roster는 호출자가 지정한 가정(known_target_roster_assumption)이며 과거에 미리 알았다고 주장하지 않는다.

API는 명확한 frozen dataclass로 HistoryObservation(match_id, player_id, role, patch_id, observed_at, metrics)와 HistoryQuery(target_match_id, player_id, role, patch_id, cutoff), HistoryConfig(publication_delay=24h, maximum_games=20, minimum_games=5). extract_player_history(observations, query, config=...) returns structured record/dict. 값은 RAW_NOT_NORMALIZED이며 선수 실력/승률/분초 환산 없음. 지원 role은 기존 top/jng/mid/bot/sup, metric은 audit_performance_coverage.METRICS와 classify_value 재사용. metrics raw strings/None only; 누락/invalid를0으로 메우지 않는다.

기본 규칙: timezone-aware 시각만; 지연 strictly positive; limits positive integers/bool 거부, min<=max. 불명 ID/role/patch 거부. 같은 player_id+role+정확 patch_id만. target_match_id 완전 제외. observed_at+delay <= cutoff인 관측만. cutoff equality 포함, observed equality의 현재 게임은 target ID로 제외. 입력 순서 무관하게 (observed_at, match_id)로 정렬해 최신20게임 선택. 같은 player+role+match_id 관측이 둘 이상이면 내용 동일해도 모두 제외하고 duplicate_match 수로 보고(원본 중복/수정 우선순위 추측 금지). 다른 선수/역할 중복은 해당 query에 영향 없게. 각 metric별 valid_count, missing_count, invalid_count, mean_raw(유효 최소5개일 때만, 아니면 None) 산출. sample count 미달 여부 별도. 무한/overflow 평균 결과는 None+명시사유(안전한 평균 사용). 누락 키는 column_absent, explicit None은 blank로 구분. 관측값 literal0 유효. 출력의 사용 관측 match_id와 latest simulated available timestamp를 남겨 누출 검사 가능하게 하되 이 객체는 로컬 연구용이며 공개파일/웹으로 export하지 않는다. 입력 객체/목록 불변. 기본20/min5 파라미터는 이 추출기의 연구 사양이지 성능으로 선택한 것이 아님.

테스트: 현재게임 제외, 미래 제외, 24h 경계, 같은시각 서로다른게임 지연 준수, role/patch/player 분리, 입력역순 동일, 최신20선택, 중복관측 두개 다 제외, 빈값/컬럼없음/invalid/zero, 최소표본, naive/timezone offset, invalid config/identity, 매우큰 유한 수치, 입력불변. 기대값 위주로 작성하고 코드 문자열 검사 금지. no model training/outcome/labels.

문서에는 가정/범위/미검증을 짧게 남기고 작성 결과만 보고한다. 실제 테스트를 돌리지 않았다면 통과로 쓰지 않는다. 답변은 파일/주요결정/미실행만 짧게.
