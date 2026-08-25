"""Public-safe human-decision outcome feed derived from the walk-forward benchmark."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def build_decision_outcomes(benchmark: dict[str, Any]) -> dict[str, Any]:
    if benchmark.get("benchmark_kind") != "OE_WALK_FORWARD_BLIND_SPOT":
        raise ValueError("decision outcomes require an OE walk-forward benchmark report")
    history = benchmark.get("history_readiness")
    if not isinstance(history, dict) or not isinstance(history.get("collection"), dict):
        raise ValueError("benchmark report is missing history collection metadata")
    candidate_policy = benchmark.get("candidate_policy")
    outcome_policy = benchmark.get("outcome_policy")
    if not isinstance(candidate_policy, dict) or not isinstance(outcome_policy, dict):
        raise ValueError("benchmark report is missing candidate or outcome policy")

    benchmark_ready = benchmark.get("benchmark_ready") is True
    raw_cutoffs = benchmark.get("cutoffs")
    if not isinstance(raw_cutoffs, list):
        raise ValueError("benchmark cutoffs must be a list")
    evaluations = [_public_evaluation(item) for item in raw_cutoffs] if benchmark_ready else []
    summary = {
        "evaluated_cutoff_count": len(evaluations),
        "selected_candidate_count": sum(len(item["selected_candidates"]) for item in evaluations),
        "hit_count": sum(
            candidate["outcome"] == "HIT"
            for item in evaluations
            for candidate in item["selected_candidates"]
        ),
        "false_alert_count": sum(
            candidate["outcome"] == "FALSE_ALERT"
            for item in evaluations
            for candidate in item["selected_candidates"]
        ),
        "missed_adoption_count": sum(len(item["missed_adoptions"]) for item in evaluations),
    }
    collection = history["collection"]
    return {
        "schema_version": "1",
        "artifact_type": "team-decision-outcomes",
        "source_id": benchmark.get("source_id"),
        "as_of": collection.get("last_retrieved_at"),
        "status": "COMPLETE" if benchmark_ready else benchmark.get("status"),
        "benchmark_ready": benchmark_ready,
        "candidate_policy": {
            "ranking": candidate_policy.get("ranking"),
            "top_k": candidate_policy.get("top_k"),
            "maximum_pre_cutoff_pick_presence": candidate_policy.get(
                "maximum_pre_cutoff_pick_presence"
            ),
            "presence_filter_applies_before_top_k": candidate_policy.get(
                "presence_filter_applies_before_top_k"
            ),
        },
        "outcome_policy": {
            "event": outcome_policy.get("event"),
            "same_patch_only": outcome_policy.get("same_patch_only"),
            "minimum_future_picks": outcome_policy.get("minimum_future_picks"),
            "minimum_future_distinct_teams": outcome_policy.get("minimum_future_distinct_teams"),
            "confirmation_time": outcome_policy.get("confirmation_time"),
        },
        "summary": summary,
        "evaluations": evaluations,
        "boundary": (
            "Only matured point-in-time benchmark outcomes are published. Human journal state is "
            "never uploaded, private team data is not inferred, and no raw archive path or "
            "provider row is included."
        ),
    }


def publish_decision_outcomes(feed_dir: Path, outcomes: dict[str, Any]) -> Path:
    path = feed_dir / "decision-outcomes.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(outcomes, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return path


def _public_evaluation(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("benchmark cutoff must be an object")
    required_strings = ("cutoff", "outcome_end", "patch_id")
    if any(not isinstance(value.get(field), str) for field in required_strings):
        raise ValueError("benchmark cutoff identity is incomplete")
    selected = value.get("selected_candidates")
    actual = value.get("actual_adoptions")
    failures = value.get("failure_cases")
    metrics = value.get("metrics")
    source_versions = value.get("radar_source_versions")
    if not all(isinstance(item, list) for item in (selected, actual, failures, source_versions)):
        raise ValueError("benchmark cutoff evidence lists are incomplete")
    if not isinstance(metrics, dict):
        raise ValueError("benchmark cutoff metrics are incomplete")

    adoptions = {
        (item.get("champion_id"), item.get("role")): item
        for item in actual
        if isinstance(item, dict)
    }
    selected_payload = [_selected_candidate(item, adoptions) for item in selected]
    missed_payload = [
        _missed_adoption(item, adoptions)
        for item in failures
        if isinstance(item, dict) and item.get("type") == "MISSED_ADOPTION"
    ]
    return {
        "evaluation_id": f"{value['patch_id']}::{value['cutoff']}",
        "cutoff": value["cutoff"],
        "outcome_end": value["outcome_end"],
        "patch_id": value["patch_id"],
        "selected_candidates": selected_payload,
        "missed_adoptions": missed_payload,
        "metrics": {
            key: metrics.get(key)
            for key in (
                "recall_at_k",
                "precision_at_k",
                "false_alert_rate",
                "hit_count",
                "miss_count",
                "target_count",
                "selected_count",
                "median_lead_time_hours",
            )
        },
        "source_versions": [_source_version(item) for item in source_versions],
    }


def _selected_candidate(
    value: object,
    adoptions: dict[tuple[object, object], dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("selected benchmark candidate must be an object")
    outcome = value.get("outcome")
    if outcome not in {"HIT", "FALSE_ALERT"}:
        raise ValueError("selected benchmark candidate has an unsupported outcome")
    champion_id = value.get("champion_id")
    role = value.get("role")
    if not isinstance(champion_id, str) or not isinstance(role, str):
        raise ValueError("selected benchmark candidate identity is incomplete")
    adoption = adoptions.get((champion_id, role)) if outcome == "HIT" else None
    if outcome == "HIT" and adoption is None:
        raise ValueError("benchmark HIT is missing its actual adoption evidence")
    evidence_event_ids = _string_list(value.get("evidence_event_ids"), "candidate evidence")
    return {
        "champion_id": champion_id,
        "role": role,
        "radar_rank": value.get("rank"),
        "outcome": outcome,
        "candidate_evidence_event_ids": evidence_event_ids,
        "pre_cutoff": {
            "pick_presence": value.get("current_pick_presence"),
            "pick_presence_delta": value.get("pick_presence_delta"),
            "demand_velocity": value.get("demand_velocity"),
        },
        "confirmed_at": adoption.get("confirmed_at") if adoption else None,
        "future_pick_count": adoption.get("future_pick_count") if adoption else None,
        "future_distinct_team_count": (
            adoption.get("future_distinct_team_count") if adoption else None
        ),
        "outcome_match_ids": _string_list(adoption.get("outcome_match_ids"), "outcome matches")
        if adoption
        else [],
        "outcome_event_ids": _string_list(adoption.get("outcome_event_ids"), "outcome events")
        if adoption
        else [],
    }


def _missed_adoption(
    value: dict[str, Any],
    adoptions: dict[tuple[object, object], dict[str, Any]],
) -> dict[str, Any]:
    champion_id = value.get("champion_id")
    role = value.get("role")
    if not isinstance(champion_id, str) or not isinstance(role, str):
        raise ValueError("missed benchmark adoption identity is incomplete")
    adoption = adoptions.get((champion_id, role), value)
    return {
        "champion_id": champion_id,
        "role": role,
        "confirmed_at": adoption.get("confirmed_at"),
        "future_pick_count": adoption.get("future_pick_count"),
        "future_distinct_team_count": adoption.get("future_distinct_team_count"),
        "outcome_match_ids": _string_list(adoption.get("outcome_match_ids"), "outcome matches"),
        "outcome_event_ids": _string_list(adoption.get("outcome_event_ids"), "outcome events"),
    }


def _source_version(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("benchmark source version must be an object")
    source_id = value.get("source_id")
    source_version = value.get("source_version")
    content_hash = value.get("content_hash")
    if not all(
        isinstance(item, str) and item for item in (source_id, source_version, content_hash)
    ):
        raise ValueError("benchmark source version identity is incomplete")
    if not content_hash.startswith("sha256:") or len(content_hash) != 71:
        raise ValueError("benchmark source content hash is invalid")
    return {
        "source_id": source_id,
        "source_version": source_version,
        "content_hash": content_hash,
    }


def _string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"benchmark {label} must be a string list")
    return list(value)
