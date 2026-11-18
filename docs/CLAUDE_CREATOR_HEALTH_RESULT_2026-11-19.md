# Creator 정상 빈 결과 감시 — 결과 (2026-11-19)

작성: Claude Opus 5.5 · 검증 대상: Codex

## 문제

watchdog run 44262583725의 `CREATOR_FEED_READY`가 실패했다. Creator header(schema 1 / CREATOR /
publication_ready=false / human_review_required=true)는 정상이었지만 `topic_count=0`이었다.
paired Radar(`16.20`, cutoff `2026-11-18T01:35:30.738564+00:00`)는 entries 106개, `eligible_for_review`
true 0개였다. 그래서 `CreatorBriefBuilder`는 계약대로 `topic_candidates=[]`와
`warnings=["NO_ELIGIBLE_CANDIDATES"]`를 냈다. 같은 실행의 `SCHEDULE_PUBLICATION_FRESHNESS`
실패(issue #120)는 실제 문제이므로 그대로 남아야 한다.

## 변경 (`src/pro_meta_intelligence/publishing/health.py`)

- `_creator_publication_check(creator_feed, current_feed=None)`: watchdog이 `current_feed`를 넘긴다.
  `assess_oe_feed_health`는 이 체크를 쓰지 않으므로 변경이 없다.
- topics가 비어 있지 않은 기존 분기는 그대로 둔다. observed에는 `creator_state=TOPICS_AVAILABLE`만 추가된다.
- topics가 `[]`이면 새 `_is_confirmed_empty_creator`가 다음을 **모두** 만족할 때만 통과시킨다.
  (`creator_state=EMPTY_CONFIRMED`)
  1. Creator header가 정상이다(기존 조건과 같다).
  2. paired Radar가 dict이고 `schema_version="1"`, `fixture_only is False`이며 patch_id와 cutoff가 비어 있지 않은 문자열이다.
  3. `entries`가 list이고, 모든 entry가 dict이며 `metrics`가 dict이고 `eligible_for_review is False`다.
     bool 타입만 인정하므로 0, None, "false", 키 누락은 모두 실패한다.
  4. `evidence_index.source_versions`가 비어 있지 않은 list이고, 각 항목의 `content_hash`가 `sha256:<64hex>` 형식이다.
  5. Creator `warnings`가 list이고 `NO_ELIGIBLE_CANDIDATES`를 포함한다.
  6. **`CreatorBriefBuilder().build(current_feed)` 결과가 게시된 Creator payload와 정확히 같다.**
     비교 범위는 header, template_version, source_snapshot(patch, cutoff, fixture, source hashes,
     analysis_window), 경고 전체 목록(`INACTIVE_PATCH_HISTORICAL_WINDOW` 포함), narrative_constraints,
     ai_handoff, 그리고 빈 topic_candidates다. builder 예외도 실패로 처리한다.
- 그 밖의 경우는 `creator_state=NOT_READY`로 기존처럼 실패한다.
- check ID, severity, 다른 체크, `next_action`(`RESTORE_PAIRED_CREATOR_FEED`) 로직, 중복 알림 경로는 바꾸지 않았다.
  human approval 경계(`publication_ready=false`, `human_review_required=true`)는 오히려 더 엄격하게 대조한다.

## 검증 (네트워크 없음)

- `tests/test_creator_empty_health.py` 14개 테스트:
  - 실제 builder 출력이면 EMPTY_CONFIRMED가 되고 전체 HEALTHY다.
  - 스케줄이 만료되면 failed_checks가 정확히 `["SCHEDULE_PUBLICATION_FRESHNESS"]`다(run 44262583725 재현).
  - Radar가 만료되면 `RADAR_PUBLICATION_FRESHNESS`가 실패로 유지된다.
  - entries가 비면 Creator는 통과하지만 `PUBLIC_FEED_READY`는 실패로 유지된다.
  - 경고가 없으면 실패한다.
  - topics=[]와 경고 문자열만 있는 불완전한 creator는 실패한다.
  - eligible 후보가 있는데 유실되면 실패한다.
  - eligibility 값이 0, None, "false", 키 누락, metrics 누락이면 실패한다.
  - source hash, patch, cutoff, analysis_window가 불일치하면 실패한다(`RADAR_CREATOR_PAIRED`도 함께 실패한다).
  - Radar가 없거나 evidence_index가 없거나 hash가 비정상이면 실패한다.
  - fixture Radar는 실패한다.
  - 불완전하거나 변조된 creator는 실패한다(constraints, handoff, template, publication_ready,
    human_review, 추가 경고, topics 비-list 7가지).
  - INACTIVE 경고도 builder와 일치해야 한다.
  - 기존 nonempty 분기는 그대로 통과하고, `publication_ready=true`이면 실패와 next_action이 유지된다.
- 실제 로컬 아티팩트 `outputs/hosted-history-integration/web/public/feed/{current,current-creator}.json`
  (16.20, entries 106개, 전부 bool, eligible 0개)을 넣으면 `passed=True, creator_state=EMPTY_CONFIRMED`다.
  같은 creator를 Radar 없이 넣으면 실패한다.
- `pytest tests/test_creator_empty_health.py tests/test_publication_watchdog.py tests/test_feed_health.py
  tests/test_hosted_history_acquisition.py tests/test_ops_scripts.py tests/test_cli.py`: **141 passed**
- `ruff check` / `ruff format --check`(변경 파일 2개): 통과

## 한계

- 빈 결과를 인정하려면 Creator가 현재 builder 출력과 **바이트 수준이 아니라 값 수준에서 완전히 같아야** 한다.
  builder의 narrative_constraints나 ai_handoff 문구가 바뀌었는데 Creator를 재생성하지 않으면 빈 결과가 실패로 바뀐다.
  이는 의도한 fail-closed 동작이다. nonempty 분기는 영향을 받지 않는다.
- "만료 피드"는 이 체크가 아니라 기존 freshness 체크가 잡는다. 이 체크는 freshness를 판단하지 않는다.
- entries 수가 매우 많아도 builder 재실행은 빈 후보에서 O(n)이므로 비용은 무시할 수준이다.
- 커밋과 배포는 하지 않았다. 다음 실제 watchdog에서 `CREATOR_FEED_READY`가 통과하더라도
  `SCHEDULE_PUBLICATION_FRESHNESS`가 해소되기 전까지 전체 상태는 UNHEALTHY로 남는다.
- 새 테스트는 `test_publication_watchdog`의 fixture helper를 import한다. 해당 helper 이름이 바뀌면 함께 수정해야 한다.
