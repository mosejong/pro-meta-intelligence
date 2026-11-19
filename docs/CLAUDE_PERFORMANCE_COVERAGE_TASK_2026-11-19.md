# 실제 수치 관측의 유효성·누락 점검

Claude Opus5.5 medium. 다음 실제 모델 준비 단계다. 기존 audit_simulation_features.py는 수치 열이 있어도 기존 수용 경로에서 검증하지 않아 UNSUPPORTED로 표시한다. 그 경로를 바꾸지 말고 별도 로컬 점검 도구로 수치 관측의 누락·형식·일관성만 확인한다. 모델 학습·예측·능력치·현재 경기 feature 사용을 허용하는 도구가 아니다.

소유 신규 ops/audit_performance_coverage.py, 신규 tests/test_performance_coverage.py, docs/PERFORMANCE_COVERAGE_2026-11-19.md. 기존 입수·선수 집계·시뮬레이션 코드/웹/다른 파일 수정 금지. git/network/install/fulltest/browser/subagent 금지.

CLI --input --retrieved-at --content-hash --output 필수. 실제 CSV SHA를 확인하고 기존 OracleElixirCSVAdapter + SourceRegistry로 수용한 MatchRecord만 대상으로 한다. 실제 어댑터 hash는 sha256: 접두사가 있으므로 정확 digest 비교만 정규화한다. raw row 매칭은 정확한 (league, gameid)→oe:league:gameid로 하고 선수 이름을 키로 쓰지 않는다. --year 기본2026은 observed_at UTC 연도로 명시한다. 새로운 공급자 요청/원본 수정 없음.

수용 경기의 player participant 1~10에 대해 stable playerid/teamid, side, 역할이 유효하고 각 팀에 top/jng/mid/bot/sup 5역할이 유일한지 확인한다. identity가 불완전한 관측을 수치 0으로 채우지 않는다. metric은 kills/deaths/assists/totalgold/total cs/damagetochampions/visionscore/goldat15/csat15는 유한 비음수 수치, count 성격은 정수 여부도 검사한다. golddiffat15/csdiffat15/xpdiffat15는 유한 부호 수치로 음수를 허용한다. gamelength는 양수 유한 수치이며 같은 경기 10행이 같아야 한다. 단위는 RAW_NOT_NORMALIZED로 남기고 문서 확인 없는 분/초/실력 환산은 하지 않는다. 빈 값/열 자체 없음/NaN·Infinity/잘못된 문자열/음수 부적합/불일치를 분리 집계한다. 0은 실제 관측이면 유효하다.

전체 및 리그·패치별로 기대 선수행 수, 식별 유효/불가, metric별 valid/missing/invalid, group별 10행 전부 유효한 경기 수만 출력한다. 값 자체·개별 선수 ID·원본 행·팀별 성적은 내보내지 않는다. 단일 스냅샷 점검이며 다른 버전과의 수치 충돌을 해결했다고 주장하지 않는다. 소스 해시/실제 수집시각/범위/수용·제외/NOT_PREGAME_FEATURE_ADMISSION/NO_MODEL_EFFECT/NO_STRENGTH_INFERENCE를 명시한다. outcome/result는 metric이나 feature로 읽지 않는다. web/public 및 원본 파일과 같은 출력 경로는 거부하고 기존 보고서는 덮어쓰지 않는다.

합성 단위와 실제 어댑터 fixture로 정상 0, 누락≠0, signed 음수 허용, NaN/Infinity 거부, 잘못된 정수/역할/중복 ID/경기 길이 불일치, 미수용 경기 제외, 입력 불변/해시 불일치/원본 및 공개 경로 덮어쓰기 거부를 확인한다. 새 단위만 실행 시도하고 승인 거부는 반복하지 말고 부모에 보고한다. 실제 큰 파일 실행은 Codex가 확인한 fcd2 2026 snapshot으로 수행한다. 기존 CSV/집계 정책을 확장하거나 학습 허용을 재해석하지 않는다. 한도 오류면 오류/reset 원문을 기록하고 종료한다. 과금·모델 우회 금지.
