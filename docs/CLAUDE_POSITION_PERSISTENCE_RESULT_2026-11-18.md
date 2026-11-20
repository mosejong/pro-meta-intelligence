# 포지션 배정 보존 결과 (Claude, 2026-11-18, base 389fb12f)

## 변경 파일
- `web/app/draft-position-session.ts` (신규): `normalizeDraftPositions`(저장용 정규화, 현재 두 팀 ID·자기 현재 세트 PICK만, 별칭→asset ID, 없으면 `null`), `parseDraftPositions`(엄격 검증, 하나라도 틀리면 전체 거부).
- `web/app/draft-agent.ts`: `serializeDraftScenario`에 선택 8번째 인자 `positions`. 비었거나 생략이면 **기존 v3 출력과 바이트 동일**; 있으면 `schema_version: "4"` + `current_game_positions` 추가. 공유 링크·친구 방 호출자는 인자를 넘기지 않아 역할이 포함되지 않음.
- `web/app/draft-session.ts`: v2/v3/v4 명시 분기. v4는 `current_game_positions` 필수, v2/v3에 이 키가 있으면 거부. 역할 검증 실패 시 기존 `CURRENT_GAME` 코드 사용(번역 키 추가 회피). `DraftSession.positions`는 선택 필드이며 없으면 키 자체가 없음(기존 deepEqual 호출자 영향 없음).
- `web/app/draft-lab.tsx`: `positionContextKey` 함수 추출; `restoreSession`이 v4 역할/미배정을 같은 context로 복원; `positionRecord` useMemo → `saveSnapshot`(기존 useDraftSave/직렬 쓰기/leave guard 재사용)와 파일 다운로드에 전달. 방 활성 시 `null`.
- 테스트: `web/tests/draft-position-session.test.mjs`(신규), `web/tests/e2e/draft-position-persistence.spec.mjs`(신규).

## 저장 형식 (v4, 로컬 연습 전용)
`current_game_positions: { [teamId]: { roles: {TOP..SUPPORT: id|null}, unassigned: id[] } }` — 명시 배정과 명시 미배정만. 관측 제안은 저장하지 않으며 복원 시 자동 확정되지 않음.
거부 사례: 다른 팀 ID, 상대 픽/밴/이전 세트 픽, 알 수 없는/누락 역할, 역할 중복, 배정+미배정 중복, 미배정 비배열·6개 이상, 비문자열, 추가 키, 진영 교체로 픽 불일치.

## 기존 규칙 유지
undo/reset/다음 세트/팀 변경/교체/import는 기존처럼 `positionState`를 비우거나 context가 바뀌어 무효 → 다음 저장은 v3. 이전 세트·Fearless·선픽·source basis는 기존 경로 그대로. 타이머 tick은 `positionRecord`/`saveSnapshot` 의존값을 바꾸지 않음.

## 실제 실행한 검사
- `npm --prefix web run typecheck`: 통과.
- `node --test tests/draft-position-session.test.mjs`: 5/5 통과 (v3 동일성, 부분 배정·미배정 v4 왕복·양 선픽, 정규화, 손상 16종+진영교체 거부, v2/v3 하위호환 및 이전 세트/Fearless/선픽 보존).
- 영향 회귀: `draft-share`, `draft-room-client`, `draft-exchange`, `draft-position-board`, `draft-autosave` 32/32 통과.
- **브라우저 spec은 작성만, 실행하지 않음** (새로고침 보존, 새로고침 후 undo→v3, 파일 저장→초기화→불러오기). 다운로드 버튼은 `시리즈 JSON 저장` 라벨 기준.

## 수정 1 · `__proto__` 키 (Codex 독립 검토 지적)
- 결함: 팀 ID `__proto__`일 때 `result[teamId] = …`가 prototype setter를 타서 own 키가 없고(역할 소실) 결과 객체 prototype이 바뀜. `normalizeDraftPositions`도 동일.
- 수정(`draft-position-session.ts`만): 결과 기록은 `Object.defineProperty` 기반 `putOwn`으로 own enumerable data property 작성 → 일반 문자열 ID(`__proto__` 포함)를 그대로 보존(거부하지 않음). 입력 읽기는 모두 `ownValue`(Object.hasOwn) 경유 → 상속된 팀/역할/미배정 사전은 배정을 제공하지 않음. parse는 기존 exactKeys 형태 검사로 상속 역할은 거부.
- 회귀 테스트 2개 추가: parse/normalize 모두 `Object.keys`=`["__proto__"]`, prototype 불변, `Object.prototype` 오염 없음, JSON 왕복 후 역할 유지, 매치업 밖 `__proto__` 거부; 상속 사전 무시·own만 반영·parse 거부.
- 실제 실행: `node --test tests/draft-position-session.test.mjs` **7/7 통과**. (수정 1에서는 typecheck/다른 테스트 재실행 안 함.)
- 참고(미수정, 기존 코드): `draft-lab.tsx`의 `positionRoles[team.team_id] = …` 지역 할당도 같은 패턴이나 이번 지시 범위(helper) 밖이라 남김. 실데이터 팀 ID가 `__proto__`일 가능성은 낮음.
- 정정: 원 파서는 v2/v3만 지원(지시의 "v1"은 부정확). v1 지원은 추가하지 않음.

## Codex에 넘길 항목
- `web/app/draft-position-stack.tsx:55` 문구 "배정은 현재 연습에만 유지됩니다."는 이제 새로고침/파일 저장 후에도 유지되므로 수정 필요(예: "배정은 이 기기 로컬 연습과 저장 파일에만 유지되며 공유 링크·친구 방에는 포함되지 않습니다."). 번역 포함.
- 역할 검증 실패 전용 오류 코드가 필요하면 `DRAFT_SESSION_ERROR_TEXT`+locale 키를 함께 추가(현재는 `CURRENT_GAME` 재사용).
- `package.json` test 목록에 `tests/draft-position-session.test.mjs` 추가, e2e 실제 실행.
- 참고: 시나리오 JSON 다운로드도 v4가 되므로, v3만 읽는 구버전 앱은 역할이 있는 파일을 거부함(역할이 없으면 v3 유지).


## Codex 독립 검토 보충

- 파일 import는 현재 작업의 배정을 버리고 **불러오는 v4 파일의 명시 배정/미배정으로 교체**한다. v2/v3 파일에는 배정이 없어 빈 상태가 된다. 위 'import는 positionState를 비운다' 표현은 이 차이를 생략한 설명이다.
- Codex는 특수 팀 ID 문제를 직접 재현해 Claude에 재수정을 맡겼고, 수정 후 전체 웹 265개·타입·lint·Pages 4개를 독립 실행해 통과했다.
- Codex 브라우저 검사는 고급 파일 도구를 실제로 여는 절차 및 마지막 미배정 저장 완료 대기를 보완해 실행 중이다. Claude가 실행한 브라우저 검사로 표기하지 않는다.
