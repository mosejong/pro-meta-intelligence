# Claude Opus 5.5 medium 인수인계

## 사용자 지시와 현재 상태

- 사용자는 Codex 사용량을 취업 준비에 우선 쓰고, 이 프로젝트 구현은 Claude에 맡기기로 했다.
- Codex의 개발과 하위 에이전트 작업은 중단했다. 실행 중인 하위 작업은 없다.
- 같은 작업 폴더의 미커밋 변경을 그대로 이어받는다. 초기화·덮어쓰기하지 않는다.
- 저장소: `C:\Users\user\Desktop\project\pro-meta-intelligence`
- 확인한 브랜치: `feat/season-scout-exchange`
- 확인한 로컬 HEAD: `a2831200313b96eb816a88ef687ad57043f045a6`
- 이전 PR #111은 원격에서 머지·배포됐지만, 이후 작업은 로컬 미커밋 상태다.
  로컬 HEAD를 현재 배포 버전이라고 가정하지 말고 원격 상태를 확인한다.
- 답변은 쉬운 한국어. 반복 승인 요청 대신 승인 범위에서 구현·검증한다.
  이번 인계는 새 머지·배포 지시가 아니므로 완료 후 변경을 보고한다.

## 제품 목표

상대의 올해 전체 선수 성향과 최근·포지션 메타를 근거로 밴·오픈·선점을 검토하는 도구다.
경기 승률, 감독의 의도, 챔피언 숙련도나 비공개 연습 정보를 추정해 사실로 표시하지 않는다.
실제 코칭 의사결정에 유용한지를 입증하고 싶지만 **현재 효용 입증 전**이다.

## 최우선: 사용자가 전달한 평가 감사 반영

사용자가 Claude의 읽기 전용 감사 결과를 전달했다. 현재 사람 평가 설계로는
`PILOT_CRITERIA_MET`가 나와도 신뢰하기 어렵다. 구현 전 감사 범위와 실제 코드를 재확인한다.

높은 우선순위:

1. **같은 팩의 조건 간 기억 누출**: 7팀 × 5포지션 사례에 팩 전체 evidence/aids가
   중복된다. 분석가가 동일 팀 자료를 사용·미사용 양쪽에서 보게 된다.
   팀 단위 조건 배정으로 바꾸고 집계 단위도 팀으로 맞춘다. 사례 ID만 다르면
   독립 사례라고 가정하지 않는다.
2. **인용 경로로 조건 노출**: `levers.*` 같은 참조가 채점자에게 전달된다.
   공통 원천 evidence의 참조로 제한하거나 중립적인 근거 ID로 변환하고,
   실제 경로와 내용의 연결을 검증한다. 숨긴 조건을 자료 경로로 노출하지 않는다.
3. **응답·채점 동결 누락**: protocol만 해시 검증한다. blind 시점에 시간까지 포함한
   응답 해시를 고정하고 evaluate에서 확인한다. 채점 해시도 보고서에 남긴다.
   기존 동결 자료는 덮어쓰지 말고 수정된 절차는 새 버전으로 만든다.

함께 해결하거나 명시할 항목:

4. 기준 시점과 수집 시점을 구분한다. 11/11 팩에는 종료된 KC·BLG전이 들어 있다.
   과거 경기 사전 평가에는 해당 경기 전 실제 보관 자료만 사용한다. 현재 자료를
   날짜만 바꿔 미래 정보가 없는 자료처럼 쓰지 않는다. 회고 가상 사례라면 그렇게 명시한다.
5. 품질 평균 차이 ≥0만으로 신뢰할 수 있는 비열등성을 주장하지 않는다.
   품질 유지 목표와 개선 목표를 구분하고 작은 팀·참가자 표본의 불확실성을 보고한다.
   검증 결과를 보고 통과 기준을 바꾸지 않는다. 신뢰구간을 넣어도 작은 표본을
   확증 연구로 승격하지 않는다.
6. 금지·확정 픽·이전 게임 피어리스 잠금·준비 미확인을 공통 사례 상태에 넣고,
   중대한 오류를 양 조건 모두 집계한다. 없는 상태를 임의로 확정하지 않는다.
7. 참가자·채점자 ID를 사전 고정하고 채점 불일치를 보고한다. ID 검사만으로
   실제 사람의 독립성을 인증할 수 없다는 한계는 남긴다.
