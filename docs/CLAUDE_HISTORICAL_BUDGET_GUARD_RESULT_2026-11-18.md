# 작업 4A 결과 · 역사 자료 수집 전 공개 기록 예산 대조 · 2026-11-18

구현: Claude (Opus 5.5). 독립 검증은 Codex 몫이며 아래에는 Claude가 실제로 실행한 것만 적는다.

## 변경 파일

- `ops/player_career_archive.py`
- `tests/test_career_public_budget.py` (신규)
- 이 문서

웹 소스, registry, 현재 수집 workflow, CLI 본체(`pro_meta_intelligence.cli`)는 수정하지 않았다.

## 동작

- **순수 helper** `public_budget_floor(feed, status, *, now, source_id, ...)`와 파일 로더 `load_public_budget(feed_path, status_path, *, now)`.
  - feed: `input.import_report.source_id`가 같아야 하고, `retrieved_at`(aware, ≤ now)를 하한으로 쓴다.
  - collection-status: `artifact_type == "oe-collection-status"`, `source.source_id`가 같아야 한다. `last_attempt.started_at`/`finished_at`는 aware, ≤ now, finished ≥ started여야 한다.
  - `network_request_performed`: 정확히 `False`(캐시 재사용)면 시도 시각으로 예산을 연장하지 않는다. `True`이거나 키가 없거나 `null`(unknown)이면 실패한 실행이라도 `finished_at`을 하한으로 쓴다. bool이 아닌 값(`"true"`, `"false"`, `0` 등)은 거부한다.
  - `source.next_attempt_at`이 있고 aware이면 "not before" 제약으로 사용한다. 형식이 잘못되면 거부한다.
  - 파일 없음, 읽기 실패, 잘못된 JSON·형태, 다른 source, naive/잘못된/미래 시각, 순서 역전, last_attempt 없음은 모두 `issues`에 기록된다. 하나라도 있으면 fail-closed로 처리한다. 공개 기록이 없다고 해서 시도가 없었다고 보지 않는다.
- `inspect_plan(..., external_budget=None)`: 기본값(None)은 기존 로컬/시점 의미를 그대로 유지한다. 값이 주어지면 다음 시각을 `max(로컬 원장, 로컬 원본, 공개 하한) + registration.minimum_interval_seconds`와 `next_attempt_at` 중 늦은 쪽으로 정한다. issue가 있으면 `can_attempt_now=false`, `next_attempt_at=null`, `public_budget_check.status="BLOCKED"`. 출력의 `public_budget_check.boundary`에 "분산 락/서버 원장의 대체물이 아님"을 적었다.
- `build_archive_history`는 변경하지 않았다. 외부 기록을 넘기지 않으므로 과거 cutoff 빌드에 최신 공개 기록이 섞이지 않는다.
- CLI
  - `--public-feed`, `--public-collection-status` 인자를 추가했다. 기본값은 `web/public/feed/current.json`, `collection-status.json`.
  - `--cutoff` 없는 계획 출력과 `--fetch-next`는 공개 기록을 대조한다. `--fetch-next`는 위임 직전에 실제 시각과 공개 파일을 다시 읽어 재검사한다. 재검사에서 막히거나 연도가 바뀌면 exit 3을 반환하고 위임하지 않는다. 보고서 덮어쓰기 거부는 첫 검사보다 앞으로 옮겼다.
  - `--cutoff`가 있는 계획/빌드는 공개 파일을 읽지 않고, 네트워크를 쓰지 않으며, `--fetch-next`와 함께 쓰면 기존처럼 오류가 난다.
  - 시험을 위해 `main(argv=None)`을 받게 했다. 인자 없이 호출하면 기존과 똑같이 동작한다.
- 우선순위(2015/2020/2021 → 나머지 역순), 무추적 연도 NOT_DOWNLOADED, 파일 ID·빈도·registry는 그대로다.

## 실제 실행

- `python -m pytest -q tests/test_career_public_budget.py tests/test_player_career_archive.py tests/test_fetch_oe_history.py tests/test_player_career.py -p no:cacheprovider`: **64 passed**.
- `python -m ruff check`(변경 파일 2개 + 기존 archive 테스트): 통과. `ruff format`은 소유 파일 2개에만 적용했다.
- 실제 공개 파일에 순수 helper만 읽기 전용으로 실행했다(네트워크·쓰기 없음). 결과는 issues `[]`, floor `2026-11-18T01:38:17.542679+00:00`, next_attempt_at 제약 없음이다. 따라서 계획상 다음 시각은 2026-11-19T01:38:17.542679Z로 계산되고, 이는 감사 문서의 보수적 하한과 같다.
- 테스트가 다루는 경우: 더 늦은 서버 성공, 실패/unknown 네트워크, 캐시 false, 공개 next_attempt_at, 미래·naive·잘못된 시각, 다른 source, bool이 아닌 플래그, 순서 역전, 형태 오류, 파일 없음/잘못된 JSON, cutoff 계획 오프라인 유지와 덮어쓰기 거부, 거부 경로 5종에서 fetch 위임 0회(stub), 정상 경로 위임 1회(stub, 2015), 위임 직전 재검사에서 차단.
- 시험 중 짧은 TMP 경로 문제는 없었다.

## 후속 수정 · Codex 독립 검토 지적 반영

- 지적: UTF-8이 아닌 공개 파일에서 `read_public_json`이 `UnicodeDecodeError`를 그대로 던졌다. 구조화된 차단 issue를 반환하지 않았다.
- 수정: `ops/player_career_archive.py`의 `read_public_json`에서 `UnicodeDecodeError`를 `OSError`와 함께 잡아 `PUBLIC_RECORD_UNREADABLE`로 반환한다. 이 한 줄만 바꿨다. source 범위, 주기, cutoff 의미는 그대로다.
- 회귀 시험 `tests/test_career_public_budget_review.py`는 Codex가 작성했고, Claude는 수정하지 않았다.
- 실제 실행:
  - `python -m pytest -q tests/test_career_public_budget_review.py tests/test_career_public_budget.py tests/test_player_career_archive.py tests/test_fetch_oe_history.py tests/test_player_career.py -p no:cacheprovider`: **65 passed**.
  - 위 세 파일에 `ruff check` 통과. `ops/player_career_archive.py`에 `ruff format --check` 통과.

## 실행하지 않은 것 / 한계

- `--fetch-next` 실제 실행, 공급자 요청, 데이터 수집은 하지 않았다.
- 공개 기록은 서버 발행 시점까지의 정보일 뿐이다. 발행되지 않은 서버 시도나 동시 실행은 잡지 못한다. 분산 락이나 서버 원장을 대신하지 않는다.
- 캐시 실행의 `source.last_verified_at`은 네트워크 시각이 아닐 수 있어 하한으로 쓰지 않는다. 성공 원본 시각은 feed `retrieved_at`으로 유지한다.
- 위 문서는 Claude 실행 보고다. 후속 Codex 독립 전체 418개 및 손상 파일 회귀 검증은 [독립 검토](CODEX_SOLO_EXPLANATION_REVIEW_2026-11-18.md)에 기록했다.
