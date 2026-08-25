"""Compact, public-safe history readiness status derived from a benchmark report."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


def build_history_status(benchmark: dict[str, Any]) -> dict[str, Any]:
    if benchmark.get("benchmark_kind") != "OE_WALK_FORWARD_BLIND_SPOT":
        raise ValueError("history status requires an OE walk-forward benchmark report")
    history = benchmark.get("history_readiness")
    if not isinstance(history, dict):
        raise ValueError("benchmark report is missing history_readiness")
    collection = history.get("collection")
    criteria = history.get("criteria")
    if not isinstance(collection, dict) or not isinstance(criteria, dict):
        raise ValueError("history readiness is missing collection or criteria")

    gates = (
        _gate(
            "RETRIEVALS",
            collection["retrieval_count"],
            criteria["minimum_retrievals"],
            "snapshots",
        ),
        _gate(
            "UNIQUE_STATES",
            collection["unique_normalized_state_count"],
            criteria["minimum_unique_states"],
            "states",
        ),
        _gate(
            "COLLECTION_SPAN",
            round(collection["collection_span_hours"] / 24, 3),
            criteria["minimum_collection_span_days"],
            "days",
        ),
        _gate(
            "MATURED_CUTOFFS",
            collection["matured_cutoff_count"],
            criteria["minimum_matured_cutoffs"],
            "cutoffs",
        ),
    )
    benchmark_ready = bool(benchmark.get("benchmark_ready"))
    history_ready = bool(history.get("ready"))
    collection_summary = _collection_summary(collection)
    forecast = _readiness_forecast(collection, criteria, gates)
    return {
        "schema_version": "1",
        "artifact_type": "oe-history-status",
        "source_id": benchmark.get("source_id"),
        "as_of": collection.get("last_retrieved_at"),
        "status": benchmark.get("status"),
        "history_ready": history_ready,
        "benchmark_ready": benchmark_ready,
        "gates": list(gates),
        "gate_progress_percent": _gate_progress(gates),
        "collection": collection_summary,
        "continuity": {
            "status": _continuity_status(collection, history),
            "maximum_gap_hours": criteria["maximum_gap_hours"],
            "next_collection_due_at": forecast["next_collection_due_at"],
            "continuity_deadline_at": forecast["continuity_deadline_at"],
        },
        "forecast": forecast,
        "blocking_reasons": list(history.get("blocking_reasons", [])),
        "warnings": list(history.get("warnings", [])),
        "next_action": _next_action(gates, history_ready, benchmark_ready),
        "aggregate": benchmark.get("aggregate") if benchmark_ready else None,
        "boundary": (
            "Operational collection readiness only; not evidence that the Radar predicts adoption."
        ),
    }


def publish_history_status(feed_dir: Path, status: dict[str, Any]) -> Path:
    path = feed_dir / "history-status.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
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


def _gate(gate_id: str, current: int | float, required: int | float, unit: str):
    return {
        "id": gate_id,
        "current": current,
        "required": required,
        "unit": unit,
        "passed": current >= required,
    }


def _next_action(gates, history_ready: bool, benchmark_ready: bool) -> str:
    by_id = {gate["id"]: gate for gate in gates}
    if not by_id["RETRIEVALS"]["passed"] or not by_id["COLLECTION_SPAN"]["passed"]:
        return "KEEP_DAILY_COLLECTION"
    if not by_id["UNIQUE_STATES"]["passed"]:
        return "WAIT_FOR_DISTINCT_SOURCE_STATES"
    if not by_id["MATURED_CUTOFFS"]["passed"]:
        return "WAIT_FOR_OUTCOME_HORIZON"
    if history_ready and not benchmark_ready:
        return "REVIEW_SKIPPED_CUTOFFS"
    return "REVIEW_BENCHMARK_RESULTS" if benchmark_ready else "REVIEW_HISTORY_BLOCKERS"


def _collection_summary(collection: dict[str, Any]) -> dict[str, Any]:
    return {
        "retrieval_count": collection["retrieval_count"],
        "unique_normalized_state_count": collection["unique_normalized_state_count"],
        "collection_span_days": round(collection["collection_span_hours"] / 24, 3),
        "matured_cutoff_count": collection["matured_cutoff_count"],
        "first_retrieved_at": collection.get("first_retrieved_at"),
        "last_retrieved_at": collection.get("last_retrieved_at"),
    }


def _gate_progress(gates: tuple[dict[str, Any], ...]) -> int:
    ratios = [
        min(1.0, float(gate["current"]) / float(gate["required"]))
        for gate in gates
        if float(gate["required"]) > 0
    ]
    return round(sum(ratios) / len(ratios) * 100) if ratios else 0


def _continuity_status(collection: dict[str, Any], history: dict[str, Any]) -> str:
    if not collection["retrieval_count"]:
        return "NOT_STARTED"
    if "COLLECTION_GAP_ABOVE_MAXIMUM" in history.get("blocking_reasons", []):
        return "GAP_DETECTED"
    return "ON_TRACK"


def _readiness_forecast(
    collection: dict[str, Any],
    criteria: dict[str, Any],
    gates: tuple[dict[str, Any], ...],
) -> dict[str, Any]:
    by_id = {gate["id"]: gate for gate in gates}
    remaining = {
        "retrievals": _remaining(by_id["RETRIEVALS"]),
        "unique_states": _remaining(by_id["UNIQUE_STATES"]),
        "collection_span_days": round(_remaining(by_id["COLLECTION_SPAN"]), 3),
        "matured_cutoffs": _remaining(by_id["MATURED_CUTOFFS"]),
    }
    first = _parse_datetime(collection.get("first_retrieved_at"))
    last = _parse_datetime(collection.get("last_retrieved_at"))
    next_collection = last + timedelta(days=1) if last else None
    continuity_deadline = (
        last + timedelta(hours=float(criteria["maximum_gap_hours"])) if last else None
    )
    possible_ready = None
    if first and last:
        daily_state_runs = max(remaining["retrievals"], remaining["unique_states"])
        candidates = [
            first + timedelta(days=float(criteria["minimum_collection_span_days"])),
            last + timedelta(days=daily_state_runs),
        ]
        if remaining["matured_cutoffs"]:
            candidates.append(
                last
                + timedelta(
                    days=float(criteria["outcome_horizon_days"])
                    + max(0, remaining["matured_cutoffs"] - 1)
                )
            )
        possible_ready = max(candidates)
    return {
        "remaining": remaining,
        "next_collection_due_at": _isoformat(next_collection),
        "continuity_deadline_at": _isoformat(continuity_deadline),
        "earliest_possible_ready_at": _isoformat(possible_ready),
        "assumption": "UNINTERRUPTED_DAILY_COLLECTION_WITH_REQUIRED_DISTINCT_STATES",
        "guaranteed": False,
    }


def _remaining(gate: dict[str, Any]) -> int | float:
    difference = max(0, float(gate["required"]) - float(gate["current"]))
    if isinstance(gate["required"], int) and isinstance(gate["current"], int):
        return int(difference)
    return difference


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("history collection timestamps must be timezone-aware")
    return parsed


def _isoformat(value: datetime | None) -> str | None:
    return value.isoformat() if value else None
