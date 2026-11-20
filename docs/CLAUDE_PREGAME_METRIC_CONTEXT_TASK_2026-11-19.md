# 경기 이전 동일 맥락 지표 위치 — 순수 연구 helper

Claude Opus 5.5 medium 구현/수정, Codex 독립 검증. 신규 ops/pregame_metric_context.py, 신규 tests/test_pregame_metric_context.py, 신규 docs/PREGAME_METRIC_CONTEXT_2026-11-19.md만 소유. 기존 소스 변경 금지. Read/Edit/Write/Glob/Grep만. Bash/명령/테스트/git/network/subagent 금지. 실제 CSV 읽지 말 것.

목적: golddiffat15 하나에 한해, 같은 리그·역할·정확패치에서 경기 이전 과거 기록의 평균이 다른 선수 과거 평균 사이 어느 위치인지 기술하는 로컬 helper. 선수실력/매치승률/교체효과/시대보정/출시feature 아님. 이 지표는 연구사양으로 사전에고정, 성능 보고 선택한것 아님. 값단위공식확인/다른지표합성 없음. 웹·엔진·CLI·학습·기존가드 변화 없음.

최소읽기 ops/pregame_player_history.py(types/extract_player_history), tests/test_pregame_player_history.py fixture. 필요시 audit_performance_coverage classify 의미. 과거 누출/duplicate/window/minimum은 기존 extractor 호출로만 재사용하고 복제하지 않는다.

API 제안: frozen ContextObservation(league:str, observation:HistoryObservation); build_metric_context(observations, query:HistoryQuery, *, league:str, config:HistoryConfig|None=None, minimum_peer_players:int=5)->dict. league 공백·잘못type 거부/모든입력type검증, bool은 정수개수로 받지않음. dataclass 원본 read-only 보존. metric은 golddiffat15 고정. 외부라이브러리 불필요.

기준집단:
1 같은league/role/exactpatch만. targetmatch는 모든선수에서제외. observed_at+config.publication_delay<=query.cutoff만 가능. peer후보를발견하는단계부터이필터 적용: 미래에만나오는선수/현재targetmatch선수는 후보수·결과에도영향없음.
2 본인 playerID는 reference에서제외. 각peer에 동일query(targetmatch/role/patch/cutoff)+그peerID를 만들어 기존extractor 호출. 각선수 latest20(default)/valid5(default), 중복drop/미래revision중복은 기존행동대로.
3 본인 평균 및 peer 각각 valid golddiffat15 >= config.minimum_games+mean_raw가 유한할때만. peer는선수마다 평균1개로 동일가중, 경기수가많아도 표가늘지않음. 본인 부족이면 target_insufficient; 본인충분/validpeer<minimum_peer_players면 peers_insufficient; 위치는 둘다None. 둘다충분이면 descriptive_context_available.
4 위치fraction=(peer_mean<target_mean 수+0.5*같은값수)/validpeer수. tie는 finite arithmetic mean의정확값동등(튜닝tolerance없음). [0,1] 기술값이지 확률이나 실력백분위가아님. 빈참조/0나눔금지. 같음만있으면0.5. 전체peer평균/표준편차fit/z점수/회귀/label/result열 읽지말것.

return localresearch/publicationfalse/claims, metric/status/querycontext(league/role/patch/cutoff; 선수·경기ID 불필요), config/historydelaybasis/knownrosterassumption, target validcount/gamesused/mean_raw(내부연구전용), peer candidatecount/eligiblecount/insufficientcount, less/equal/greater 수/position_fraction(지원일때만, 아니면None), reference_degenerate(지원시 peer평균같음 여부). peer별값·ID리스트는반환하지않음. target mean은출시노출불가, doc명시. config수가id처럼유출안됨. 지원없음이0실력 아님. NO_MODEL_NO_LABELS_NO_OUTCOME, EXACT_LEAGUE_ROLE_PATCH_ONLY, SIMULATED_24H_NOT_ACTUAL_AVAILABILITY(default, config가능), EACH_PEER_EQUAL_WEIGHT, TARGET_PLAYER_EXCLUDED_FROM_REFERENCE, LOCAL_RESEARCH_ONLY_NOT_FOR_EXPORT, NOT_STRENGTH_OR_WINRATE_OR_FEATURE_ADMISSION.

tests: 손으로알수있는평균집단 less/tie/greater, 1인많은경기 vs1인적은경기 동일표(최대/min창유지), target4개 거부/peer4명거부, literal0·signed음수, missing을0미대체, 다른league/role/patch/future/targetmatch 섞어도결과전체동일(후보수포함), 현재targetplayer제외, 정확24h경계, 미래중복이과거지우지않음(통합), 사용가능중복모두drop, 순서불변/원본불변/반환dict변경해도원본불변, invalidtypes, empty reference, peer전부같은평균. 원시수치지표API가연구내부용이므로 publicCLI/serialization저장구현 금지. 테스트에서 기존extractor숫자복사만하지말고 손계산기준도확인. 최소필요검사, commandCodex실행.

완료보고짧게·미실행검사정직히. quota오류실제reset후중단, 모델/계정/유료우회없음.
