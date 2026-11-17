# 연간 선수 자료 자동 갱신 연결 결과 (2026-11-17)

## 변경 파일

- `ops/build_player_season_history.py`: `--archive-dir` 모드 추가.
  - 피드의 `input.import_report`(source_id/content_hash/retrieved_at/source_version)와
    정확히 일치하는 검증된 SnapshotArchive 항목이 한 개일 때만 사용. 최신·다른 시각·기본 원본 fallback 없음.
  - archive integrity 문제(손상·누락·고아 파일), 미래 취득 시각, evidence_index 불일치, 어댑터 source_version 불일치는 거부.
  - 기존 연간 파일보다 cutoff 또는 source.retrieved_at이 과거면 거부.
  - 선택된 data_path/metadata_path를 기존 `build()`로 전달해 hash/byte 확인, 정책 gate, atomic 교체를 그대로 사용.
  - `--csv`/`--meta`와 함께 지정하면 argparse 오류(종료 코드 2). 수동 모드는 그대로 유지.
- `.github/workflows/hosted-oe-sync.yml`: sync-health 성공 후, Pages 빌드 전에
  `Refresh season player history` 단계(continue-on-error) + 실패 경고 단계 추가.
  정규식·변경 검사·git add에 `web/public/history/player-season-2026.json` 한 경로만 추가.
  reset/clean/checkout 복구는 넣지 않음(생성기의 atomic 보존에 의존).
- `tests/test_player_season_refresh.py`(신규), `tests/test_ops_scripts.py`(hosted workflow 단언 추가).

## 실제 검사

- `python -m pytest tests/test_player_season_refresh.py tests/test_player_season.py tests/test_ops_scripts.py -q` → 28 passed
- `python -m ruff check` / `python -m ruff format --check` (변경 Python 파일) → 통과

## Codex 교차 검토

- Python 전체 323/323, ruff 전체 검사/포맷 통과. 관련 웹 검사 9/9 통과.
- 갱신 실패로 이전 파일을 유지할 때 CI가 승인된 피드 발행까지 막지 않도록 웹 자산 검사를 수정했다.
  이전 파일 자체의 구조/시간/출처 정합성은 여전히 검증하고, 새 basis에서는 반드시
  BASIS_MISMATCH로 거부되는지 확인한다. 손상 또는 미래 기준 파일을 허용하는 완화가 아니다.
- 승인 보관 CSV와 재구성한 로컬 참조 피드로 archive 모드의 실제 생성 확인:
  219/219 프로필, 1,126,532 bytes. 이것은 생산 피드 자체로 서버 실행한 결과가 아니다.
- 실제 현재 피드가 가리키는 11/14 원본은 로컬 보관소에 없다. 해당 CLI 호출을 실행해
  누락을 거부하고 이전 출력 bytes와 실제 현재 연간 JSON이 바뀌지 않음을 확인했다.
- YAML 파싱 통과, sync-health 성공 조건/Pages 이전 실행 확인. 공개 허용 정규식은
  연간 JSON 한 경로만 허용하며 raw/private/다른 연도/하위 경로를 거부함을 확인했다.
- 네트워크 수집, 웹 제품 코드, 현재 파생 자료, 갱신 주기, 출처 정책은 변경하지 않았다.
  프런트엔드 런타임 변경이 없어 전체 웹/E2E를 불필요하게 다시 실행하지 않았다.

## 한계

- 실제 hosted 서버(GitHub Actions)에서는 아직 실행하지 않았다. 머지·배포 후 예약 실행에서
  복원된 서버 archive에 현재 피드 원본이 정확히 존재하는지와 새 산출물 반영을 확인해야 한다.
- 기존 연간 파일이 읽을 수 없는 JSON이면 자동 갱신은 실패(경고)하며 파일을 보존한다.
