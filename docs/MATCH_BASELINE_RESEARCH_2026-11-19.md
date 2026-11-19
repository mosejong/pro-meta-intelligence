# Match Baseline Research — 2026-11-19 (offline only)

Status: **tool implemented; real-data run NOT executed. No performance numbers exist yet.**
Nothing here shows that any model works. The parent Codex session runs the CLI after it
checks the real file hash and metadata.

Flags carried in every report: `NO_UI_EFFECT`, `NOT_CAUSAL_DRAFT_VALUE`, `NOT_A_RELEASED_PREDICTOR`.

## Purpose

This tool sets the minimum win/loss floor on real observed 2026 games. Any later model has to
beat that floor before anyone claims it predicts outcomes. The floor is kept separate from the
UI's assumption engine. It is not a user-facing prediction, a player-effect estimate, a causal
estimate of pick/ban value, or a shipped learned model.

## Files

- `ops/benchmark_match_baselines.py`: pure functions (`clean_records`, `simulate`, `score`,
  `summarize`, `assess`) plus the CLI.
- `tests/test_match_baselines.py`: synthetic unit tests only.

## Fixed configuration (no per-epoch retuning)

| Item | Value |
|---|---|
| Season | `observed_at` (UTC) year 2026 |
| Leagues | LCK, LPL, LEC, LCS, LCP, WLDs, MSI, FST, EWC |
| Evaluation start | 2026-07-01T00:00Z; earlier in-scope games are warm-up only and never scored |
| Simulated publication delay | 24h: a target at `t` uses only results with `observed_at + 24h <= t` |
| Same-time games | never see each other's results (the delay is strictly positive) |
| Baselines | `fixed_half` = 0.5; `blue_laplace` = (blueWins+1)/(games+2) over published games; `team_elo` initial 1500, K 20, scale 400 |
| Join key | team ID only; names are never used for joins |
| Mature cohort | both teams have at least 5 published prior games (reported **in addition to** all targets, never instead) |
| Log loss | probabilities clamped to [1e-12, 1-1e-12] |

Elo: each in-scope game (warm-up included) gets an expected `p`, frozen at its own `observed_at`.
When its result is published (`observed_at + 24h`), the ratings update by `K*(y - p_frozen)`.
The target's own winner is used only as the scoring label.

Unused inputs: rosters, players, champions, in-game stats, KDA, gold.

## Availability caveat (kept separate)

The adapter sets every record's `available_at` to the local CSV retrieval time. The 24h delay is
a **simulation assumption**. It does **not** reproduce what was actually public when each game
was played.

## Data hygiene

- Input comes only from the existing local OE CSV, read through
  `OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(..., retrieved_at=<explicit>, source_timezone="UTC")`.
  The tool makes no network calls and uses no new sources, APIs or keys.
- If a match ID appears with differing content, every copy is excluded
  (`conflicting_duplicate_*`). Exact duplicates are collapsed to one copy.
- Rejected records: winner not one of the two teams, same team on both sides, blank IDs, naive
  timestamps, `available_at < observed_at`, provenance hash different from the verified hash.
  Out-of-scope season or league is counted separately.
- The report holds only aggregates: the reason counts above, per-cohort and per-league sample /
  Brier / logloss / `accuracy_with_half_credit_ties` (p = 0.5 scores 0.5) / `tie_count`. It
  contains no raw rows, tokens or keys.

## CLI

```
python ops/benchmark_match_baselines.py --input <local OE csv> \
  --retrieved-at <ISO with tz> --content-hash <sha256> --output outputs/<new>.json
```

The CLI checks the sha256 before importing and refuses on a mismatch. It refuses `web/public`
output paths, non-`.json` paths and any existing file, so earlier reports are never overwritten.
The report records the source hash, the actual `retrieved_at`, the fixed configuration, the
delay assumption, the evaluation window, exclusion reasons, per-cohort samples and the three
claim flags.

## Verification status

