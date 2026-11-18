# Claude 작업 4A · 역사 자료 수집 전 예산 대조

모델 Opus 5.5 medium, 짧은 새 세션. Claude 구현 / Codex 검증. 작업 3의 웹 소스는 Codex 브라우저 검증 중이므로 절대 수정하지 않는다.

## 발견 사실
ops/player_career_archive.py inspect_plan은 로컬 원장/원본의 최신 시각만 본다. 로컬 11/18 00:45 시도 때문에 11/19 00:45에 요청 가능하다고 계획하지만, web/public/feed/current.json import_report에는 서버 11/18 01:35 취득이 있고 collection-status.json에도 네트워크 시도가 있다. 이 두 예산은 같은 공급자 24시간 간격이다. 감사 docs/HISTORICAL_ACQUISITION_AUDIT_2026-11-18.md 참조.

## 소유 파일
ops/player_career_archive.py, tests/test_player_career_archive.py(필요하면 신규 tests/test_career_public_budget.py), docs/CLAUDE_HISTORICAL_BUDGET_GUARD_RESULT_2026-11-18.md. 다른 파일/registry/현재수집workflow/CLI 본체 수정 금지.

## 목표/경계
- 순수 inspect_plan API와 과거 cutoff 기반 build_archive_history는 기본적으로 기존 로컬/시점 의미를 유지한다. 과거 빌드에 최신 공개 기록을 자동 섞어 미래 정보를 누출하지 않는다.
- CLI의 실시간 계획/--fetch-next 경로는 현재 승인 피드와 public collection status에서 확인 가능한 더 늦은 OE 취득/네트워크 시도 시각을 보수적인 하한으로 대조한다. 기본 경로는 web/public/feed/current.json 및 collection-status.json. 테스트용 경로 인자 추가 가능. 실행 직전 다시 검사.
- 외부 예산 입력은 optional 순수 helper/parameter로 분리해 테스트. source_id가 다른 자료·잘못된 JSON/형태/aware시각·미래 시각은 실제 수집 경로에서 fail-closed로 표시하고 fetch CLI 호출 금지. 공개 기록이 없음을 '아무 시도 없음'으로 간주하지 말 것. 명시 --cutoff의 순수 과거 계획/빌드는 실제 네트워크를 여전히 하지 않는다.
- 재사용 캐시(network_request_performed=false)인 실행은 새 네트워크 시도처럼 예산을 계속 연장하지 않는다. 성공한 원본의 실제 retrieved_at 하한은 유지. 실패한 네트워크 요청도 true/unknown이면 보수적으로 처리. bool/string 혼동 금지. started/finished 순서 검증.
- 유효한 하한들과 로컬 원장/원본 중 가장 늦은 시각+기존 registration.minimum_interval_seconds를 사용. can_attempt_now를 외부 기록과 모순되게 내보내지 않는다. 원래 파일 우선순위 2015/2020/2021, 무추적 연도 미확보, 기존 파일 무변경/보고서 덮어쓰기 거부 유지.
- 이것은 공개 기록 기반 보수적 대조일 뿐 분산 락/서버 원장의 대체물이 아니다. 출력·문서에 이를 명시. 새 스케줄러/공급자 요청/원장시각 조작/파일ID/빈도 변경/과거 연도 수집 완료 표시 금지. 이번에는 --fetch-next 실제 실행 금지(단위 테스트에서 stub 호출 확인만).

## 검증
관련 Python 단위 검사+ruff. Windows 아카이브 링크/긴 경로 때문에 짧은 TMP 경로 필요하면 알려라. Codex가 정상 권한·짧은 경로로 독립 검사한다. 관련 케이스: 더 늦은 서버 성공, 실패 요청, 캐시 false, 미래/잘못된 시각/다른 source/파일없음 거부, cutoff 빌드 불변, 실제 fetch delegation이 거부 경로에서 절대 호출 안 됨. 새 패키지 금지.

## 실행 제한
Read/Grep/Glob/Edit/Write + 로컬 Python/ruff 테스트만. 데이터/네트워크/유료전환/다른에이전트/번역/웹코드/삭제/git commit,push,merge,deploy 금지. 한도 오류면 우회하지 말고 중단.
결과 문서에 실제 실행·실패·미지원만 기록. Codex 검사를 Claude가 했다고 쓰지 않는다.
