# C3a — 로스터를 A/B 비교에 연결 · 결과 (2026-11-17, Opus 5.5)

커밋/푸시/머지/배포 안 함. 기존 untracked 파일은 건드리지 않음. Codex 소유 simulation-* 파일은 건드리지 않음. package.json 변경 없음.

## 변경

| 파일 | 내용 |
| --- | --- |
| `web/app/roster-comparison.ts` (신규) | `LiveRoster`(basis+pair+rosters), `captureRoster`(report의 roster index로 재검증·detached 복사·라벨 포함), `compareRosterCaptures`(팀ID+역할 기준, `COMPARED`/`PAIR_CHANGED`/`NOT_RECORDED`), 파일용 `rosterExport`/`rosterComparisonRecord`/`parseRosterExport`(근거 범위·표시 이름 변조 감지). report별 index는 WeakMap 캐시. |
| `web/app/draft-comparison.ts` | 스냅샷에 `roster: RosterCapture \| null`. 비교 결과에 `roster`. 비교 파일 schema **"2"**: `baseline_a.roster`/`current_b.roster`(evidence_scope `CURRENT_REPORT_PLAYER_OBSERVATIONS`, basis, team ID 키 rosters)와 `comparison.roster`. v2 저장은 A·B 모두 로스터가 있어야 함. 재현: v2는 로스터를 파일 안 report로 재검증·재계산·대조, **v1("1")은 읽기 전용으로 계속 재현**하고 로스터는 `NOT_RECORDED`(현재 명단으로 채우지 않음, v1 기록에 roster 키가 끼어들면 불일치로 거부). 그 외 schema는 기존대로 거부. 16MB 제한·오류 처리 그대로. boundary에 "season-history 미포함, 선수 효과/승률/시뮬레이션 없음" 명시. |
| `web/app/draft-comparison-panel.tsx` | `roster: LiveRoster \| null` prop. 로스터가 없으면(편집기 복원 전) 고정·저장 비활성("가상 로스터를 확인하는 중"), 기본 명단으로 대체하지 않음. 로스터 차이 표(팀·역할, A/B 선수, 다른 팀 관측은 "가상 변경", 진영 교체 시 "(A에서는 블루)"), 동일/기록 없음/팀 조합 변경 문구. 기준 A 줄에 "고정 당시 가상 로스터 포함". 설명: "로스터를 바꾸면 B만 달라지고 이미 고정된 기준 A는 소급 변경되지 않습니다", "로스터 근거는 현재 분석 데이터의 선수 관측뿐이며 시즌 전체 선수 기록은 포함하지 않습니다. 선수 효과·승률·…·시뮬레이션은 계산하지 않습니다". 재현 영역에 v1 안내. |
| `web/app/roster-workshop.tsx` | `onRosterChange` prop. 기기 복원 확인이 끝난 뒤에만 실제 roster state(편집·파일·복원)를 게시, 언마운트(팀 쌍/자료 기준 변경) 시 `null` 철회 → 이전 쌍 상태 누출 방지. 복원은 편집기 마운트당 1회(같은 값의 report 복제로 effect가 다시 돌아도 저장 실패 시 이전 기기 사본이 편집을 덮지 않음). 파일 불러오기/안내 문구를 "현재 B에만 반영, 이미 고정된 기준 A는 소급 변경되지 않음"으로 정정. |
| `web/app/draft-lab.tsx` | `liveRoster` state(안정적인 setter를 콜백으로 전달 → 렌더 루프 없음)를 편집기→비교 패널로 연결. |
| `web/tests/draft-comparison.test.mjs` | 기존 입력에 로스터 추가. 신규: frozen A 분리(이후 편집이 A를 바꾸지 않음)·픽밴 동일 시 로스터 차이, 진영 교체 시 팀ID 의미 보존, 불명/중복/다른 쌍/다른 basis 거부·빈 슬롯 허용, v2 재현 바이트 동일·로스터 변조(유령 ID, 이름, 출처 팀, 기록 diff/status, 누락, scope, basis, 중복, unknown schema) 거부, v1 읽기 전용 `NOT_RECORDED`, 패널 문구·로스터 미준비 시 고정 비활성, 재현 핸들러/패널 소스가 로스터·localStorage에 접근하지 않음(정적 검사). |
| `web/tests/e2e/roster-workshop.spec.mjs` | 신규 2개: ① 20픽 완료→A 고정→블루 서포터 가상 교체(+탑 비우기)→픽밴 동일 20/로스터 차이 표시→v2 JSON 저장·내용 확인→재현 일치, 유령 ID·unknown schema 거부, v1 변환 파일은 "로스터: 기록 없음"; 매 단계 진행 수·로스터 값·기기 사본·기준 A 불변 확인. ② A 고정 후 로스터 변경→세트 초기화→진영 교체→재완료, 변경이 같은 팀(이제 레드)으로 "(A에서는 블루)" 표시. |

