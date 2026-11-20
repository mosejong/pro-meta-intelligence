# 서버에 보관된 역사 자료의 오프라인 감사

`cached-history-audit.yml`은 이미 확보한 암호화 보관소를 인증·복원한 뒤 기존 연도 수용 감사 도구를 실행한다. 새 공급자 요청, 수집 원장 변경, 피드 빌드·게시, 제품 배포는 하지 않는다. 읽기 권한만 사용하며 자동 예약도 없다.

수동 입력은 기존 `oe-private-history-state-*` artifact ID와 검토할 연도다. artifact가 같은 저장소의 main에서 성공한 정규 collector에서 생성됐는지 확인한다. ZIP은 암호화 상태 파일 한 개와 기존 collector의 세 진단 JSON(pack-report, restore-report, local-health)만 허용한다. 중복/그 외 파일/경로/링크는 거부하고 진단은 각각256KB로 제한하며 추출하지 않는다. 키는 기존 저장소 secret에서만 읽는다. 원본 행·복호화 보관소는 산출물에 넣지 않고 `admission.json` 및 복원 진단만 14일 보관한다.

워크플로 성공은 진단 생성 성공이지 그 연도의 전수 확보나 수용 성공을 뜻하지 않는다. 보고서의 status, 거부 사유, 수용 경기·선수 ID·표본 범위를 확인한 뒤 파생 기능에 사용한다. raw 파일을 개발 PC로 옮기거나 공개 재배포하지 않는다.

## 선택: 보관 원본으로 검토용 시즌 카드 사전 생성

수동 실행 시 `build_cards`(boolean, 기본 false)를 켜면 위 감사가 모두 성공한 뒤에만 추가 단계가 실행된다. 끄면 기존 동작과 동일하다.

1. `admission.json`에서 `requested_years`가 요청 연도 하나뿐이고 그 연도 status가 `USABLE` 또는 `USABLE_WITH_REJECTIONS`인지 확인한다. 아니면 그 단계에서 실패하고 카드는 만들지 않는다.
2. 기존 `ops/build_season_player_cards.py`를 `python -m ops.build_season_player_cards`로 오프라인 실행한다. 입력은 이미 복원된 `outputs/private-audit-state/raw`, 저장소의 `web/public/feed/current.json`, candidate-season `2022`와 요청 연도다. 출력은 `outputs/cached-season-cards/season-player-cards.json`이고 stdout 집계 보고는 같은 디렉터리 `build-report.json`(성공 시에만 임시 파일에서 이름 변경)이다.
3. 별도 artifact `cached-season-cards-<year>-<run_id>`로 이 두 파일만 14일 보관한다. 생성 성공 시에만 업로드된다.

연도 입력은 기존 choice 목록 그대로이며 셸에는 `AUDIT_YEAR` 환경 변수로만 전달한다. 기존 감사 보고서 업로드(`if: always()`)가 카드 단계보다 먼저 실행되므로 카드 생성이 실패해도 감사 진단은 보존된다. 공급자 요청, 수집 원장 갱신, repack, 공개 피드·Pages 반영, git push, `web/public/history` 수정, 출처 추가는 하지 않으며 권한은 읽기 그대로다. 카드 artifact는 공개 반영 전 사전 검토용이다. 공개 카탈로그 갱신은 검토 후 별도 작업으로 한다.

구현 상태(2026-11-19): workflow와 정적 테스트(`tests/test_cached_season_cards_workflow.py`)만 추가했다. 실제 서버 실행과 카드 생성 결과는 아직 없다.

첫 대상: 실행 `44439827394`가 2015년 파일 16,098,660바이트를 서버에서 확보했다. 원본 해시는 `0b7a0a4e75ad388968e15e00e2bfceebd70ae6de34982ab4b8f7f4f55d088d8f`, 암호화 보관소 artifact ID는 `14490956293`이다. 실제 수용 검사는 본 workflow 실행 결과를 기다린다. 취득만으로 2015 선수 카드가 완성됐다고 표시하지 않는다.
