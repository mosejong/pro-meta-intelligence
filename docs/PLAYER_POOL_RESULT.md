# C2 첫 배치 결과 — 가상 로스터 선수 근거·남은 관측 풀

작성: Claude Opus 5.5 (2026-11-17). 커밋·푸시·배포 없음. Codex 검토·통합 대상.

## 변경 파일

- 추가 `web/app/player-pool-evidence.ts`: 순수 계산. 슬롯의 (source team ID, player ID)로만 해당 원팀 profile을 찾는다(이름 매칭 없음, 중복 관측 ID는 UNRESOLVED). 관측 역할/역할 일치, 원팀·표본 경기수·evidence_match_ids, 원팀 관측 기간을 반환한다. `profile.champions`의 경기수와 evidence_event_ids를 그대로 사용한다. 각 챔프를 AVAILABLE / FEARLESS_LOCKED(이전 세트 픽, 양 팀) / BANNED_NOW / PICKED_NOW로 구분하며, 비교는 `championAssetId` 소문자 키로 한다. 목록 상태는 EMPTY(미확인) / LIMITED(top_champions 길이 도달 또는 목록 합계 < 표본) / LISTED이다. 선택 챔프가 목록 밖이면 UNCONFIRMED로 둔다. 입력은 변경하지 않는다.
- 추가 `web/app/player-pool-panel.tsx`: 로스터 편집기 안에 접힌 `<details>`로 넣었다. 클릭으로 선택하거나 확정하는 기능은 없다. "원팀(X) 기록 · 이 팀 기록 아님", "배정 역할 경험 미검증", "목록 내 남은 관측 챔프 n/m (전체 챔프폭 아님)", "목록 밖 · 미확인" 문구를 표시한다.
- 수정 `web/app/roster-workshop.tsx`: 선택 props(selections/previousPicks/focusChampionId)를 받아 패널을 렌더한다. 안내 문구는 "기존 추천 순위·예측/시뮬레이션에는 아직 반영되지 않습니다. 변경은 선수 근거·남은 관측 챔프 표시에만 반영됩니다"로 갱신했다.
- 수정 `web/app/roster-workshop.css`: 패널 스타일을 추가했다(줄바꿈 처리, 720px 이하에서 1열).
- 수정 `web/app/draft-lab.tsx`: RosterWorkshop에 `selections`, 부모 `previousPicks`(fearlessLocks = 이전 세트 픽만), `championFocus?.champion_id`를 전달한다.
- 수정 `web/package.json`: `test`에 새 단위 테스트만 추가했다.
- 추가 `web/tests/player-pool-evidence.test.mjs`, `web/tests/e2e/player-pool.spec.mjs`.
- 수정 `web/tests/e2e/roster-workshop.spec.mjs`: 바뀐 안내 문구에 맞춰 assertion 한 줄만 고쳤다.

radar-types, 자료 팩, 드래프트/A·B 형식, roster-scenario 파일 형식은 변경하지 않았다.

## 실제 검사 결과

- `node --test tests/player-pool-evidence.test.mjs tests/roster-scenario.test.mjs` 실행: **16/16 통과**. 신규 8개는 동명이인/출처 다름/빈 슬롯/중복 ID/역할 이동/제한·빈 목록/모든 목록 잠금/별칭(Kai'Sa·kaisa, Wukong·MonkeyKing, Nunu)/현재 밴·픽 vs 이전 픽/이전 밴 비잠금/선택 챔프 미확인/원자료 불변을 다룬다. 실제 `public/feed/current.json` 전체 팀·전체 선수 순회도 포함한다.
- **미실행**(권한 승인 필요로 차단, 우회·재시도하지 않음): `npm run typecheck`, `npm run lint`(대신 tsc를 직접 호출해 보려 했으나 이것도 승인 필요로 차단됨), 전체 `npm test`, `npm run test:pages`, Playwright(`player-pool.spec.mjs` 신규, `roster-workshop.spec.mjs` 수정분). Codex가 실행해야 한다. 타입은 선언과 대조해 수동으로만 검토했다.
- E2E 신규 시나리오(PC 1440 / 모바일 390 두 프로젝트, 미실행): 제3팀 선수로 교체 시 근거 변경 → 목록 챔프 밴 확정 시 BANNED_NOW, 되돌리기 시 AVAILABLE → 세트 완료 후 다음 세트에서 픽은 FEARLESS_LOCKED, 이전 밴은 AVAILABLE → 새로고침 → 진영 교체 후 슬롯 값과 근거 행의 player key 일치, 밴픽 세트 보존 → 패널/문서 가로 넘침, pageerror·콘솔 오류(리소스 로드 실패 제외) 확인.

## 자료 제약

- 공개 스냅샷의 선수 챔프 목록은 요약이다(팀당 최대 10경기, 생성기의 선수 목록은 상위 4개). `top_champions=5`는 팀 순위 설정으로 선수 목록 제한이 아니다. 시즌 전체, 최근, 패치 비교 기록이 아니다. 승률·실력 점수·추천 가중치는 만들지 않았다.
- 팀 관측 기간은 원팀의 `evidence.first/last_observed_at`이다. 선수 개인 관측 기간이 아니다.
- 최근 경기(recent_games) 세부 병기는 이번 배치에서 하지 않았다. 요약과 합산하지도 않는다.
- 저장·복원된 로스터의 근거는 같은 basis(패치·cutoff·출처) 스냅샷과 현재 밴픽으로 매번 다시 계산한다. 다른 자료로 대체하지 않는다.

## Codex 교차 검토 및 후속 검사

- 원 생성기를 읽어 선수 대표 역할과 챔피언 횟수의 집계 범위가 다름을 확인했다.
  항상 역할을 나누지 않은 요약임을 표시하고, 역할 이동 시 해당 역할 횟수처럼 보이는 문구를 수정했다.
- 팀 순위 설정을 선수 목록 제한으로 잘못 사용한 로직/표시를 제거했다.
- 터치 화면에서도 경기·선택 근거 ID를 펼칠 수 있는 세부 근거를 추가했다.
- 타입/린트 통과, Pages 4/4 통과. 전체 웹 110개 중 108개 통과, 기존 A/B 정적 소스 검사와
  그 부모 묶음이 CRLF 줄바꿈 때문에 실패했다. 검사식을 CRLF/LF 모두 허용하도록 수정한 뒤
  해당 A/B 검사 13/13 통과. 이는 전체 110개 단일 실행 통과 기록은 아니다.
- 신규 선수 근거 및 로스터 실제 Chrome PC/모바일 폭 8/8 통과(단일 실행).
  선수 교체→밴/되돌리기→20턴 완료→다음 세트 피어리스→복원→진영 교체와
  손상 파일 거부를 확인했다. 가로 넘침·페이지/콘솔 오류 없음(외부 리소스 로드 실패 제외).
  실제 휴대폰·타 브라우저·실제 디스크 오류를 검증한 결과는 아니다.
- Python/수집/등록부/외부 데이터/API/추천 점수/기존 저장 형식은 변경하지 않았다. 이번 작업은 아직 배포하지 않았다.