## 실제 실행한 검사

- `node --test tests/draft-comparison.test.mjs tests/roster-scenario.test.mjs tests/player-pool-evidence.test.mjs tests/player-season-history.test.mjs tests/draft-exchange.test.mjs tests/draft-autosave.test.mjs` → **52/52 통과**.
- `node --test tests/locale.test.mjs tests/workspace-storage.test.mjs tests/publication-loader.test.mjs tests/draft-benchmark.test.mjs` 포함 비빌드 단위 → 통과(위와 합쳐 확인).

## 실행하지 못한 검사 (부모 실행 필요)

이 세션에서 `npm run typecheck`, `npm --prefix … run typecheck`, `npm run lint`, `node …/tsc` 가 모두 **권한 승인 대기로 차단**되어 우회하지 않았다. 따라서 아래는 **미확인**이다.

- `npm --prefix web run typecheck`
- `npm --prefix web run lint` (react-hooks v7 규칙 포함)
- `npm --prefix web run build:pages` 및 desktop/mobile Chrome E2E:
  `npx --prefix web playwright test tests/e2e/roster-workshop.spec.mjs tests/e2e/draft-studio.spec.mjs`
  (draft-studio의 기존 A/B 테스트는 이제 고정 시 로스터 게시를 기다리므로 함께 확인 권장)
- `rendered-html` / `pages-build` 등 빌드 의존 단위 테스트.

새 E2E 2개는 작성만 했고 실제 Chrome에서 한 번도 돌리지 않았다. 셀렉터·문구 불일치 가능성이 있다. 기존 기기 복원 1회 flake 이력은 이번에 재현/해소 여부를 확인하지 못했다.

## 작업 트리 참고

작업 중 `web/app/draft-session.ts`(수정), `web/app/simulation-core.ts`, `web/tests/simulation-core.test.mjs`, `web/tests/draft-storage-deadline.test.mjs`(신규)가 생겨 있었다. 이번 작업에서 만든 변경이 아니며 손대지 않았다(병행 세션 작업으로 보임). 위 단위 테스트는 이 상태에서 통과했다.

## 부모 통합 검사

- Codex: 빌드 포함 웹 143/143, typecheck/lint, Pages 4/4 통과.
- 실제 Chrome PC·모바일 폭의 기존 밴픽/로스터/저장 장애 E2E 24/24 통과. 새 로스터 고정·재현·진영 교환 4회 포함.
- 이후 입력 준비 기능과 통합한 최종 웹 158/158 통과. 예측 정확도나 실제 사용자 효용 입증은 아니다.
- 로그 `outputs/roster-comparison-*-20261117.log`, 캡처 `outputs/roster-comparison-20261117/`.
- 재현 검사는 입력 규칙·출처 일치와 결과 재계산 일관성이다. 원저자 인증/외부 서명을 제공하지 않는다.

## 남은 판단/한계

- 로스터 근거는 현재 report의 `opponent_prep.teams[].player_profiles` 관측뿐이며, 지연 로드 연간 자료는 캡처에 포함하지 않는다(파일 boundary·화면에 명시).
- 선수 효과·승률·가중치·추천 반영 없음(범위 밖).
- A와 B의 팀 조합이 다르면 로스터는 `PAIR_CHANGED`로 슬롯 비교를 하지 않는다.
- 로스터 편집기가 복원을 끝내기 전(첫 setTimeout 0) 짧은 순간에는 A 고정 버튼이 비활성이다.
