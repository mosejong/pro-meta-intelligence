# 과거 시즌 팀 구성 한 번에 배정 — 결과 (2026-11-19, Claude Opus 5.5)

## 구현
- `web/app/season-team-preset.ts` (신규, pure)
  - `observedSeasonTeams(catalog, season)`: `source_id + season + team_id`로 그룹(이름 병합 없음). 역할마다 `game_count` 최대 카드 1개. 상태 `READY / INCOMPLETE(빈 역할) / TIED(동률) / DUPLICATE_PLAYER(동일 player 복수 역할)`. `team_names`는 카드 원본 표기를 정확한 문자열로 중복 제거. 목록 순서는 카드 순서와 무관(코드포인트 비교: 첫 표기 → team_id → source_id). 입력 불변.
  - `presetBlockReason(team)`: 비활성 사유(직접 선택 안내).
  - `seasonPresetSlots(team, catalog)`: 5역할 각각 카탈로그에서 id+player_id+role로 재조회, 같은 source/season/team 재확인, 중복 선수 재확인 후 `{catalog_id, card_id, player_id}` 정확 ref 반환. 실패 시 아무것도 반환하지 않음.
- `web/app/season-lineup-panel.tsx`
  - 기존 "선수 시즌" select 재사용, "관측 팀" select 추가(연도에 따라 갱신, 선수 검색과 독립). 불완전/동률/중복 팀도 목록에 "· 직접 선택 필요"로 표시, 버튼 비활성 + 사유.
  - 미리보기: "역할별 최다 출전 구성", 원본 팀 표기, 역할별 선수·경기수, "당시 출전 수 기준이며 공식 선발·강함을 뜻하지 않습니다."
  - 팀별 "BLUE에 적용 / RED에 적용" 버튼 + "현재 선수 5자리를 이 구성으로 대체" 문구. 기존 `disabled` gate 사용. 기존 개별 `onChoose` 유지.
- `web/app/roster-workshop.tsx`: `applySeasonPreset(teamId, slots)` 추가만.
  - 기존 gate(`disabled || reading || !restored`) 유지. 5역할 모두 ref 필요.
  - target 현재 5슬롯을 비운 복사본 + 시즌 5슬롯으로 `next`를 만들고, 모든 팀에 기존 `validateSeasonLineup` 적용(상대 현재/시즌 선수와 중복 시 예외) → 실패 시 상태 변경 없음.
  - 성공 시 `setSeasonLineups(next)` + 기존 `commit(nextRosters)` → 기존 `onRosterChange` 발행 effect와 `seasonPart`/`onRosterMeta`(연습 보관 메타) 경로를 그대로 탐. 통계를 능력치로 쓰지 않음.
- `web/tests/season-team-preset.test.mjs` (신규): 실제 카탈로그 2015 SK Telecom T1(TOP MaRin 114 / JUNGLE Bengi 97 / MID Faker 77 / BOTTOM Bang 114 / SUPPORT Wolf 102 + 정확 ref·resolveSeasonRef), 관측팀 순서 불변(역순 입력, 동명 팀 비병합), 동률 거부, 빈 역할 거부, 중복 선수 거부, 다른 팀/연도 혼입 거부, 입력 불변.

## 미검증
- **새 단위 테스트 미실행**: `node --test web/tests/season-team-preset.test.mjs` 실행이 명령 승인 단계에서 거부되어 반복하지 않음. 2015 SKT 기대값은 카탈로그 원문 grep으로 SKT team_id(`oe:team:3354e252…`) 존재만 확인했고, 역할별 최다 출전 값 자체는 테스트 실행으로 확인되지 않음.
- typecheck / lint / 기존 테스트 / 브라우저 동작 미실행(지시상 금지 또는 미시도).
- `roster-workshop` 콜백의 상대 중복 거부는 기존 `validateSeasonLineup` 규칙에 의존하며 별도 UI 테스트는 없음.


## 팀 구성 단축 적용 확인

Claude 결과 후 Codex 신규7개·타입·변경lint확인. 실제PC의기존구단호환흐름에2015SKT선택→BLUE에5명한번배정→동일5명RED적용시전체거부/양팀구성불변까지추가해1개통과. 공식선발이아닌관측역할별최다출전구성이고동률/미관측/중복은수동선택대상이다. 다음작업은핵심반복흐름을유지하며이전저장·모바일연결과지원범위를점검한다. 제품배포없음.
