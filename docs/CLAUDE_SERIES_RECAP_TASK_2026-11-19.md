# 피어리스 여러 세트 복기 · Claude 구현

Opus 5.5 medium. 기존 제품을 확장한다. Codex가 독립 검토한다. 추가 에이전트/네트워크 수집/패키지 설치/새 출처/솔로랭크/번역/커밋·푸시·배포 금지.

## 목표

완료한 여러 세트를 한 곳에서 되짚는 간단한 접힌 복기 패널. 기존 `games`와 현재 완료 `selections`, 고정된 `seriesReport` 및 `buildDraftResultReport`를 재사용한다. 자동 상대 추천 규칙/점수/선택 결과는 바꾸지 않는다. 실제 자동 선택 이력이나 구매·승률 예측인 것처럼 말하지 않는다.

## 읽기

`draft-lab.tsx`의 games/nextGame/reopenPreviousGame/swapSides/restore/reset 경로, `draft-result-report.ts`, `draft-result-panel.tsx`, `draft-agent.ts`의 DraftGame/Fearless legality, 기존 session/브라우저 테스트.

## 구현 범위

- NEW `web/app/draft-series-recap.ts`: 순수 집계. 완료 games를 순서대로 검증하고 각 세트의 당시 blue/red 팀 ID를 고정 report에서 해석한다. 선픽은 해당 선택의 첫 side로 판단한다. 앞 세트의 PICKS만 다음 세트의 잠금이다. 기존 결과 빌더로 합법성/근거를 재사용하고 이름으로 팀을 재결합하지 않는다. 불완전/불법/미확인 팀은 추정 없이 미지원 상태로 표시한다. 입력을 수정하지 않는다.
- NEW `web/app/draft-series-recap-panel.tsx` + 최소 CSS. 기본 접힘, 한국어 일반인 문구. 세트별 양 팀 픽/밴, 다음 세트에서 잠기는 픽, 기존 공개 요약으로 확인한 공통 우선 픽/상대 기록 밴 정도만 보여준다. 자료 부족은 미확인이다. 승자·승률·가치 점수·효과 예측·실제 자동 선택 이유라고 표시하지 않는다.
- `draft-lab.tsx` 최소 연결: 한 세트 이상 완료했거나 현재20턴일 때만 나타난다. 지난세트가 있는 진행 중 현재 세트는 복기 목록에 완료로 넣지 않는다. 현재완료는 한 번만 포함한다. 다음세트/다시열기/되돌리기/팀·진영 변경/새로고침·보관함 복원 후 과거 기록의 팀이 현재 팀으로 바뀌면 안 된다. 기존 저장 schema/링크/방/명시 포지션/추천은 변경 금지. 방에서는 숨겨도 된다.
- NEW `web/tests/draft-series-recap.test.mjs`; 관련 새 E2E `web/tests/e2e/draft-series-recap.spec.mjs`; `web/package.json` 테스트 연결만. 기존 테스트를 약화하거나 CSS 룰 비활성화하지 않는다.
- 결과 문서 `docs/CLAUDE_SERIES_RECAP_RESULT_2026-11-19.md`.

단위 검사: 3세트 잠금 누적/양 선픽/세트간 진영 교환의 팀 ID 정확성/현재 불완전 제외/현재 완료 중복 방지/불법 재사용·손상 입력·알 수 없는 팀 거부/입력 불변·의존 자료 미확인. E2E PC·모바일에서 완료→다음세트→다시열기/복원 동작, 기본접힘·읽기전용·가로넘침을 확인한다. 테스트 대역과 실제 브라우저 결과는 구분한다.

실제로 수행한 검사와 한계를 보고한다. Codex 독립 검토가 끝나기 전 완료/배포/예측 효용을 주장하지 않는다.
