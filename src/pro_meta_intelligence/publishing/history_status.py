"""Compact, public-safe history readiness status derived from a benchmark report."""

from __future__ import annotations

import json
import os
import tempfile
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
    return {
        "schema_version": "1",
        "artifact_type": "oe-history-status",
        "source_id": benchmark.get("source_id"),
        "as_of": collection.get("last_retrieved_at"),
        "status": benchmark.get("status"),
        "history_ready": history_ready,
        "benchmark_ready": benchmark_ready,
        "gates": list(gates),
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
