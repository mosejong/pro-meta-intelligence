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

## Public human-baseline workbench

The Creator surface includes a device-local workbench for collecting the human side of future
paired cases. It deliberately shows no reference answer and no AI output. A participant selects
claims, source event IDs, and interpretation boundaries from one immutable published snapshot;
active completion time is recorded between starting and saving the task.

The browser stores at most 60 unique snapshot/champion/role drafts in local storage. It does not
collect an analyst name, account, API key, free-form personal text, or send drafts to the server.
The participant can export or delete the local bundle at any time.

An exported `ai-human-baseline-draft-bundle` is **not** accepted by the release evaluator and does
not increase the public `paired_holdout_case_count`. Every draft is marked
`HUMAN_BASELINE_ONLY`, `contains_expert_reference=false`, `contains_ai_output=false`, and
`ready_for_release_evaluation=false`. A separate offline curation step must lock an expert
reference, add output from the pinned AI system on the same task, assign the final split, and
produce the private input contract below. This separation prevents public collection from leaking
or silently redefining the holdout answer.

## Blinded offline assembly

Prepare two independent, fingerprint-locked templates from the exported human bundle. Keep every
file in a private directory; never place a human draft, expert answer, AI output, prompt, or paired
run under `web/public`.

```bash
python -m pro_meta_intelligence prepare-ai-holdout \
  --human-baselines private/human-baselines.json \
  --reference-template private/expert-reference-template.json \
  --ai-template private/ai-output-template.json \
  --output private/preparation-summary.json
```

The expert fills only the reference template. The pinned AI runner fills only the AI template and
its provider/model/model-version/prompt-version metadata. Neither template contains the human
selection. Both contain the same immutable task and SHA-256 task fingerprint, so the assembler
rejects missing, additional, duplicated, or changed cases instead of joining them by position.

After the two paths are complete, assemble the private evaluator input:

```bash
python -m pro_meta_intelligence assemble-ai-holdout \
  --human-baselines private/human-baselines.json \
  --expert-references private/expert-references.json \
  --ai-outputs private/ai-outputs.json \
  --output private/paired-holdout.json
```

The assembler hashes private task keys into case IDs, verifies every expert requirement against the
frozen choices, pins the system metadata, and keeps invented AI IDs so the deterministic evaluator
can count them as critical errors. It refuses to write raw output inside `web/public`.

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