8. git HEAD, dirty 여부와 실제 평가한 코드·자료 해시를 자동 기록한다.
9. 유리한 실행만 골라 공개할 수 있다는 한계, 외부 사전등록 필요성을 유지한다.
10. 채점자에게 배정표·study 전체·시간·조건 복원 정보를 주지 않는다.
11. 조건별 수가 조금 다른 점과 같은 팀·같은 참가자 내 상관을 명시한다.

대상 파일:

- `src/pro_meta_intelligence/ai_validation/utility_study.py`
- `ops/draft_utility_study.py`
- `tests/test_utility_study.py`
- `docs/DRAFT_UTILITY_PILOT.md`

위 파일은 모두 이번 작업의 미커밋 신규 파일이다. 사용자 감사는 자동 테스트가
아니며 실제 수정·회귀 검증이 아직 필요하다.

## 이번에 실행한 멀티에이전트 평가

분석 에이전트 4개 × 7사례 = 28응답, 별도 채점 에이전트 2개 = 56채점.
KC SUPPORT, BLG MID, GEN JUNGLE, DK TOP, TES BOTTOM, IG SUPPORT, LYON MID.
각 사례는 사용 2·미사용 2. 일부 사례의 최상위 후보를 사용 불가로 설정했다.
우리 준비 상태 UNKNOWN, 현재 OWN_BAN인 가상 상황이다.

- 사용 평균: **3.940476/4**, 미사용 평균: **3.916667/4**.
- 중대한 오류 판정: 양 조건 모두 0, 채점자 간 중대 오류 판정 불일치 0.
- 두 채점자의 평균이 만점인 응답: 사용 11/14, 미사용 9/14.
- 사례별 사용 우세 2, 열세 1, 동점 4. 시간 비교 안 함.
- 추가 효용을 입증하지 못했다. 점수의 만점 집중과 쉬운 사례·채점 기준이 한계다.
- 같은 계열 모델, 지시 수준의 파일 분리, 인용·문체를 통한 조건 노출 가능성이 있다.
  인간 검증·독립 외부 검증이라고 부르지 않는다. 사람 평가 보고서는 갱신하지 않았다.

구현: `ops/agent_utility_dry_run.py`, `tests/test_agent_utility_dry_run.py`.
설명: `docs/DRAFT_AGENT_REHEARSAL_2026-11-11.md`.
자료·답변·채점·집계는 무시 경로 `outputs/agent-utility-20261111/`에 있다.
`report.json`, `blind-packet.json`, `judge-1-ratings.json`, `judge-2-ratings.json`으로
결과를 추적할 수 있다. 원본 manifest와 참가자 입력은 평가 자료이며 수정하지 않는다.
현재 agent script는 별도의 드라이런이며 사람 평가 설계를 고친 것으로 간주하지 않는다.

사람 평가 기존 동결본: `outputs/utility-20261111/study.json`과 `report-pending.json`.
이 동결본은 감사에서 지적된 구버전이다. 수정본은 새로운 경로·버전으로 생성한다.

## 멀티에이전트가 찾고 수정한 제품 문제

읽기 전용 제품 검토 후 아래 세 파일만 수정했다. 다른 기존 dirty 변경을 보존했다.

- `web/app/draft-exchange.ts`
- `web/app/draft-exchange-panel.tsx`
- `web/tests/draft-exchange.test.mjs`

수정 내용:

- 이미 픽한 챔피언과 그 챔피언의 역사적 포지션 준비 확인을 구분한다.
  `committed`와 `rolePrepared`를 별도로 표시하고 역할 배정을 추론하지 않는다.
- `ownPreparationOptions`가 최근 공개 선수 풀뿐 아니라 근거 경기 ID가 있는 우리 팀
  실제 관측 조합의 역할별 카드까지 제공한다. 준비 체크는 여전히 사용자 수동 입력이다.
- truncated pool 밖 Kai'Sa BOTTOM + Olaf TOP 관측 기록과, 이미 고른 flex 챔피언의
  역할 미확인 사례를 회귀 테스트에 추가했다.

