# C2 연간 선수 관측 자료 연결 — 결과 (2026-11-17)

## 원본 범위
- 원본: 보관 승인 CSV `fcd2e451…944de.csv`. meta 기준 원취득 시각 2026-11-11T02:19:29.155420+00:00(새 취득으로 바꾸지 않음).
- 참조 로스터: `web/public/feed/current.json`(cutoff 2026-11-14T00:19:10Z, patch 16.20, 출처 `sha256:80dbfab…`).
  roster_basis는 웹 `rosterBasis()`와 같은 형식이며 cutoff·패치·fixture_only·source_versions가 정확히 일치해야 함.
- 집계 대상: 정규 adapter(원정책 gate)를 통과한 유효 경기의 PICK만. 2026년(UTC), match·event 양쪽 observed_at/available_at ≤ cutoff.
  11/11 취득 이후 경기·결승은 포함되지 않으며, UI에 "현재 스냅샷 기준보다 오래된 원본"으로 표시.
- 원본 파일 전체 accepted/rejected 경기 수는 파일 전체 통계로만 표시(선수별 누락률 아님).

## 누락·제외 규칙
- 신원은 (원팀 ID, 선수 ID) 정확 일치만. 이름 매칭·다른 팀 합산 없음. `name:` 대체 ID는 `UNSUPPORTED_ID`(미확인).
- 시즌 밖/기준 이후 경기, 충돌하는 중복 match/event ID, 한 경기 한 선수에 서로 다른 픽 2개 이상은 제외하고 `import_summary.excluded`에 개수만 기록.
  같은 픽의 동일 중복은 한 번만 셈.
- 역할은 이벤트의 실제 역할. 연간 전체 / 최근 최대 20경기(선수·원팀·역할별 최신 고유 경기) / 참조 패치 일치 세 범위와 패치·리그별 표본·기간.
  챔프 목록은 자르지 않음. 각 범위의 경기 수 = 챔프 횟수 합.
- 공개 파일은 집계만 포함(원시 행·경기 목록 없음). 챔프당 예시 이벤트 ID 최대 3개(연간 범위만).

## 생성 크기 — Codex가 생성·독립 대조 완료
- Claude 세션의 생성 명령은 해당 세션 권한 때문에 실행되지 않았다. 이후 Codex가
  `python ops/build_player_season_history.py --season 2026`으로 검증된 보관 원본만 처리했다.
- 산출물 `web/public/history/player-season-2026.json`: 1,126,532 bytes, 219/219 참조 프로필 연결.
  원본 유효 9,262경기, 제외 642경기. 대상 선수의 고유 경기 3,235개, 픽 20,099개를 관측했다.
- 별도 집계로 219프로필의 역할·범위 678개와 패치/리그 분해를 모두 대조해 일치했다.
  상위 4개를 넘는 역할 기록은 218개다. 이전에 skip됐던 실제 파일 검사도 통과했다.
- 명령은 meta의 파일명·바이트·SHA-256 검증 → 취득 시각 ≤ 로스터 cutoff 확인 → adapter → 임시 파일 작성·재검증 → 교체. 실패 시 기존 파일 보존. 네트워크 없음.

## 실제 실행한 검사
- Python: `pytest tests/test_player_season.py` 8개 통과(시점 누출, 연도 경계, 역할·패치·리그 분리, 동명이인, 이적 팀 구분, 중복, 최근20, 무표본, ops 해시 불일치·미래 취득 시 기존 파일 보존)
  + 관련 `test_draft_scout/test_scout_refresh/test_oracles_elixir` 포함 30개 통과. `ruff check` 통과. mypy는 승인 필요로 미실행.
- 웹: 타입체크·린트 통과. `npm --prefix web run test` 116 통과/1 skip(위 실제 자료). `test:pages` 4 통과.
- 실제 Chrome E2E(desktop 1440, mobile 390): `player-season.spec.mjs` 6/6 통과 — 펼치기 전 요청 0, 범위 변경, 선수 교체·역할 이동(0경기 vs 미확인),
  밴/되돌리기, 원관측 복원, 404·basis 불일치 시 로스터·밴픽·스냅샷 근거 유지, 닫기·팀 교체 중 늦은 응답 차단, 가로 넘침·콘솔 오류 없음.
  E2E의 연간 파일은 현재 feed basis로 만든 **합성 fixture**(route)이며 실제 자료가 아님.
- 회귀: `player-pool.spec.mjs`, `roster-workshop.spec.mjs` 8/8 통과.

## 변경 파일
- 새: `src/pro_meta_intelligence/opponent/player_season.py`, `ops/build_player_season_history.py`, `tests/test_player_season.py`,
  `web/app/player-season-history.ts`, `web/app/player-season-panel.tsx`, `web/tests/player-season-history.test.mjs`, `web/tests/e2e/player-season.spec.mjs`.
- 수정: `web/app/player-pool-panel.tsx`(선택적 연간 섹션), `web/app/roster-workshop.tsx`·`web/app/draft-lab.tsx`(publicationRoot 전달),
  `web/app/roster-workshop.css`, `web/prepare-public.ts`(파생 JSON allowlist), `.gitignore`(history 폴더는 해당 JSON만 예외), `web/package.json`(단위 검사 연결).
- draft/A·B/roster 파일 버전, 추천 점수, cli.py는 변경하지 않음. 커밋·푸시·배포 안 함.

## Codex 최종 검토

- 원본 취득 이후 경기·시즌 밖 날짜·역전된 기간·미래 패치 분해·출처 토큰 불일치가
  파서를 통과하는 반례 5종을 발견하고 모두 거부하도록 고쳤다. 최근20/패치 부분집합,
  안전한 정수·중복 별칭·선수 수·파일 전체 합계도 검사한다. 회귀 변형 12개를 추가했다.
- 동등한 `Z`/`+00:00` cutoff 표기를 보존하는 Python 검사 추가. 모바일에서 연간 선택
  근거 예시를 펼칠 수 있고, 실패 시 다시 불러오기를 제공한다. 원시 행은 공개하지 않는다.
- Python 전체 312/312, 웹 전체 118/118(0 skip), Pages 4/4, 타입·린트·ruff 검사/포맷 통과.
  최초 Python 검사 311/312는 Windows의 긴 임시 경로에서 실패했으며, 제품 코드를
  바꾸지 않고 짧은 새 임시 경로에서 전체 재검사해 312/312를 확인했다.
- 실제 파일을 직접 읽는 PC/모바일 검사를 포함한 연간 UI 8/8 통과(단일 실행).
  세부 근거는 `PLAYER_SEASON_REVIEW_2026-11-17.md`를 따른다.
- 후속 작업에서 기존 피드 갱신 workflow에 연간 생성을 연결하는 코드를 완료했다.
  `PLAYER_SEASON_REFRESH_RESULT.md`를 따른다. 서버 반영은 아직이며, 참조 피드가 바뀌고
  재생성에 실패하면 basis 불일치로 연간 표시만 비활성화된다.
  이번 배치는 로컬 구현이며 새로운 머지·배포는 하지 않았다.
