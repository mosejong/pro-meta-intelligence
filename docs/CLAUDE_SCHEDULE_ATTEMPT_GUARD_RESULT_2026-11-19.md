# 일정 수집 시도 보존 결과 (2026-11-19, Claude)

배경: schedule run 44421845912 (11/19 08:34 KST)는 fetch에 성공했지만 Pages test에서 실패했다.
러너가 사라지면서 원본, 후보, 시도 시각도 함께 사라졌다. 그래서 다음 scheduled run이 6시간 안에
다시 요청할 수 있었다. 테스트 계약(`web/tests/pages-build.test.mjs`)은 Codex가 맡으므로 건드리지 않았다.

## 변경 파일

| 파일 | 내용 |
| --- | --- |
| `src/pro_meta_intelligence/ingestion/lolesports_schedule.py` | `fetch()`에 선택 kwargs `last_attempted_at`, `on_request_started`를 추가했다. 정책 gate → 입력 검증 → `max(last_retrieved_at, last_attempted_at)` 간격 검사를 모두 통과한 뒤, 네트워크 호출 직전에만 콜백을 부른다. 콜백이 예외를 던지면 요청하지 않는다. 기본 동작은 바뀌지 않았다. |
| `src/pro_meta_intelligence/cli.py` (`fetch-schedule`만) | archive root의 `SourceAttemptLedger`(`FETCH_SCHEDULE_HTML`)를 읽는다. 이 시각을 기존 게시 snapshot, archive 시각과 함께 대조한다. ledger가 손상됐거나, 다른 source이거나, 미래(+5분 초과)이거나, 기록할 수 없으면 exit 6 `ATTEMPT_STATE_INVALID`로 끝나며 요청은 0건이다. 요청 직전 원자 기록을 하므로 HTTP 실패, HTML 거부, 이후 빌드 실패에도 예산이 남는다. 실패 출력에는 `request_attempt_recorded_at`이 붙는다. hook이 없는 legacy/테스트 adapter에는 ledger를 간격에 합치고, 호출 전에 보수적으로 기록한다. |
| `ops/schedule_attempt_state.py` (신규) | `pack`과 `restore` 두 명령. |
| `.github/workflows/schedule-refresh.yml` | 복원 → 요청 → pack → state artifact 업로드 → 결과 판정 → (성공 시에만) 빌드, 푸시, 배포. |
| `tests/test_schedule_attempt_state.py` (신규) | 47개 테스트. 네트워크와 GitHub API는 모두 fake다. |

OE ledger, OE 간격, 다른 source, 웹 제품 파일, Codex 소유 테스트는 변경하지 않았다.

## 상태 artifact (`schedule-attempt-state`, 보관 30일, `overwrite: true`)

허용 경로는 정확히 아래뿐이며, 각각 크기 상한이 있다.

- `manifest.json`
- `attempt-ledger.json`
- `candidate/schedule.json` / `candidate/schedule-changes.json`
- `diagnostics/result.json`
- `diagnostics/source-page.html`

manifest에는 repository, workflow path, `head_branch=main`, run_id/attempt, packed_at, ledger 최신 시각,
파일별 sha256/bytes가 들어간다. 원본 raw archive, OE 데이터, 토큰, 키는 넣지 않는다. workflow는
`github.token`과 `actions: read`만 쓴다.

**restore**는 다음 순서로 동작한다.

1. `repos/{repo}/actions/workflows/schedule-refresh.yml/runs?branch=main`에서 run 목록을 받는다.
2. 그중 path, head_branch, event, repository/head_repository(fork 제외)가 모두 일치하는 run만 신뢰한다.
3. 최신 run부터 artifact를 찾는다. artifact의 `workflow_run.id/head_branch`가 어긋나면 거부한다.
4. ZIP은 다음 경우 모두 fail-closed다: 허용 밖 경로(traversal/절대경로 포함), 중복, 링크, 암호화, 크기 초과, CRC 손상, manifest 해시·identity 불일치, 미래 시각.
5. ledger는 운영 ledger reader로 검증한 뒤 로컬 ledger와 max로 병합한다.

다른 run이 in_progress이면 차단한다. API 실패나 비정상 응답은 exit 2이며, 빈 상태로 해석하지 않는다.

**최초 마이그레이션 / 증거 없는 run**: artifact를 가진 run보다 최신인 신뢰 run(완료)에 artifact가 없으면,
그 run의 `updated_at`(완료 시각)을 *가능한 요청의 상한*으로 ledger에 seed한다. 재실행(attempt>1)인
현재 run은 `run_started_at`을 상한으로 쓴다. 보고서에는 `network_performed: "UNKNOWN"`으로 남기고,
요청이 실제로 있었다고 주장하지 않는다. 신뢰 run도 artifact도 없으면 fresh start를 거부한다. 미래 시각이나
해석할 수 없는 시각도 거부한다. 따라서 아직 artifact가 없는 첫 실행에서는 run 44421845912의 완료 시각이
seed되어, 그 후 6시간 안의 요청이 차단된다.

