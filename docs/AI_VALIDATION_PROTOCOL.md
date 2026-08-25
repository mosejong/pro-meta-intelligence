# AI validation protocol

## Release claim

The product may call an AI-assisted path **validated** only after it completes the same hidden,
point-in-time tasks as a human analyst and passes every release gate. A fast output that invents one
claim does not pass. A correct output that saves no analyst time does not pass. Before validation,
the deterministic data pipeline remains active and AI-generated analysis stays hidden.

This follows the evaluation pattern in the official OpenAI guide: define desired behavior, use a
representative test set, and compare outputs with human-provided ground truth. The local gate is
provider-neutral and does not require an API key.

Reference: [Working with evals](https://developers.openai.com/api/docs/guides/evals/)

## Why the primary grader is deterministic

The first AI tasks are structured evidence-selection tasks. Their output is a set of claim,
evidence, and boundary IDs. Those IDs can be compared directly with a frozen expert reference, so
the release decision does not depend on another language model grading persuasive prose.

Human qualitative review remains useful for style, nuance, and workflow feedback, but it cannot
override a failed critical gate.

## Paired holdout procedure

1. Select at least 30 representative cases from immutable snapshots. Keep `DEV` cases separate
   from `HOLDOUT` cases.
2. Freeze allowed and required claim IDs, evidence IDs, and boundary IDs before either participant
   sees the task.
3. Give the human and AI path the same snapshot-scoped input. Do not expose the reference answer.
4. Record active completion time, whether the result was accepted without editing, and any
   expert-confirmed critical errors.
5. Pin provider, model, model version, and prompt version in the private run input.
6. Run the evaluator. Only the aggregate status, metrics, gates, and SHA-256 fingerprints may be
   published; prompts, raw outputs, analyst identity, credentials, and case IDs stay private.

## Release gates

| Gate | Required result |
| --- | --- |
| Paired hidden sample | At least 30 `HOLDOUT` cases |
| Claim accuracy | AI macro F1 at least 0.90 and no more than 0.02 below the paired human result |
| Evidence accuracy | AI macro F1 at least 0.90 and no more than 0.02 below the paired human result |
| Critical errors | Zero unsupported claims, missing required boundaries, or expert critical errors |
| Boundary retention | 100% of required data/uncertainty boundaries retained |
| Human time saved | AI median time at most 50% of human time and faster on at least 80% of cases |
| Edit burden | At least 80% accepted without edit |
| Reproducibility | Provider, model, model version, and prompt version pinned |

`NOT_VALIDATED` means the holdout is not yet large enough. `REJECTED` means enough cases exist but
at least one gate failed. Only `VALIDATED` sets `ai_features_enabled=true`.

## Input contract

The evaluator accepts one private JSON object:

```json
{
  "schema_version": "1",
  "artifact_type": "ai-human-paired-evaluation",
  "run_id": "holdout-2026-09",
  "task_type": "EVIDENCE_LOCKED_BRIEF",
  "evaluated_at": "2026-09-10T09:00:00Z",
  "system": {
    "provider": "provider-name",
    "model": "model-name",
    "model_version": "pinned-version",
    "prompt_version": "brief-v1"
  },
  "cases": [
    {
      "case_id": "private-case-id",
      "split": "HOLDOUT",
      "reference": {
        "required_claim_ids": ["CLAIM:OBSERVED"],
        "allowed_claim_ids": ["CLAIM:OBSERVED", "CLAIM:COUNTERPOINT"],
        "required_evidence_ids": ["EVENT:1"],
        "allowed_evidence_ids": ["EVENT:1", "EVENT:2"],
        "required_boundary_ids": ["BOUNDARY:PUBLIC_ONLY"]
      },
      "human": {
        "claim_ids": ["CLAIM:OBSERVED"],
        "evidence_ids": ["EVENT:1"],
        "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
        "critical_error_ids": [],
        "duration_seconds": 180,
        "accepted_without_edit": true
      },
      "ai": {
        "claim_ids": ["CLAIM:OBSERVED"],
        "evidence_ids": ["EVENT:1"],
        "boundary_ids": ["BOUNDARY:PUBLIC_ONLY"],
        "critical_error_ids": [],
        "duration_seconds": 45,
        "accepted_without_edit": true
      }
    }
  ]
}
```

Run it with:

```bash
python -m pro_meta_intelligence evaluate-ai-assistant \
  --input private/paired-holdout.json \
  --output web/public/feed/ai-validation.json
```

The command returns exit code `0` only for `VALIDATED`; `NOT_VALIDATED` and `REJECTED` return `2`.
No provider request is made by this command.

## Revalidation

Any model, model version, prompt version, tool contract, source schema, or grader-policy change
invalidates the previous system fingerprint. The changed path must run the sealed holdout again.
Production monitoring validates that the public status remains fail-closed, but it does not claim
the AI is accurate when the status is only available and well formed.
