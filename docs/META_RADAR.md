# Phase 2 Explainable Meta Radar

## Scope

The Meta Radar turns point-in-time professional match and pick records into a deterministic,
patch-level analyst snapshot. It answers what changed and where the change is concentrated without
an LLM, learned model, or hidden composite score.

This increment is a machine-readable analyst page. A visual UI is deferred until the metric contract
has been exercised on larger snapshots.

## Window and patch contract

Inputs are filtered first by `available_at <= cutoff`. The selected patch is either explicit or the
patch on the latest available match. Only that patch enters two adjacent windows:

```text
prior  = (cutoff - recent_days - prior_days, cutoff - recent_days]
recent = (cutoff - recent_days, cutoff]
```

Both boundaries and all match IDs are written to the report. Records unavailable at the cutoff are
counted as excluded and cannot create a candidate.

## Metrics

All metrics operate on champion-role picks. Oracle's Elixir bans are not included because a banned
champion has no reliable source role in the current adapter.

### Pick presence

```text
pick presence = unique matches containing the champion-role pick / matches in the window
pick presence delta = recent pick presence - prior pick presence
```

This is deliberately named pick presence rather than total pick/ban presence.

### Demand and demand velocity

```text
demand = distinct teams picking the champion-role / active teams in the window
demand velocity = recent demand - prior demand
```

Demand measures breadth across teams, not strength or stage readiness. A repeated pick by one team
does not increase distinct-team demand.

### Team concentration

```text
team concentration = largest single-team pick count / all recent champion-role picks
```

A value near one means that current evidence depends heavily on one team. It is not evidence that
the team caused the wider meta.

### Regional divergence

For every mapped region with enough recent matches:

```text
regional delta = region pick presence - global pick presence
regional divergence = max(abs(regional delta))
```

The report preserves the signed delta and most divergent region. Ties prefer the positive delta and
then alphabetical region name. This deterministic tie rule avoids silently presenting a lagging
region when an equally strong leading region exists.

## No composite score

Entries do not contain an invented confidence or overall score. Their display order is explicitly:

1. sample-eligible entries first,
2. demand velocity descending,
3. pick presence delta descending,
4. regional divergence descending,
5. current pick presence descending,
6. champion and role alphabetically for deterministic ties.

Consumers can inspect every component rather than reverse-engineering weights.

## Quality flags

Computed values remain visible when samples are weak, but the entry is not marked review-eligible
when a critical threshold fails:

- `INSUFFICIENT_RECENT_MATCHES`
- `INSUFFICIENT_PRIOR_MATCHES`
- `LOW_CURRENT_PICK_COUNT`

Non-critical context flags are also preserved:

- `INSUFFICIENT_REGIONAL_SAMPLES`
- `UNMAPPED_LEAGUE_EVIDENCE`

Unknown leagues remain in global metrics but are excluded from regional comparison and listed in the
top-level quality section.

## League-region mapping

`config/league_regions.json` contains small analytical buckets for common league IDs. These are
configuration, not an assertion about league ownership or official regional taxonomy. Supply a
different mapping with `--region-map`; unknown identifiers fail visibly rather than being guessed.

Expected format:

```json
{
  "schema_version": "1",
  "leagues": {
    "LCK": "KOREA",
    "LEC": "EMEA"
  }
}
```

## CLI

```bash
python -m pro_meta_intelligence build-radar \
  --input outputs/oracles-elixir/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --retrieved-at 2026-08-22T03:00:00Z \
  --cutoff 2026-08-22T03:00:00Z \
  --patch 16.15 \
  --output outputs/meta-radar/16.15.json
```

The importer and radar share the same policy gate. The output includes import QA, source hashes,
window match IDs, per-entry pick-event IDs, formulas, thresholds, and ranking policy.

## Acceptance evidence

The deterministic multi-region scenario covers:

- four prior and four recent matches across LCK/KOREA and LEC/EMEA,
- a rising champion-role signal,
- a geographically concentrated signal,
- a one-team concentration calculation,
- a low-sample candidate,
- an event unavailable at cutoff that cannot create a candidate,
- an unmapped league that remains visible,
- malformed event-to-match linkage rejection,
- byte-for-byte deterministic JSON.

## Limitations and next gate

- Current Oracle's Elixir annual files still cannot reconstruct availability before retrieval.
- The checked-in default region map is intentionally small and overrideable.
- Full-year runtime and output-size benchmarks remain pending on a locally downloaded real file.
- Ban deltas remain pending a validated role-aware contract.
- This report measures adoption patterns, not champion strength, draft correctness, or causality.
- The next benchmark must freeze meaningful review/adoption labels before inspecting holdout results.
