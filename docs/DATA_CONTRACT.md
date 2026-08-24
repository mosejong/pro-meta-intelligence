# Data Contract v0

## Non-negotiable fields

모든 분석 가능한 레코드는 아래 provenance를 가져야 한다.

```text
source_id
source_type
source_uri
source_version
retrieved_at
event_time
available_at
content_hash
schema_version
```

`available_at`을 알 수 없는 historical source는 backtest에서 보수적 availability policy를 적용하고 정책명을 함께 기록한다.

## Core entities

### PatchSnapshot
```text
patch_id
release_at
region
champion_state_version
item_state_version
rune_state_version
source_id
```

### ProGame
```text
game_id
series_id
league
tournament
stage
start_time
patch_id
blue_team_id
red_team_id
blue_team_name_if_available
red_team_name_if_available
winner_team_id
source_id
available_at
```

### DraftEvent
```text
game_id
sequence
team_id
side
action_type  # PICK/BAN
champion_id
role_if_resolved
```

For OE bans, `role_if_resolved=UNKNOWN` is an explicit value rather than a role guess. Pick and ban
sequences each use their own standard global `1-10` order.

### SoloQObservation
```text
platform_region
queue
tier_bucket
patch_id
window_start
window_end
champion_id
role
pick_count
ban_count
win_count
game_count
```

### PlayerChampionObservation
공개적으로 식별 가능한 선수/계정만 허용한다.
```text
player_id
account_evidence_id
champion_id
role
patch_id
window
matches
recency
```

### ExpertEvidence
```text
evidence_id
champion_id
role
patch_id
claim_type
claim_summary_ko
original_language
source_uri
published_at
available_at
confidence_tier
```

### CandidateScore
```text
snapshot_id
champion_id
role
meta_strength
adoption_velocity
regional_divergence
expert_signal
historical_similarity
familiarity_proxy
review_cost_proxy
final_priority
confidence_tier
```

점수는 처음부터 probability로 정의하지 않는다.

## Private layer

```text
TeamPrivateObservation
- team_namespace
- event_type
- occurred_at
- champion_id
- player_slot
- context
- outcome
- analyst_note
```

Public pipeline과 물리적/논리적으로 분리 가능한 adapter boundary를 유지한다. 데모 데이터는 `synthetic=true`를 강제한다.

## Identity policy

- public evidence가 없는 프로 선수 계정 연결 금지
- alias mapping마다 evidence URL과 verified_at 기록
- 추정 mapping은 production feature에서 제외
- identity correction history 보존

## Translation policy

번역된 해외 평가는 원문을 대체하지 않는다.

```text
original -> normalized claim -> ko summary
```

UI에서는 가능하면 원출처로 돌아갈 수 있어야 하며, 모델은 한국어 요약만 보고 원문보다 강한 주장을 만들 수 없다.
