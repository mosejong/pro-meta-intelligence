# Phase 0 — Data Source Audit

> 상태: 2026-08-21 1차 조사. 실제 구현 전에 각 소스의 최신 약관/라이선스/접근성 재확인 필요.

## 결론

Pro Meta Intelligence는 **프로 경기 데이터**, **Riot 공식 정적/솔랭 데이터**, **공개 Expert/OTP evidence**, **향후 팀 내부 데이터**를 서로 다른 신뢰 계층으로 분리한다. 한 소스가 모든 문제를 해결한다고 가정하지 않는다.

## 분류 기준

- `AVAILABLE`: 현재 공식/공개 인터페이스와 사용 경로가 명확하여 Phase 1에 사용 가능
- `LIMITED`: 사용 가능하지만 rate limit, 식별성, coverage, 품질, 라이선스 등 제약이 큼
- `RESEARCH`: 가치가 있으나 수집/재배포/안정성/정합성을 더 검증해야 함
- `REJECTED`: 현재 설계에서 근거 데이터로 사용하지 않음

## Source Matrix

| Source | Status | Intended use | 주요 제약 |
|---|---|---|---|
| Riot Data Dragon | AVAILABLE | 패치별 champion/item/rune/static snapshot | 패치 노트의 의미 해석 자체를 대체하지 않음 |
| Riot Match-V5 | LIMITED | 식별 가능한 공개 계정의 SoloQ match history | API key/rate limit, routing, 계정 식별, 장기 수집 비용 |
| Riot League/League-EXP APIs | LIMITED | 고티어 ladder cohort discovery/validation | API 정책과 rate limit 준수 필요 |
| Oracle's Elixir | AVAILABLE* | 프로 경기/선수/팀 단위 historical analytics 및 backtest | upstream 품질 이슈를 검증해야 함. `*` 사용 조건/라이선스 재확인 |
| Riot patch notes | AVAILABLE | 패치 change event + human-readable rationale | 구조화 ETL 필요, hotfix/mid-patch 처리 필요 |
| Public OTP/expert posts/videos | RESEARCH | 후보 발견/설명용 weak evidence | 저작권, 플랫폼 ToS, 삭제/수정, 번역, 신원/티어 검증 |
| Public pro-player SoloQ accounts | RESEARCH | 공개적으로 식별 가능한 경우 practice signal | 계정 귀속 오판 위험. 숨겨진 계정 추적 금지 |
| Search/social buzz volume | RESEARCH | information-demand 보조 신호 | popularity ≠ strategic value, bot/event bias |
| Unofficial scraped hidden player data | REJECTED | 사용 안 함 | privacy/game-integrity/재현성 문제 |
| Private scrim/team data | NOT AVAILABLE | 실제 도입 시 team-specific validation | 데모에서는 synthetic adapter만 사용 |

## Riot official layer

### Data Dragon
패치별 정적 게임 데이터의 canonical snapshot 용도로 사용한다. 저장 시 반드시 `game_version`, `retrieved_at`, `source_uri`, `content_hash`를 기록한다. 최신 데이터로 과거 시점을 덮어쓰지 않는다.

### Match-V5 / ranked APIs
SoloQ 계층은 Riot API를 우선한다. Personal key 단계에서는 연구/프로토타입 범위로 제한하고, 공개 서비스 단계에서는 Production key 정책을 다시 검토한다.

중요 원칙:
1. 숨겨진 플레이어를 역식별하지 않는다.
2. 공개적으로 확인되지 않은 프로 선수 계정을 추정하여 연결하지 않는다.
3. API key를 저장소에 커밋하지 않는다.
4. raw response와 derived feature를 분리한다.

## Professional match layer

Oracle's Elixir는 수년간의 프로 경기 데이터를 일관된 CSV 형태로 제공하는 유력 Phase 1 후보이다. 다만 공개 커뮤니티 구현에서도 2026 draft/champion-select 데이터의 upstream 오류 가능성이 언급되어 있으므로, **source trust = automatic truth**로 취급하지 않는다.

필수 QA:
- game/team/player row cardinality check
- duplicate game id check
- champion/position null rate
- pick/ban plausibility
- patch/date consistency
- selected events에 대한 second-source spot check

## Expert / OTP evidence layer

장인피셜은 정답 레이블이 아니다. `weak evidence`다.

저장 단위 예시:

```text
EvidenceClaim
- claim_id
- champion
- role
- patch
- author_public_identity
- author_rank_evidence (nullable)
- source_type
- source_uri
- published_at
- original_language
- original_excerpt (최소 필요 범위)
- ko_summary
- claim_type
- confidence
- retrieved_at
```

원문 전체를 무단 저장/재배포하는 구조를 피하고, 가능한 경우 최소 인용 + 링크 + 자체 요약을 저장한다. 플랫폼별 자동수집 허용 여부는 connector 구현 전에 별도 검토한다.

## Point-in-time rule

모든 데이터는 `event_time`과 `available_time`을 분리한다.

예: 경기가 8월 1일 열렸더라도 데이터 공급자가 8월 2일에 제공했다면, 8월 1일 시점 백테스트에서 그 레코드를 사용할 수 없다.

```text
feature_cutoff = min(event_time, available_time policy)
```

실제 구현에서는 `available_at <= simulation_cutoff`가 모든 backtest query의 필수 조건이다.

## Phase 1에서 바로 사용

1. Data Dragon patch snapshots
2. Riot 공식 patch notes metadata
3. Oracle's Elixir historical pro matches + QA layer
4. synthetic team-private data

## Phase 1에서 보류

- 무차별 SNS 크롤링
- 비공개/불확실 프로 계정 추적
- 장인 발언을 모델 label로 사용
- 중국 서버 등 공식 접근 경로가 불명확한 데이터를 억지로 통합

## Go / No-Go

Phase 1로 넘어가기 위한 최소 조건:
- 최소 3개 시즌의 프로 경기 데이터가 동일 schema로 적재 가능
- patch mapping QA 통과
- selected tournament에서 draft 데이터 spot-check 통과
- point-in-time cutoff 테스트 자동화
- source provenance 100% 기록

하나라도 실패하면 모델링보다 데이터 파이프라인을 먼저 수정한다.
