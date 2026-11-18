# 최신 시즌 동반 자료 복구 · 2026-11-18

## 완료한 범위

피드와 다른 시점의 시즌 자료를 최신 자료인 것처럼 바꾸지 않고, 서버의 승인된 원본으로 다시 생성했다. 원본과 키는 서버에 유지했고 공개 집계·해시 명세만 로컬로 내려받았다.

- 복구 실행: https://github.com/mosejong/pro-meta-intelligence/actions/runs/44274234033
- 실행 브랜치: `ops/season-artifact-only-20261118`, 커밋 `59d2cc27`
- 실행 모드: 기존 수동 `refresh-draft-scout.yml`의 `refresh_scope=season-artifact`
- 시즌 job 권한: `actions: read`, `contents: read`. 기존 scouting PR job은 건너뛰었다.
- 원본 공급자 요청·main push·Pages 배포 없음. 이 모드는 서버가 이미 저장한 암호화 원본을 복원하고 정확히 승인 피드가 인용한 원본으로만 집계를 생성한다.
- 반출 파일: `player-season-2026.json`, `manifest.json` 두 개. raw CSV, `.pmi`, 비밀키는 아티팩트에 포함하지 않는다.

## 수용한 자료

| 항목 | 값 |
| --- | --- |
| 피드·시즌 기준 | 2026-11-18T01:35:30.738564+00:00 |
| 참조 패치 | 16.20 |
| 원본 취득 시각 | 2026-11-18T01:35:30.738564+00:00 |
| 원본 SHA-256 | `ee18acfb648f9ef18c3d9851daeb5574d2559dd5e5e29c9cf1b093601eb48320` |
| 시즌 집계 SHA-256 | `a1d918a33ce49cf1a3890b61cc4a49fa389d09854aae0e4836fe20daafa5db33` |
| 시즌 선수 참조 | 219명 |
| 원본에서 수용한 경기 | 9,286경기 |
| 원본에서 거부한 경기 | 648경기 |
| 마지막 수용 경기 | 2026-11-14T23:18:11+00:00 |

219명은 현재 피드가 참조하는 선수 집계이며 전체 프로 선수 수나 현역 선수 수가 아니다. 648경기의 제외는 기록 불완전·팀 ID 누락 등이며 임의 보간하지 않았다. 현재 취득 시각과 마지막 경기 시각도 서로 다른 개념이다.

## 로컬 설치와 검사

1. GitHub CLI로 해당 집계 아티팩트만 `outputs/season-companion-44274234033`에 받았다.
2. `node web/scripts/install-season-companion.mjs outputs/season-companion-44274234033`로 설치했다. 명세의 원본/집계 해시와 기존 파서를 통한 로스터 기준 일치, 이전 집계보다 후퇴하지 않는지 확인한 다음 임시 파일을 원자적으로 교체한다.
3. Windows checkout의 CRLF와 Linux runner의 LF 차이는 피드 해시 비교에서 줄바꿈만 정규화했다. 시즌 파일 바이트는 원문 해시 그대로 비교한다. JSON 값 변경은 여전히 거부한다.
4. `npm run check:practice-data --prefix web` 결과는 `SEASON_COMPATIBLE`이다. 설치 중 피드가 바뀌거나 집계가 변조된 경우 기존 파일을 보존하는 회귀 테스트가 있다.

일반 실행은 `cd web` 후 `npm run install:season-companion -- ../outputs/<artifact-dir>`로 할 수 있다. 호환성 통과는 추천 품질·승패 예측 검증이 아니다.

## 피어리스 재검사

- 현재 자료: 7팀 × 양쪽 선픽 × 3세트 = 42경기. 모두 20턴·양 팀 이전 픽 잠금·관측 역할 배치를 충족했다.
- 과거 고정 피드: 추가 42경기. 최신 시즌 파일을 섞지 않고 제외한 상태로 규칙·역할 검사에 통과했다.
- 주력 후보 집중 밴: 최신 자료로 추가 42경기. 7팀이 3세트를 끝까지 진행했고 상대 5픽의 역할 배치 근거도 모두 충족했다.
- 합계 126경기·2,520턴. 이는 연습 규칙과 관측 역할 배치에 관한 검사다. 상성·조합 우위·선수 능력·실제 팀의 대응·경기 승패를 입증하지 않는다.

결과: `outputs/solo-fearless-three-set-20261118.json`, `outputs/solo-fearless-targeted-bans-20261118.json`. 일반 `npm test`는 진단 JSON을 쓰지 않으며, 재생성 시 `SOLO_SERIES_REPORT=1`을 설정한다.

## 배포 상태

복구용 workflow 변경만 별도 원격 브랜치에 올려 실행했다. 제품 기능과 최신 집계는 현재 로컬 변경이며 main 머지·제품 배포는 하지 않았다. 이 문서는 이전 '원본 복구 대기' 상태를 대체한다.


## 최종 검증

웹 전체 258개, Python 전체 386개, 타입 검사·ESLint·ruff 검사 및 포맷, Pages 4개 통과. Python의 첫 실행은 Windows 임시 아카이브 하드링크 접근 오류로 실패했으며 짧은 임시 경로와 정상 권한에서 재실행했다. PC/모바일 전체 밴픽·포지션·입력 저장·복원·피어리스 흐름 20개와 실제 최신 시즌 로딩 정상 경로 2개가 통과했다.
