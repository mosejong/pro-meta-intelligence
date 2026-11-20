# 병렬 C 결과: 시뮬레이션용 관측 자료 수용 감사

2026-11-19 · Claude Opus 5.5 · 기존 파일 수정 없음.

## 변경 파일

- 신규 `ops/audit_simulation_features.py`
- 신규 `tests/test_simulation_feature_audit.py`
- 이 문서

## 인터페이스

```text
python -m ops.audit_simulation_features --cutoff <aware ISO> --year Y [--year Y ...]
  [--archive-dir DIR] [--simulated-delay-hours 24] [--include-player-usage] [--output FILE]
```

- 수용 판정은 `ops.audit_player_career_archive.audit_archive`를 그대로 호출한다
  (등록 연도, archive 무결성/귀속 불가 이슈, cutoff, 정책, 해시, provenance, 충돌 poisoning).
  연도별 결과는 `years[].admission`에 보존된다.
- `USABLE`/`USABLE_WITH_REJECTIONS` 연도만 집계한다. 다시 inspect한 적격 스냅샷 집합이
  수용 결과의 source hash 목록과 다르거나, 읽은 바이트 해시가 다르거나, builder와 같은
  fingerprint·`_validate` 경로로 다시 센 accepted/rejected 수가 builder coverage와 다르면
  `FAILED_CLOSED`로 집계하지 않는다. 그 외 연도는 `NOT_AGGREGATED_<수용상태>`.
- 집계(`features`): 수용 경기 수, 리그/패치/팀(team ID) 경기 수, 선수-역할-챔피언 사용량
  요약(distinct 수, 최소 경기 수별 개수). 항목 목록은 `--include-player-usage`일 때만.
- 시점(`features.timing`): 실제 로컬 retrieved_at 기준 `archived_availability`와
  `observed_at + 가정 지연` 기준 `simulated_publication`(`is_real_availability: false`)을 분리.
- `prior_usage(accepted, target_observed_at, decision_at)`: 대상 경기보다 엄격히 앞서고
  archived available_at ≤ 결정 시각인 경기만 센다. 대상·동시각 경기와 결과는 읽지 않는다.
- `forbidden_pre_game_fields`: result, KDA, gold, damage, vision, CS, gamelength, 오브젝트 등
  명시 목록. 집계에 쓰는 `feature_columns`와 겹치면 import 시 오류.
- `fields.groups`(kda/gold/damage/vision/cs/game_length): 헤더에 없으면 `MISSING`, 있어도
  수용 경로가 검증하지 않으므로 `UNSUPPORTED`. 값은 내보내지 않으며(`values_emitted: null`)
  0으로 채우지 않는다. `match_record_fields`로 MatchRecord에 이런 통계가 없음을 함께 표시.
- 출력: 집계와 source hash/retrieved_at만. raw row, 선수/팀 이름, 경기 ID, archive 경로 없음.
  archive 내부 출력·덮어쓰기·naive cutoff·음수 지연·미등록 연도 거부.

## 검사 결과

- **테스트 미실행.** 이 세션에서 `pytest` 실행이 승인되지 않아 실행하지 못했다(우회하지 않음).
  부모가 `python -m pytest tests/test_simulation_feature_audit.py -q`로 실행해야 한다.
- 작성한 미니 fixture 테스트: 금지목록/feature 분리, 정상 집계·비노출, 사용량 opt-in,
  MISSING/UNSUPPORTED(값 비노출), 결과·same-game stat 변경 시 집계 불변, prior_usage의
  대상/동시각/미가용 제외, archived vs simulated 시점 분리, 미수집·미래 취득·해시 불일치·
  core 누락 연도 보존, 충돌 poisoning + 부분 거부, cutoff 이후 경기 거부, 수용 후 변조
  fail-closed, CLI 1회 쓰기·archive 내부/잘못된 입력 거부.
- 린트/타입 검사, 실제 대용량 raw 스캔: 미실행(범위 밖).

## 한계

- 사용량은 선수 강함·숙련도·효과가 아니다. assumption-manager-v1 가정은 여전히 추상 가정이다.
- archived availability는 로컬 수집 시각이며 과거 공개 시각이 아니다. 오래된 경기는 사실상
  모두 `historically_point_in_time_replayable: false`이며 재현 실험은 가정 지연에 의존한다.
- USABLE은 연도 전체 수집 완료가 아니다. 모든 연도 수집·인과·완성 모델 주장 없음.
