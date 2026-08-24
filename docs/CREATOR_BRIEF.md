# Creator Mode brief

## Contract

The Creator brief is a deterministic narrative packet derived only from sample-eligible Meta Radar
entries. It prepares grounded material for a human analyst or an optional future AI drafting step; it
does not create a finished video and is never publication-ready by itself.

Each topic candidate contains:

- title and thumbnail-copy candidates,
- a hook and chapter outline,
- approved claims with exact metric values,
- a counterpoint and future falsifiers,
- data-card specifications,
- a short-form summary,
- quality flags and original evidence event IDs,
- an explicit `HUMAN_REVIEW_REQUIRED` state.

Ineligible Radar entries are not promoted into topics. If no candidate passes the sample gates, the
brief emits `NO_ELIGIBLE_CANDIDATES` instead of manufacturing a story.

## AI boundary

The `ai_handoff` section allows a later provider adapter to rephrase approved claims, expand the
approved outline, or translate text while preserving numbers. It forbids inventing evidence,
claiming champion strength or causality, removing counterpoints, or publishing without human review.

No API key, provider, or model is needed in this increment. Future BYO-key support must record the
provider/model/template version, disclose what text leaves the system, store secrets outside source
control and logs, and preserve the deterministic brief as the input artifact.

## CLI

```bash
python -m pro_meta_intelligence build-creator-brief \
  --radar outputs/meta-radar/current.json \
  --top-k 3 \
  --output outputs/creator/current.json
```

`refresh-feed` performs this transformation automatically and stores the matching brief beside every
immutable Radar snapshot.
