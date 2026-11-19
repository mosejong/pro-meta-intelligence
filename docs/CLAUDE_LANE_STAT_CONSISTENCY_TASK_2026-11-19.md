# 15분 지표 경기 내 산술 정합성 — 연구 전용

Claude Opus 5.5 medium 구현/수정, Codex 독립 검증. 범위 신규 ops/audit_lane_stat_consistency.py, 신규 tests/test_lane_stat_consistency.py, 신규 docs/LANE_STAT_CONSISTENCY_2026-11-19.md만. 기존 추출기/제품/registry/adapter/기준선/실험계수 수정 금지. Read/Edit/Write/Glob/Grep만, Bash·명령·테스트·git·network·subagent 금지.

최소 읽기: ops/audit_performance_coverage.py의 raw_player_rows/audit_game/classify_value/audit_snapshot, ops/audit_pregame_history_support.py의 _game_issue와validate_output_path/main(안전한 로컬 CLI), 관련tests fixtures. 실제 fcd2 파일을 읽지 말 것(Codex가 실제 실행).

목적: 원시 숫자가 parse된다는 사실과 지표끼리 일관된다는 사실을 분리. 선수 효과/실력/승률/정규화/새 소스 검증 아님. 상성/스왑을 해석하지 않는다. 아래 관계는 필드명에 따른 진단 가설이며 source 사전에서 정확한 정의를 새로 확인한 것은 아니다. 불일치가 나와도 데이터 오류나 선수 잘못으로 단정하거나 기존관측/지원판정을 바꾸지 않는다.

순수 per-game 진단: 기존 identity 검증을 재사용해 정확히10명/blue-red각역할1명/고유player팀id 확인. 유효하지 않으면 전체 role comparisons를 identity_unresolved로, 누락을 match로 세지 말 것. 기존 audit_game은 행수가10을 보장하지 않을 수 있으므로 누락/과다/중복 역할의 원인을 명시하고 fail closed. 원본 변경 없음.

5 role마다 5관계(총25game slots):
1 golddiffat15 blue + red == 0
2 csdiffat15 blue + red == 0
3 xpdiffat15 blue + red == 0
4 blue goldat15-red goldat15 == blue golddiffat15 이고 반대 방향도동시일치
5 blue csat15-red csat15 == blue csdiffat15 이고 반대 방향도동시일치

classify_value로 의존 rawfield 각각 existing valid/missing/invalid 구분. 관계 상태 상호배타: identity_unresolved / dependency_invalid / dependency_missing / consistent / inconsistent (invalid 우선 missing, 유효한0·음수diff유효). float overflow나 nonfinite 계산은 arithmetic_unavailable로 따로 세며 consistent/inconsistent 아님. tolerance abs1e-6/rel0 고정, 실제 결과 보고 튜닝 금지. 차이 원값/잔차/선수ID/gameID/rawrow/팀별 값 출력 금지. 양방향동시검사. 부호대칭만 맞고 절대값과 모순인 경우 별도 관계 mismatch 검출. gamelength로15분 관측 자격 판정하지 말 것(단위미확인).

aggregate accepted observedUTC year2026 게임만. 동일 gameID 중복/ambiguous row 결합은 existing matcher처럼 failclosed, adapteraccepted matches만. 모든 accepted game의 role5*rule5 슬롯은 상태로정확히회계. overall/by_league/by_patch, 각 rule별 tested/consistent/inconsistent/missing/invalid/unresolved/arithmetic_unavailable count만. gaming scope/정체성 제외 counts 명시. 해시 report 바인딩, IDs출력금지(허용 sourcehash만).

CLI python -m ops.audit_lane_stat_consistency --input --retrieved-at --content-hash --output required. 기존 sourcepolicy/adapter/actual retrieved-at/timezone/hash 검증, 기존 안전한 validate_output_path 재사용. published/build/rawarchive/source/기존출력/symlink 거부. 쓰기전후 source불변. all aggregate no IDs/values/output into web. 실패 보고 덮어쓰기금지. NO_NETWORK/NO_MODEL/RAW_UNITS_NOT_VERIFIED/RELATIONSHIPS_ARE_DIAGNOSTIC_HYPOTHESES/NO_CHANGE_TO_HISTORY_ADMISSION 명시.

의미있는 tests: coherent5roles, sign flipped/비대칭, antisym 맞는데 diff절대값틀림, red쪽만틀림, zero/signed diffs, missing+invalid precedence, absentcolumn, identity missing/duplicates/rowcount, overflow, order invariant/input unchanged, aggregate25slots partition, CLI existing fixture realadapter/hash/source unchanged/output refusal/no identifiers. 실제 모델성능과무관. 단위정의/출시완료 주장금지. 최소 적정 tests만, 전체테스트 실행은Codex.

완료 시 파일·미실행·남은한계 짧게보고. 서비스 한도면 실제오류/reset만남기고중단, 다른모델/유료우회금지.
