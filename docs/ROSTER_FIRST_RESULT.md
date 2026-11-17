# 가상 로스터·포지션 편집기 결과 (2026-11-17)

아래는 Claude 구현 직후의 기록이다. 이후 Codex가 지연 파일 읽기 경합을 수정하고
타입/린트, 웹 102/102, Pages 4/4, 실제 Chrome PC·모바일 폭 E2E 18/18을 확인했다.
최종 범위와 검사 근거는 `ROSTER_RELEASE_REVIEW_2026-11-17.md`를 따른다.

모델: Opus 5.5. 커밋/푸시/배포 없음. 하위 에이전트·Fable 호출 없음. 패키지 추가 없음.

## 변경 경로
- 신규 `web/app/roster-scenario.ts`: 순수 로직. (source team ID, player ID) 식별, 이름 충돌 표시만, 같은 팀 내 중복 관측 ID는 선택 불가.
  초기값은 역할별 CURRENT 관측이 정확히 1개일 때만 채움. 한 선수가 여러 역할이나 양 팀에 걸리면 비움.
  `roster-scenario` v1 직렬화·파싱(64KB, 미래/잘못된 버전, 패치·cutoff·fixture·출처 해시 불일치, 팀 쌍 불일치, 미확인/모호/중복 선수 거부).
- 신규 `web/app/roster-workshop.tsx`, `web/app/roster-workshop.css`: 팀 설정 아래 접히는 `가상 로스터·포지션` 패널.
  원관측과 다른 슬롯, 다른 팀 관측 선수, 관측 역할 이동을 `가상 변경`으로 표시. 이미 배치된 선수를 고르면 이동하고 원래 슬롯은 빈칸.
  "현재 분석/추천/시뮬레이션에는 로스터 변경이 아직 반영되지 않습니다" 문구 표시. localStorage 키 `pro-meta-roster-scenario-v1`(최근 1개).
  팀 ID 기준으로 저장하므로 진영을 교체해도 명단이 유지됨. 파일 열기는 밴픽·기준 A·분석을 건드리지 않으며, 실패하면 현재 로스터를 유지함.
- `web/app/draft-lab.tsx`: import 1줄 + 팀 설정 섹션 뒤 `<RosterWorkshop … disabled={!canSelect} />` 1줄. PartnershipPlacement 연결은 그대로 보존.
- `web/package.json`: `test` 스크립트에 `tests/roster-scenario.test.mjs` 추가.
- 신규 `web/tests/roster-scenario.test.mjs`, `web/tests/e2e/roster-workshop.spec.mjs`.
- 변경 없음: draft-session.ts, 밴픽 v2/v3, A/B 비교 스키마, 분석 스냅샷, 자료 팩, 출처 등록부, 번역, draft-studio.css.

## 실행한 검사
| 명령 | 결과 |
|---|---|
| `node --test tests/roster-scenario.test.mjs` | 8 tests, 8 pass, 0 fail (최종 수정 후 재실행) |
| `npm run typecheck` | **미실행**: 이 세션에서 승인 필요로 차단됨 |
| `npm run lint` | **미실행**: 승인 필요로 차단됨 |
| `npm test` | **미실행**: 승인 필요로 차단됨 |
| `npm run test:pages` / `build:pages` | 미실행 (npm 승인 필요) |
| Playwright `roster-workshop.spec.mjs`, `draft-studio.spec.mjs` | 미실행: build:pages가 선행되어야 하는데 npm이 차단됨. 오래된 dist로는 실행하지 않음 |

지시대로 권한 차단을 우회하지 않았다(`npx tsc` 등 직접 바이너리 호출도 하지 않음).
단위 테스트 범위: 다수 팀(동봉 `public/feed/current.json` 전체 팀 순환 쌍), 동명이인/ID 분리, 관측/가상 구분,
빈 역할, 같은 역할 CURRENT 복수, 같은 팀 중복 ID, 다중 역할 선수, 양 팀 중복, 역할 이동, 다른 팀 이동, 출처/패치/cutoff/팀 쌍 불일치,
크기/버전/손상 JSON, 형식 오류, 원자료 불변성, 이전 상태 보존, 진영 순서 무관 왕복.

## 미확인 (Codex 검토 시 실행 필요)
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:pages`.
2. `npm run test:e2e` (또는 build:pages 후 `npx playwright test tests/e2e/roster-workshop.spec.mjs tests/e2e/draft-studio.spec.mjs`), desktop/mobile-width 두 프로젝트.
   새 E2E는 미실행 상태로 작성만 됨: 편집→기기 저장→새로고침 복원, 선수 이동, 진영 교체, 파일 저장/열기, 손상/미래 버전/팀 쌍/근거/중복/미확인/64KB 초과 거부, 현재 밴픽 1턴 보존.
3. React Compiler lint 규칙과 정적 HTML 렌더 테스트에 새 패널이 걸리는지 여부.
4. 패널 문구는 한국어 전용(번역은 기능 검증 후 예정).
