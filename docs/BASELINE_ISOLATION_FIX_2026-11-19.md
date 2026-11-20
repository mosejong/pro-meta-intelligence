# 고정 기준 A 참조 분리 수정 (2026-11-19)

## 수정 전
- `compareRosterCaptures`가 `changes[].a/b`에 A·B capture의 슬롯 객체를 그대로 넣어 반환했다. 반환값의 `player_id` 등을 고치면 고정된 A(또는 B)의 로스터가 바뀌었다 (`web/tests/goal-core-review.test.mjs`가 1 fail로 확인).
- `compareDraftSnapshots`의 `changes[].before/after`(선택 객체)와 `teamChanges[].before/after`(팀 객체)도 같은 방식으로 스냅샷 객체를 직접 노출했다.
- `rosterExport`의 `basis`가 capture의 basis 객체(및 `source_versions` 배열)를 그대로 반환했다.
- 실제 화면에서 이 변조가 일어나는 사용 경로는 확인하지 않았다. 일반적인 사용자 편집만으로 A가 바뀐다는 근거는 없다.

## 설계 선택: 반환 경계의 방어적 복사
- deep freeze 대신 결과 반환 시 얕은 필드 복사를 택했다. 반환 레코드는 모두 문자열 필드만 가진 평평한 객체라 복사가 완전한 분리이며, 기존 소비자가 반환값을 수정하거나 스프레드해도 동작이 그대로이고 타입도 바뀌지 않는다. freeze는 기존 소비자/스냅샷 객체를 수정하는 코드를 런타임에 깨뜨릴 수 있어 호환 위험이 더 크다.
- `roster-comparison.ts`: `copySlot`로 변경 행의 a/b를 새 객체로 반환. `rosterExport`의 basis와 `source_versions`를 복사.
- `draft-comparison.ts`: 선택 변경 행 before/after와 팀 변경 행 before/after를 새 객체로 반환.
- `buildDraftComparisonSnapshot`/`captureRoster`는 이미 caller 입력과 분리된 값을 만들므로 변경하지 않았다. caller의 report·로스터·선택·역할 배열을 freeze하거나 수정하지 않는다.
- 값·필드·순서가 동일하므로 출력 JSON, `comparisonRecord`, v1/v2/v3 파일 재현 의미는 바뀌지 않는다. 엔진·스키마·UI·의존성 변경 없음, 시뮬레이션 재실행/새 hash/레지스트리 추가 없음.

## 테스트
- 신규 `web/tests/draft-baseline-isolation.test.mjs`: 로스터 a/b의 player_id/이름, 선택 champion_id, 팀 변경 라벨, `rosterExport.basis.source_versions` 수정 후 A/B 불변, 재비교 결과 동일, caller 입력 불변·비동결, side swap 시 로스터 변경 0. TypeError는 동결 거부로 허용하되 불변 단언은 항상 실행.
- `web/package.json`의 `test`에 신규 테스트와 기존 `goal-core-review.test.mjs`를 등록. 기존 회귀 내용은 수정하지 않았다.

## 한계
- 이번 작업에서는 테스트·타입체크·빌드를 실행하지 않았다(Bash/tests 금지). Codex 검증 필요.
- 반환 스냅샷 자체(`buildDraftComparisonSnapshot` 결과, `replayDraftComparison`의 a/b)는 freeze하지 않았다. 그 객체를 직접 수정하는 caller는 여전히 자기 스냅샷을 바꿀 수 있다(이번 범위는 비교 결과와 export 반환값의 별칭 제거).
- `compareRoles`의 반환은 문자열과 새 배열뿐이라 별칭이 없어 수정하지 않았다.


## Codex 확인

수정 전 실패하던 독립회귀1개를 내용 그대로 다시 실행해 통과했다. 새 반환경계 검사와
기존드래프트비교/로스터/준비입력 관련48개, 타입/lint/Pages빌드 통과.
실제 npm test466/466 통과: outputs/web-baseline-isolation-integration-20261119.log.

실제Chrome PC/모바일6개 통과: 로스터A고정→B만편집→v3내보내기·읽기전용재현→v1재현,
진영교환시팀ID별변경귀속유지, 가정실험A/B의동일seed/종료전비노출/되감기/기준해제.
이는화면에서반환객체를임의변조하는실제사용자경로를발견했다는뜻은아니다. 직접API경계의
참조누출은회귀로, 실제기존사용절차보존은브라우저로각각검증했다.
원report/호출자편집입력은동결하지않았고파일스키마/모델/출처는변경하지않았다.
제품push/머지/배포 없음.