The synthetic tests were written for these cases:
- changing future winners leaves earlier predictions unchanged
- no result is used before it is published (exact 24h boundary)
- same-time games are isolated
- hand-computed Laplace and Elo values match
- shuffling input order and renaming teams do not change the output, and the input is not mutated
- duplicate and conflict handling
- invalid-record reasons
- warm-up and scope separation, plus the mature cohort
- probability validation and the log-loss clamp
- CLI refusals: hash mismatch, `web/public`, existing output, naive `retrieved_at`

**These tests have not been run yet.** The pytest command needed approval in this session and
was not retried. Run them before relying on the tool:
`python -m pytest tests/test_match_baselines.py -q`.

Real-data results: **not executed.**


## Codex 검토 및 실제 실행

관련 합성/실제 어댑터 fixture 13개와 ruff를 통과했다. 기존 어댑터가 `sha256:` 접두사를 포함하는 것을 실제 실행에서 확인해, 정확한 digest 비교는 유지하면서 표현만 정규화했다. 수정 전 실패 결과를 성능 결과로 사용하지 않았다.

가장 최근에 로컬 보관한 파일은 2022 자료였다. 날짜가 최신이라고 2026 자료로 간주하면 안 된다. 이 파일로 나온 0평가표본 보고서는 그대로 보존했고, 도구에 `NO_EVALUATION_TARGETS` 상태와 연도 밖 자료 회귀 검사를 추가했다. 실제 평가는 2026 공개 파일의 보관본 `fcd2e451…` / 실제 수집시각 `2026-11-11T02:19:29.155420+00:00`를 해시 확인한 뒤 실행했다. 최신 결승까지 포함한 연간 전체 자료라는 뜻이 아니다.

- 로컬 결과: `outputs/match-baseline-2026-fcd2-research-20261119.json`
- 대상 리그 허용집합의 유효 경기 2,456개 중 워밍업 1,578개, 평가 878개.
- 평가 관측기간: 2026-07-01 08:10:16 UTC ~ 2026-11-10 09:49:05 UTC.
- 기존 어댑터가 수용한 경기만 사용한다. 전체 대회 완전 수집을 주장하지 않는다.
- 실제 수집시점이 아닌 `경기 시각+24시간`을 공개 지연으로 가정한 연구다.

| 기준선 | Brier 오차(낮을수록 좋음) | 로그 오차 | 동률 반점 처리 적중률 |
| --- | --- | --- | --- |
| 항상 0.5 | 0.250000 | 0.693147 | 0.500000 |
| 이전 공개 경기의 블루 비율 | 0.243822 | 0.680758 | 0.587699 |
| 팀 ID Elo | 0.235459 | 0.662704 | 0.593394 |

| 리그 | 평가 경기 | 팀 Elo Brier | 항상 0.5 Brier |
| --- | --- | --- | --- |
| LCK | 153 | 0.262017 | 0.250000 |
| LPL | 166 | 0.239012 | 0.250000 |
| LEC | 137 | 0.216316 | 0.250000 |
| LCS | 126 | 0.225188 | 0.250000 |
| LCP | 83 | 0.222290 | 0.250000 |
| WLDs | 106 | 0.232673 | 0.250000 |
| MSI | 56 | 0.229135 | 0.250000 |
| EWC | 51 | 0.255188 | 0.250000 |

전체 평균의 개선만으로 출시할 수 없다. LCK와 EWC에서는 팀 Elo가 단순 0.5 기준보다도 나빴다. 선수 변경이나 밴픽의 효과를 식별한 모델도 아니고, 통계적 유의성·확률 보정·새 미공개 기간에 대한 성능을 입증한 것도 아니다. 현재 웹 가정 엔진에는 이 값을 넣지 않는다. 후속 모델은 전체와 리그별 기준을 함께 비교하고, 이미 본 평가 구간을 최종 독립 검증으로 재사용했다고 주장하지 않아야 한다.
