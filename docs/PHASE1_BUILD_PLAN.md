# Phase 1 Build Plan — Evidence Before AI

## Goal

첫 번째 작동 버전의 목표는 챗봇이 아니다.

> 한 historical cutoff를 선택하고, 그 시점까지의 프로/패치 데이터를 재현 가능하게 적재한 뒤 baseline candidate ranking을 생성한다.

## Milestone 1 — repository engineering

예정 구조:

```text
src/pro_meta_intelligence/
  ingestion/
  normalization/
  features/
  scoring/
  backtest/
  provenance/
tests/
configs/
data/README.md
scripts/
```

구현 시 패키지 경로는 Issue #2 및 Phase 1 이관 명세의 정식 이름인
`pro_meta_intelligence`를 따른다. 기존 `pro_meta` 표기는 축약 예시로 간주한다.

원천 대용량 데이터는 Git에 커밋하지 않는다.

## Milestone 2 — pro match ingestion

- Oracle's Elixir adapter
- schema normalization
- source hash
- patch/date QA
- game/team/player cardinality QA
- deterministic parquet output

## Milestone 3 — patch snapshots

- Data Dragon version resolver
- patch snapshot manifest
- champion/item static state
- immutable snapshot storage

## Milestone 4 — first baseline

처음부터 ML/LLM을 사용하지 않는다.

후보 점수 v0:

```text
score =
  w1 * recent_pro_presence_delta
+ w2 * regional_divergence
+ w3 * patch_change_signal
- w4 * already_meta_penalty
```

이 점수가 historical events에서 어떤 성능을 내는지 먼저 측정한다.

## Milestone 5 — SoloQ

Riot API key/정책을 확정한 뒤 별도 adapter로 추가한다. Phase 1 baseline이 작동하기 전에는 대규모 수집을 시작하지 않는다.

## Milestone 6 — expert evidence

자동 크롤러보다 evidence schema + 수동 curated seed set을 먼저 만든다. 가치가 검증된 플랫폼만 connector를 구현한다.

## Milestone 7 — Strategy Agent

정형 분석이 신뢰 가능한 뒤에만 추가한다.
Agent는 계산을 대신하지 않는다. snapshot-scoped tools를 호출하고 evidence를 설명한다.

## Milestone 8 — Multi-agent Harness

Single Agent baseline을 만든 뒤 독립 agent와 skeptic/judge를 추가한다. 비용/성능 ablation 결과가 없으면 multi-agent를 제품 핵심이라고 주장하지 않는다.

## First demo acceptance criteria

- 동일 cutoff + 동일 config => 동일 candidate ranking
- 모든 candidate가 evidence/provenance로 추적됨
- 미래 데이터 retrieval 테스트 0건
- baseline 결과를 성공/실패 모두 출력
- `why`, `why not`, `what would change this decision` 세 질문에 evidence 기반 응답 가능

## Deferred intentionally

- T1 branding
- 실제 scrim이라고 오해할 수 있는 데이터
- 예쁜 챗 UI 우선 개발
- 무제한 SNS crawling
- 근거 없는 선수 숙련도 숫자
- 감독 개인 성향 단정
