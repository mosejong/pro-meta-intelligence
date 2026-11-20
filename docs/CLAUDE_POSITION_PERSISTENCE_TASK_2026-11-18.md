# Claude 구현 작업 1 · 포지션 배정 보존

실행 모델: Opus 5.5, medium. 사용자 지시: Claude가 구현, Codex가 독립 검증/통합. 현재 HEAD 389fb12f. 전체 문서/대화 재탐색 없이 이 지시와 관련 코드만 읽고 구현하라.

## 목표
밴픽에서 사용자가 명시 배정한 포지션과 미배정 선택을 새로고침·로컬 파일 저장/불러오기 후에도 보존한다. 지금은 메모리만 유지되어 새로고침 때 소실된다. 관측 제안은 명시 배정으로 저장하지 않는다.

## 소유 파일
web/app/draft-session.ts, web/app/draft-agent.ts(serializeDraftScenario 관련 부분만), web/app/draft-lab.tsx(저장/복원 연결만), 필요하면 새 web/app/draft-position-session.ts, 관련 Node 검사 새 web/tests/draft-position-session.test.mjs, 새 web/tests/e2e/draft-position-persistence.spec.mjs, docs/CLAUDE_POSITION_PERSISTENCE_RESULT_2026-11-18.md.
이 밖은 수정하지 말 것. package.json/다른 문서/번역/공유 링크/방 프로토콜은 Codex가 통합한다.

## 요구/경계
- 기존 실제 지원 버전인 밴픽 v2/v3 입력을 계속 읽고 역할 없이 안전하게 복원. v1 신규 수용은 범위 밖. 새 버전(v4 등)이 필요하면 버전 분기를 명시적으로 처리하라. 기존 serialize 호출자는 기존 의미를 보존.
- 자신의 현재 확정 PICK만 배정 가능. 부분 배정 허용. 팀·역할·챔프·중복·미배정 리스트·잘못된 자료를 검사하고 실패 시 전체 기존 작업 보존. 이름 대신 ID/별칭 정규화 사용.
- 명시 미배정을 새로고침 후 다시 제안하지 않는다. 반면 제안만 본 것은 저장/복원 후 자동 명시 확정하지 않는다.
- undo/reset/다음 세트/팀 변경/import의 기존 명시 초기화 규칙 보존. 역할은 현재 세트만. 이전 세트 원본 밴픽·Fearless·선픽·source basis 보존.
- IndexedDB 기존 useDraftSave/직렬 쓰기/실패 leave guard를 재사용. 타이머 tick마다 새 저장이 발생하지 않게 memoize. 공유 링크와 친구 방은 기존 v1/현재 형식 유지하며 역할을 몰래 포함하지 않는다.
- 루스터/시즌/추천/승패 정책 변경 금지. 실시간 방에서는 역할 편집 금지 유지. 로컬 연습만.
- 현재 UI의 '배정은 현재 연습에만 유지' 문구가 새 동작과 충돌하면 소유 파일 밖을 직접 고치지 말고 결과에 알려라.

## 검증
관련 Node 검사 실행 + npm --prefix web run typecheck. 브라우저 검사는 파일만 작성해도 되며 실제 실행 여부를 구분. Codex가 최종 lint/전체/PC모바일 검증을 수행한다. 의미 있는 정상/손상/다른팀/부분배정/구버전/새로고침 사례를 작성하라.

## 실행 제한
새 패키지·데이터 수집·외부 전송·API 키·가입·구매·크레딧 설정 변경 금지. git commit/push/merge/deploy 금지. node_modules/폴더 삭제 금지. 다른 에이전트 생성 금지. 전체 테스트를 반복하지 말 것. 한도/모델 접근 오류면 우회 모델/유료 전환 없이 중단하고 상태 보고. Read/Edit/Write와 명시 테스트에 필요한 로컬 명령만 사용.

## 결과
변경 파일, 실제 검사, 남은 항목과 판단을 위 결과 문서에 짧게 기록. 성공을 추정하지 말 것.