**후보 재사용 범위**: 복원된 후보는 검증 후 `outputs/schedule-state/previous/`에만 보관한다. cooldown에서는
원래 취득 시각 그대로 다음 artifact로 이어 넘긴다(`CARRIED_FORWARD_FROM_RESTORED_STATE`). 공개 경로로
재게시하지 않고, 새로 받았다고 표시하지도 않는다. 재게시는 다음 정책 interval 뒤의 실제 수집을 기다린다.

## Workflow 종료 의미

- fetch step 자체는 실패하지 않고 exit code만 output으로 넘긴다. 그래서 pack(`always() && fetch success`)과
  upload(`always() && pack success`)는 빌드보다 **항상 먼저** 실행된다.
- restore가 실패하면 fetch, pack, upload가 모두 생략된다. 따라서 불완전한 state는 업로드되지 않는다.
- 결과 판정:

  | exit | 의미 | 결과 |
  | --- | --- | --- |
  | 0 | 성공 | `publish=true`, 기존 공개 경로 진행 |
  | 3 | cooldown | `publish=false`, exit 0. 빌드, 푸시, Pages 배포, 시각 재설정 없음 |
  | 4 / 5 / 6 / 기타 | 실패 | 그대로 실패로 남는다. 재요청을 강요하지 않고 예산은 이미 보존돼 있다 |
  | 값 없음 | — | 실패 |

- Pages test, configure/upload-pages, push 단계는 `steps.outcome.outputs.publish == 'true'`일 때만 돌고,
  deploy job은 `needs.refresh.outputs.publish == 'true'`일 때만 돈다. `concurrency: pages`,
  `cancel-in-progress: false`는 유지했다.

## 검증 (로컬, 2026-11-19)

- `ruff check` / `ruff format --check`: 변경한 4개 Python 파일 모두 통과.
- `python -m pytest -q`: **594 passed** (신규 47개 포함, 기존 schedule/CLI/ops 테스트 무수정 통과).
- 신규 테스트가 다루는 것:
  - 성공 → 배포 실패 → 복원 → 6시간 안 요청 0
  - 소스 실패에도 ledger 보존
  - 두 시각 중 max 사용(양방향)
  - 정책 만료, 잘못된 locale/slug, interval 사전차단 시 요청 0, 기록 0
  - 손상, 미래, 다른 source ledger를 CLI가 요청 전에 차단
  - ledger를 쓸 수 없으면 요청하지 않음
  - interval이 지나면 정확히 1회 요청
  - bootstrap이 최근 main run(44421845912) 완료 시각을 반영
  - artifact 없는 최신 run, 재실행 attempt의 상한 반영
  - 만료된 artifact는 run 상한으로 대체
  - 잘못된 ZIP 13종 + CRC 손상 거부
  - 다른 branch/run/workflow/fork artifact 거부, 해당 run은 조회조차 하지 않음
  - API 실패를 빈 상태로 보지 않음
  - workflow step 순서
  - outcome 스크립트를 실제 bash로 실행해 exit/publish 의미 확인(Windows에서는 Git Bash 사용)

## 실제로 실행하지 않은 것 (한계)

- GitHub Actions 실행, 실제 `gh api` 호출, artifact 업로드/다운로드, Pages 배포는 하지 않았다. 모두 stub으로만 검증했다.
- `gh api .../artifacts/{id}/zip`이 blob storage redirect를 따라가 ZIP 바이트를 stdout으로 내보낸다는 가정은 실환경에서 확인하지 않았다.
- `actions/upload-artifact@v7`가 디렉터리 엔트리 없이 파일만 담는다는 가정도 확인하지 않았다(`candidate/`, `diagnostics/` 빈 디렉터리 엔트리는 허용해 둠).
- 첫 실행이 위 두 가정에 어긋나면 fail-closed로 실패하고 요청하지 않는다.
- run 목록은 최신 30개만 본다. 상태 artifact가 30개 run보다 오래되었거나, 오래된 run이 재실행되어 그 페이지 밖에서 늦게 끝나는 경우는 다루지 않는다. 8시간 cron, 보관 30일 기준으로는 정상 운영에서 발생하지 않는다.
- 연속된 restore 실패 등으로 artifact가 없는 run이 생기면, 다음 run은 그 run의 완료 시각을 상한으로 쓴다. 8시간 cron이 6시간 간격보다 길어 정기 실행은 막히지 않지만, 그 사이의 수동 dispatch는 차단될 수 있다(의도된 보수성).
- 브라우저 검사, 웹조회, 키·스케줄·메일 설정 변경, git 커밋, 배포는 하지 않았다.
