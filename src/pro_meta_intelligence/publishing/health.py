"""Operational health assessment for the unattended Oracle's Elixir feed."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from pro_meta_intelligence.temporal import parse_datetime


def assess_oe_feed_health(
    latest_job: dict[str, Any] | None,
    current_feed: dict[str, Any] | None,
    history_status: dict[str, Any] | None,
    *,
    checked_at: datetime | None = None,
    maximum_job_age_hours: float = 30,
    maximum_source_age_hours: float = 50,
) -> dict[str, Any]:
    """Return a public-safe, scheduler-friendly health report.

    An incomplete history benchmark is an expected collection phase, not an outage. Only broken,
    rejected, missing, or stale operational artifacts fail the health check.
    """

    now = checked_at or datetime.now(UTC)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("checked_at must be timezone-aware")
    if maximum_job_age_hours <= 0 or maximum_source_age_hours <= 0:
        raise ValueError("maximum ages must be positive")

    checks = [
        _job_result_check(latest_job),
        _freshness_check(
            "JOB_FRESHNESS",
            latest_job.get("finished_at") if isinstance(latest_job, dict) else None,
            now,
            maximum_job_age_hours,
        ),
        _publication_check(current_feed),
        _history_artifact_check(history_status),
        _public_boundary_check(current_feed, history_status),
        _freshness_check(
            "SOURCE_SNAPSHOT_FRESHNESS",
            history_status.get("as_of") if isinstance(history_status, dict) else None,
            now,
            maximum_source_age_hours,
        ),
    ]
    failed = [check["id"] for check in checks if not check["passed"]]
    benchmark_ready = bool(
        isinstance(history_status, dict) and history_status.get("benchmark_ready") is True
    )
    healthy = not failed
    return {
        "schema_version": "1",
        "artifact_type": "oe-feed-health",
        "checked_at": now.isoformat(),
        "status": "HEALTHY" if healthy else "UNHEALTHY",
        "healthy": healthy,
        "phase": "BENCHMARK_READY" if benchmark_ready else "COLLECTING_HISTORY",
        "checks": checks,
        "failed_checks": failed,
        "next_action": _next_action(failed, history_status),
        "summary": {
            "last_job_status": latest_job.get("status") if isinstance(latest_job, dict) else None,
            "patch_id": current_feed.get("patch_id") if isinstance(current_feed, dict) else None,
            "history_status": history_status.get("status")
            if isinstance(history_status, dict)
            else None,
            "history_next_action": history_status.get("next_action")
            if isinstance(history_status, dict)
            else None,
        },
        "boundary": (
            "Operational freshness and publication health only; not evidence of predictive quality."
        ),
    }


def _job_result_check(latest_job: dict[str, Any] | None) -> dict[str, Any]:
    status = latest_job.get("status") if isinstance(latest_job, dict) else None
    exit_code = latest_job.get("exit_code") if isinstance(latest_job, dict) else None
    passed = status == "SUCCEEDED" and exit_code == 0
    return _check(
        "LAST_JOB_SUCCEEDED",
        passed,
        {"status": status, "exit_code": exit_code},
        "status=SUCCEEDED and exit_code=0",
    )


def _publication_check(current_feed: dict[str, Any] | None) -> dict[str, Any]:
    readiness = (
        current_feed.get("publication_readiness") if isinstance(current_feed, dict) else None
    )
    ready = readiness.get("ready_for_radar") if isinstance(readiness, dict) else None
    fixture_only = current_feed.get("fixture_only") if isinstance(current_feed, dict) else None
    schema_version = current_feed.get("schema_version") if isinstance(current_feed, dict) else None
    patch_id = current_feed.get("patch_id") if isinstance(current_feed, dict) else None
    entries = current_feed.get("entries") if isinstance(current_feed, dict) else None
    passed = (
        schema_version == "1"
        and fixture_only is False
        and ready is True
        and isinstance(patch_id, str)
        and bool(patch_id)
        and isinstance(entries, list)
        and bool(entries)
    )
    return _check(
        "PUBLIC_FEED_READY",
        passed,
        {
            "schema_version": schema_version,
            "fixture_only": fixture_only,
            "ready_for_radar": ready,
            "patch_id": patch_id,
            "entry_count": len(entries) if isinstance(entries, list) else 0,
        },
        "schema_version=1, fixture_only=false, ready_for_radar=true, nonempty patch and entries",
    )


def _history_artifact_check(history_status: dict[str, Any] | None) -> dict[str, Any]:
    artifact_type = (
        history_status.get("artifact_type") if isinstance(history_status, dict) else None
    )
    schema_version = (
        history_status.get("schema_version") if isinstance(history_status, dict) else None
    )
    gates = history_status.get("gates") if isinstance(history_status, dict) else None
    gate_ids = (
        {gate.get("id") for gate in gates if isinstance(gate, dict)}
        if isinstance(gates, list)
        else set()
    )
    passed = (
        schema_version == "1"
        and artifact_type == "oe-history-status"
        and isinstance(history_status.get("history_ready"), bool)
        and isinstance(history_status.get("benchmark_ready"), bool)
        and isinstance(gates, list)
        and len(gates) == 4
        and all(_is_history_gate(gate) for gate in gates)
        and gate_ids == {"RETRIEVALS", "UNIQUE_STATES", "COLLECTION_SPAN", "MATURED_CUTOFFS"}
    )
    return _check(
        "HISTORY_STATUS_VALID",
        passed,
        {
            "schema_version": schema_version,
            "artifact_type": artifact_type,
            "gate_count": len(gates) if isinstance(gates, list) else 0,
        },
        "schema_version=1, artifact_type=oe-history-status, and four valid named gates",
    )


def _public_boundary_check(
    current_feed: dict[str, Any] | None,
    history_status: dict[str, Any] | None,
) -> dict[str, Any]:
    blocked_paths: list[str] = []
    if isinstance(current_feed, dict) and isinstance(history_status, dict):
        for root_name, artifact in (("current", current_feed), ("history", history_status)):
            for field_path, value in _string_leaves(artifact, root_name):
                if _BLOCKED_PUBLIC_VALUE.search(value):
                    blocked_paths.append(field_path)
    else:
        blocked_paths.append("missing-artifact")
    return _check(
        "PUBLIC_BOUNDARY_SAFE",
        not blocked_paths,
        {"blocked_field_count": len(blocked_paths), "blocked_field_paths": blocked_paths[:10]},
        "no local path, provider CSV path, or product-login branding",
    )


def _string_leaves(value: object, path: str):
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from _string_leaves(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _string_leaves(child, f"{path}[{index}]")


_BLOCKED_PUBLIC_VALUE = re.compile(
    r"(?:[A-Za-z]:[\\/]|file://|\.csv(?:\b|$)|chatgpt|openai|gpt\s*(?:login|로그인)|sign in)",
    re.IGNORECASE,
)


def _is_history_gate(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    return (
        isinstance(value.get("id"), str)
        and type(value.get("current")) in (int, float)
        and type(value.get("required")) in (int, float)
        and isinstance(value.get("unit"), str)
        and isinstance(value.get("passed"), bool)
    )


def _freshness_check(
    check_id: str,
    timestamp: object,
    now: datetime,
    maximum_age_hours: float,
) -> dict[str, Any]:
    age_hours: float | None = None
    parsed: datetime | None = None
    if isinstance(timestamp, str):
        try:
            parsed = parse_datetime(timestamp)
            age_hours = round((now - parsed).total_seconds() / 3600, 3)
        except (TypeError, ValueError):
            pass
    passed = age_hours is not None and 0 <= age_hours <= maximum_age_hours
    return _check(
        check_id,
        passed,
        {"timestamp": parsed.isoformat() if parsed else None, "age_hours": age_hours},
        {"maximum_age_hours": maximum_age_hours},
    )


def _check(check_id: str, passed: bool, observed: object, required: object) -> dict[str, Any]:
    return {
        "id": check_id,
        "passed": passed,
        "severity": "CRITICAL",
        "observed": observed,
        "required": required,
    }


def _next_action(failed: list[str], history_status: dict[str, Any] | None) -> str:
    if "LAST_JOB_SUCCEEDED" in failed:
        return "INSPECT_LAST_JOB"
    if "JOB_FRESHNESS" in failed or "SOURCE_SNAPSHOT_FRESHNESS" in failed:
        return "RUN_SYNC_NOW"
    if "PUBLIC_BOUNDARY_SAFE" in failed:
        return "HALT_PUBLICATION"
    if "PUBLIC_FEED_READY" in failed:
        return "RESTORE_PUBLIC_FEED"
    if "HISTORY_STATUS_VALID" in failed:
        return "REBUILD_HISTORY_STATUS"
    if isinstance(history_status, dict) and isinstance(history_status.get("next_action"), str):
        return history_status["next_action"]
    return "KEEP_DAILY_COLLECTION"
