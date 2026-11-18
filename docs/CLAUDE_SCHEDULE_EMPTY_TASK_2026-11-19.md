# 반복 일정 실패 메일 · Claude 수정 작업

Opus 5.5 medium. 이 세션은 Python 일정 파서만 소유한다. 다른 Claude는 웹 여러 세트 복기를 구현 중이므로 웹/공용 문서/package/다른 작업 파일 변경 금지. Codex가 독립 검증한다. 커밋/푸시/배포/추가 네트워크/에이전트/패키지 설치 금지.

실제 최근 메일 대부분은 Refresh official schedule 실패다. run 44356201642 진단을 이미 다운로드했다: `outputs/schedule-diagnostics-44356201642/source-page.html`. 기존 수집 실패는 'schedule page contains no semantic upcoming events'. 실제 HTML은 time 태그 0개이며 렌더링된 section에 `No More Upcoming Matches Available`, `Check back soon to find more matches`가 있다. 스크립트 번역 사전에도 빈 일정 문구가 있으므로 문자열 전체 검색으로 성공 처리하면 안 된다.

목표: 공식 페이지에 명시적으로 렌더링된 정상 빈 일정만 유효한 빈 snapshot(events=())으로 수용. 오류 HTML/로그인/번역 사전만 있음/숨긴 text/불완전 일정카드/과거 이벤트만 필터링된 경우는 기존대로 실패·마지막 스냅샷 보존. 소스 장애를 정상으로 숨기지 않는다.

읽기: `src/pro_meta_intelligence/ingestion/lolesports_schedule.py`, CLI fetch-schedule, tests/test_lolesports_schedule.py, tests/test_cli.py 관련 부분, publishing/health.py 일정 검증. 실제 진단 HTML은 로컬 읽기만.

쓰기 소유: lolesports_schedule.py, NEW tests/test_schedule_empty_state.py, NEW tests/fixtures/lolesports_schedule_empty.html (최소 발췌 재현, 거대한 원본 복사 금지), NEW docs/CLAUDE_SCHEDULE_EMPTY_RESULT_2026-11-19.md. core CLI/health 수정이 꼭 필요하면 이유 보고 후 대기(기존 스키마로 빈 events 가능할 것으로 보임). 실제 일정 request 금지: 소스 간격 아직 안 지남.

기존 parse_schedule_html API/일반 snapshot quality 계약을 유지한다. 정상 명시빈값 events0 snapshot이 CLI/건강검사/웹 parser 계약상 유효한지 테스트로 확인한다. 시간카드가 있는데 파서 실패+끝 footer 빈메시지 조합은 정상빈값으로 받아들이지 않는다. script/style/template/hidden/aria-hidden 등 비표시 텍스트 단독은 증거가 아니다. 명시빈마커와 정상일정카드 동시존재 시 정상카드 우선, 손상카드가있으면 failclosed.

테스트: 실제 최소 재현 empty 페이지 성공, adapter events0 성공, 알 수 없는 빈 HTML/번역 스크립트만/hidden/static text만/손상 카드+endmarker/과거 카드만 실패, 기존 정상 일정 보존, CLI 실제 fake transport 출력빈snapshot·다음경기추정없음(네트워크대역만). 관련 pytest와 ruff를 실행하고 결과 및 남은 한계를 문서화한다. 메일/구독 설정은 바꾸지 않는다.