완료 검증: web에서 직접 node 두 테스트 파일 27개 통과, draft-exchange 단독 최종
재실행 3개 통과, typecheck 통과, 수정 파일 ESLint 통과, diff 공백 검사 통과.
이 수정 이후 전체 프로덕션 빌드·브라우저 조작 검증은 아직 하지 않았다.

## 앞서 구현된 다른 미배포 변경도 보존

- `ops/refresh_draft_scouts.py`, `tests/test_scout_refresh.py`:
  feed가 승인한 정확한 CSV hash/retrieved_at으로 7팩을 만들고 새 cutoff의 역행을 막는다.
  전체 생성 성공 후 교체한다. 원본 재수집 없이 로컬 archive를 사용한다.
- `.github/workflows/hosted-oe-sync.yml`, `tests/test_ops_scripts.py`:
  sync-health 성공 후 빌드 전에 스카우팅 갱신, 공개 허용 경로 7개만 추가했다.
- `src/pro_meta_intelligence/opponent/draft_scout.py`:
  관측 2챔피언 조합, 맞대결 상대 1페이즈 밴 집계 추가. 승률·상성 모델이 아니다.
- `web/app/draft-scout.ts`, `draft-scout-panel.tsx`, 7팩, 관련 tests:
  맞대결 밴·조합 표시와 11/11 자료 갱신. 과거 validation은 새로운 성능으로 표시하지 않는다.
- `docs/SCOUT_REFRESH_AND_CONTEXT_2026-11-11.md`,
  `docs/T1_BLG_POSTMATCH_2026-11-11.md`, `ops/evaluate_frozen_blg_series.py`도 참고한다.
  마지막 스크립트는 현재 사후 팩을 입력하면 사전 평가 가드에 막힐 수 있다.
  재실행할 때 사전 동결 팩 경로를 명시하도록 개선해야 한다.

## 자료와 정책

최신 CSV는 `outputs/oracles-elixir/raw/oracles-elixir-match-data/` 아래
`fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de.csv`.
수집 시점 `2026-11-11T02:19:29.155420+00:00`.
상세 수집 결과 `outputs/matchday-fetch-20261111.json`.
이전 팩 `outputs/frozen-scouting-before-20261111/`에 보관.

새 수집 없이 현재 파일로 작업한다. OE 하루 1회 제한을 우회하지 않는다.
원본 CSV·개인 응답·참가자 정보는 공개 커밋·Pages 배포 금지.
Riot Web API는 REVIEW_REQUIRED 상태를 유지한다. 솔로랭크 실명 계정 추적,
비공개 스크림, 감독 기록의 새 출처는 승인 없이 추가하지 않는다.

## 검증 상태와 다음 순서

최근 Python 전체 검증: **272 passed**. Windows 제한 환경의 `os.link` 권한으로
35개가 실패했으나 일반 권한과 짧은 임시 경로로 재실행해 모두 통과했다.
권한 실패 때문에 보관 코드의 불변성 기능을 느슨하게 바꾸지 않는다.
추가한 agent script와 test Ruff 통과. 앞 절의 web 결과는 범위 한정 검증이다.

1. git status와 이 문서, 사용자 감사 원문을 읽고 기존 변경을 구분한다.
2. 사람 평가의 높은 우선순위 3개부터 수정하고 회귀 테스트를 추가한다.
3. 시점·상황·채점자·빌드 고정과 집계 한계를 함께 반영한다.
4. 더 어려운 반례 중심 에이전트 재검증을 새 실행으로 남긴다. 과거 점수를 덮어쓰지 않는다.
5. Python/Ruff와 web typecheck/lint/test/test:pages 중 변경에 필요한 검증을 실행한다.
6. 무엇이 입증됐고 무엇이 아직 아닌지 한국어로 보고한다. 미승인 배포는 하지 않는다.

기존 테스트 명령:

```powershell
python -m pytest -q --basetemp="$env:TEMP/pmi-claude-handoff-NEW_RUN"
python -m ruff check src tests
python -m ruff format --check src tests
# web 폴더에서
npm run typecheck
npm run lint
npm test
npm run test:pages
```

새 ops 파일도 개별 Ruff 검사한다. 테스트 임시 경로는 매 실행 새로 쓰고,
기존 원본·동결 자료를 재귀 삭제하지 않는다. 인계 시점 이후 Codex의 추가 개발은 없다.
