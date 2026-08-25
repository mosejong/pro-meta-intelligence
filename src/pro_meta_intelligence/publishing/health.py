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
    decision_outcomes: dict[str, Any] | None,
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
        _decision_outcomes_artifact_check(decision_outcomes),
        _history_outcomes_pair_check(history_status, decision_outcomes),
        _public_boundary_check(current_feed, history_status, decision_outcomes),
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
            "decision_outcomes_status": decision_outcomes.get("status")
            if isinstance(decision_outcomes, dict)
            else None,
        },
        "boundary": (
            "Operational freshness and publication health only; not evidence of predictive quality."
        ),
    }


def assess_publication_watchdog(
    current_feed: dict[str, Any] | None,
    creator_feed: dict[str, Any] | None,
    history_status: dict[str, Any] | None,
    decision_outcomes: dict[str, Any] | None,
    schedule_feed: dict[str, Any] | None,
    *,
    checked_at: datetime | None = None,
    maximum_radar_age_hours: float = 50,
    maximum_schedule_age_hours: float = 30,
) -> dict[str, Any]:
    """Assess only public artifacts so a hosted runner can detect a stalled publisher.

    The local feed health command remains authoritative for the collector process and its private
    audit record. This watchdog deliberately checks the independently served publication surface:
    paired Radar/Creator heads, history metadata, official schedule, freshness, and public-data
    boundaries. An incomplete historical benchmark is still an expected collection state.
    """

    now = checked_at or datetime.now(UTC)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("checked_at must be timezone-aware")
    if maximum_radar_age_hours <= 0 or maximum_schedule_age_hours <= 0:
        raise ValueError("maximum ages must be positive")

    checks = [
        _publication_check(current_feed),
        _creator_publication_check(creator_feed),
        _paired_publication_check(current_feed, creator_feed),
        _history_artifact_check(history_status),
        _history_publication_pair_check(current_feed, history_status),
        _decision_outcomes_artifact_check(decision_outcomes),
        _history_outcomes_pair_check(history_status, decision_outcomes),
        _schedule_publication_check(schedule_feed),
        _freshness_check(
            "RADAR_PUBLICATION_FRESHNESS",
            current_feed.get("cutoff") if isinstance(current_feed, dict) else None,
            now,
            maximum_radar_age_hours,
        ),
        _freshness_check(
            "SCHEDULE_PUBLICATION_FRESHNESS",
            schedule_feed.get("retrieved_at") if isinstance(schedule_feed, dict) else None,
            now,
            maximum_schedule_age_hours,
        ),
        _public_artifact_boundary_check(
            {
                "radar": current_feed,
                "creator": creator_feed,
                "history": history_status,
                "decision_outcomes": decision_outcomes,
                "schedule": schedule_feed,
            }
        ),
    ]
    failed = [check["id"] for check in checks if not check["passed"]]
    benchmark_ready = bool(
        isinstance(history_status, dict) and history_status.get("benchmark_ready") is True
    )
    healthy = not failed
    return {
        "schema_version": "1",
        "artifact_type": "public-publication-watchdog",
        "checked_at": now.isoformat(),
        "status": "HEALTHY" if healthy else "UNHEALTHY",
        "healthy": healthy,
        "phase": "BENCHMARK_READY" if benchmark_ready else "COLLECTING_HISTORY",
        "checks": checks,
        "failed_checks": failed,
        "next_action": _public_watchdog_next_action(failed),
        "summary": {
            "patch_id": current_feed.get("patch_id") if isinstance(current_feed, dict) else None,
            "radar_cutoff": current_feed.get("cutoff") if isinstance(current_feed, dict) else None,
            "history_status": history_status.get("status")
            if isinstance(history_status, dict)
            else None,
            "decision_outcomes_status": decision_outcomes.get("status")
            if isinstance(decision_outcomes, dict)
            else None,
            "schedule_retrieved_at": schedule_feed.get("retrieved_at")
            if isinstance(schedule_feed, dict)
            else None,
        },
        "boundary": (
            "Public endpoint availability, pairing, and freshness only; not evidence of predictive "
            "quality or collector-process health."
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


def _creator_publication_check(creator_feed: dict[str, Any] | None) -> dict[str, Any]:
    schema_version = creator_feed.get("schema_version") if isinstance(creator_feed, dict) else None
    mode = creator_feed.get("mode") if isinstance(creator_feed, dict) else None
    publication_ready = (
        creator_feed.get("publication_ready") if isinstance(creator_feed, dict) else None
    )
    human_review_required = (
        creator_feed.get("human_review_required") if isinstance(creator_feed, dict) else None
    )
    source_snapshot = (
        creator_feed.get("source_snapshot") if isinstance(creator_feed, dict) else None
    )
    topics = creator_feed.get("topic_candidates") if isinstance(creator_feed, dict) else None
    passed = (
        schema_version == "1"
        and mode == "CREATOR"
        and publication_ready is False
        and human_review_required is True
        and isinstance(source_snapshot, dict)
        and isinstance(topics, list)
        and bool(topics)
    )
    return _check(
        "CREATOR_FEED_READY",
        passed,
        {
            "schema_version": schema_version,
            "mode": mode,
            "publication_ready": publication_ready,
            "human_review_required": human_review_required,
            "topic_count": len(topics) if isinstance(topics, list) else 0,
        },
        (
            "schema_version=1, mode=CREATOR, publication_ready=false, "
            "human_review_required=true, source snapshot, and nonempty topics"
        ),
    )


def _paired_publication_check(
    current_feed: dict[str, Any] | None,
    creator_feed: dict[str, Any] | None,
) -> dict[str, Any]:
    source = creator_feed.get("source_snapshot") if isinstance(creator_feed, dict) else None
    radar_patch = current_feed.get("patch_id") if isinstance(current_feed, dict) else None
    radar_cutoff = current_feed.get("cutoff") if isinstance(current_feed, dict) else None
    creator_patch = source.get("patch_id") if isinstance(source, dict) else None
    creator_cutoff = source.get("cutoff") if isinstance(source, dict) else None
    creator_fixture = source.get("fixture_only") if isinstance(source, dict) else None
    passed = (
        isinstance(radar_patch, str)
        and bool(radar_patch)
        and isinstance(radar_cutoff, str)
        and bool(radar_cutoff)
        and radar_patch == creator_patch
        and radar_cutoff == creator_cutoff
        and creator_fixture is False
    )
    return _check(
        "RADAR_CREATOR_PAIRED",
        passed,
        {
            "radar_patch_id": radar_patch,
            "creator_patch_id": creator_patch,
            "radar_cutoff": radar_cutoff,
            "creator_cutoff": creator_cutoff,
            "creator_fixture_only": creator_fixture,
        },
        "exact matching non-fixture Radar and Creator patch/cutoff",
    )


def _history_publication_pair_check(
    current_feed: dict[str, Any] | None,
    history_status: dict[str, Any] | None,
) -> dict[str, Any]:
    radar_cutoff = current_feed.get("cutoff") if isinstance(current_feed, dict) else None
    history_as_of = history_status.get("as_of") if isinstance(history_status, dict) else None
    passed = isinstance(radar_cutoff, str) and bool(radar_cutoff) and radar_cutoff == history_as_of
    return _check(
        "RADAR_HISTORY_PAIRED",
        passed,
        {"radar_cutoff": radar_cutoff, "history_as_of": history_as_of},
        "exact matching Radar cutoff and history as_of",
    )


def _schedule_publication_check(schedule_feed: dict[str, Any] | None) -> dict[str, Any]:
    schema_version = (
        schedule_feed.get("schema_version") if isinstance(schedule_feed, dict) else None
    )
    artifact_type = schedule_feed.get("artifact_type") if isinstance(schedule_feed, dict) else None
    source_id = schedule_feed.get("source_id") if isinstance(schedule_feed, dict) else None
    events = schedule_feed.get("events") if isinstance(schedule_feed, dict) else None
    content_hash = schedule_feed.get("content_hash") if isinstance(schedule_feed, dict) else None
    passed = (
        schema_version == "1"
        and artifact_type == "pro-schedule-snapshot"
        and source_id == "lol-esports-schedule"
        and isinstance(events, list)
        and isinstance(content_hash, str)
        and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", content_hash))
    )
    return _check(
        "SCHEDULE_FEED_READY",
        passed,
        {
            "schema_version": schema_version,
            "artifact_type": artifact_type,
            "source_id": source_id,
            "event_count": len(events) if isinstance(events, list) else 0,
            "content_hash_valid": isinstance(content_hash, str)
            and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", content_hash)),
        },
        "versioned official schedule snapshot with events list and SHA-256 content hash",
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


def _decision_outcomes_artifact_check(
    decision_outcomes: dict[str, Any] | None,
) -> dict[str, Any]:
    artifact_type = (
        decision_outcomes.get("artifact_type") if isinstance(decision_outcomes, dict) else None
    )
    schema_version = (
        decision_outcomes.get("schema_version") if isinstance(decision_outcomes, dict) else None
    )
    status = decision_outcomes.get("status") if isinstance(decision_outcomes, dict) else None
    benchmark_ready = (
        decision_outcomes.get("benchmark_ready") if isinstance(decision_outcomes, dict) else None
    )
    evaluations = (
        decision_outcomes.get("evaluations") if isinstance(decision_outcomes, dict) else None
    )
    summary = decision_outcomes.get("summary") if isinstance(decision_outcomes, dict) else None
    summary_fields = (
        "evaluated_cutoff_count",
        "selected_candidate_count",
        "hit_count",
        "false_alert_count",
        "missed_adoption_count",
    )
    summary_valid = isinstance(summary, dict) and all(
        type(summary.get(field)) is int and summary[field] >= 0 for field in summary_fields
    )
    evaluations_valid = isinstance(evaluations, list) and all(
        _is_decision_outcome_evaluation(item) for item in evaluations
    )
    expected_summary = _decision_outcomes_summary(evaluations) if evaluations_valid else None
    summary_consistent = (
        summary_valid
        and expected_summary is not None
        and all(summary[field] == expected_summary[field] for field in summary_fields)
    )
    lifecycle_valid = (
        benchmark_ready is False
        and status in {"HISTORY_NOT_READY", "NO_EVALUABLE_CUTOFFS"}
        and evaluations == []
    ) or (
        benchmark_ready is True
        and status == "COMPLETE"
        and isinstance(evaluations, list)
        and bool(evaluations)
    )
    passed = (
        schema_version == "1"
        and artifact_type == "team-decision-outcomes"
        and isinstance(decision_outcomes.get("as_of"), str)
        and bool(decision_outcomes["as_of"])
        and isinstance(benchmark_ready, bool)
        and summary_consistent
        and evaluations_valid
        and lifecycle_valid
    )
    return _check(
        "DECISION_OUTCOMES_VALID",
        passed,
        {
            "schema_version": schema_version,
            "artifact_type": artifact_type,
            "status": status,
            "benchmark_ready": benchmark_ready,
            "evaluation_count": len(evaluations) if isinstance(evaluations, list) else 0,
        },
        "versioned decision outcomes with a valid history lifecycle, summary, and evaluations",
    )


def _history_outcomes_pair_check(
    history_status: dict[str, Any] | None,
    decision_outcomes: dict[str, Any] | None,
) -> dict[str, Any]:
    history_as_of = history_status.get("as_of") if isinstance(history_status, dict) else None
    outcomes_as_of = decision_outcomes.get("as_of") if isinstance(decision_outcomes, dict) else None
    history_ready = (
        history_status.get("benchmark_ready") if isinstance(history_status, dict) else None
    )
    outcomes_ready = (
        decision_outcomes.get("benchmark_ready") if isinstance(decision_outcomes, dict) else None
    )
    passed = (
        isinstance(history_as_of, str)
        and bool(history_as_of)
        and history_as_of == outcomes_as_of
        and isinstance(history_ready, bool)
        and history_ready == outcomes_ready
    )
    return _check(
        "HISTORY_OUTCOMES_PAIRED",
        passed,
        {
            "history_as_of": history_as_of,
            "outcomes_as_of": outcomes_as_of,
            "history_benchmark_ready": history_ready,
            "outcomes_benchmark_ready": outcomes_ready,
        },
        "exact matching history/outcomes as_of and benchmark_ready",
    )


def _public_boundary_check(
    current_feed: dict[str, Any] | None,
    history_status: dict[str, Any] | None,
    decision_outcomes: dict[str, Any] | None,
) -> dict[str, Any]:
    blocked_paths: list[str] = []
    for root_name, artifact in (
        ("current", current_feed),
        ("history", history_status),
        ("decision_outcomes", decision_outcomes),
    ):
        if isinstance(artifact, dict):
            for field_path, value in _string_leaves(artifact, root_name):
                if _BLOCKED_PUBLIC_VALUE.search(value):
                    blocked_paths.append(field_path)
    return _check(
        "PUBLIC_BOUNDARY_SAFE",
        not blocked_paths,
        {"blocked_field_count": len(blocked_paths), "blocked_field_paths": blocked_paths[:10]},
        "no local path, provider CSV path, or product-login branding",
    )


def _public_artifact_boundary_check(
    artifacts: dict[str, dict[str, Any] | None],
) -> dict[str, Any]:
    blocked_paths: list[str] = []
    for root_name, artifact in artifacts.items():
        if not isinstance(artifact, dict):
            continue
        for field_path, value in _string_leaves(artifact, root_name):
            if _BLOCKED_PUBLIC_VALUE.search(value):
                blocked_paths.append(field_path)
    return _check(
        "PUBLIC_BOUNDARY_SAFE",
        not blocked_paths,
        {"blocked_field_count": len(blocked_paths), "blocked_field_paths": blocked_paths[:10]},
        "no local path, provider CSV path, or product-login branding in any public artifact",
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
    r"(?:(?<![A-Za-z])[A-Za-z]:[\\/]|file://|\.csv(?:\b|$)|chatgpt|openai|"
    r"gpt\s*(?:login|로그인)|sign in)",
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


def _is_decision_outcome_evaluation(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    if not all(
        isinstance(value.get(field), str) and bool(value[field])
        for field in ("evaluation_id", "cutoff", "outcome_end", "patch_id")
    ):
        return False
    selected = value.get("selected_candidates")
    missed = value.get("missed_adoptions")
    source_versions = value.get("source_versions")
    if not isinstance(selected, list) or not isinstance(missed, list):
        return False
    if not isinstance(source_versions, list) or not all(
        isinstance(item, dict)
        and isinstance(item.get("source_id"), str)
        and isinstance(item.get("content_hash"), str)
        and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", item["content_hash"]))
        for item in source_versions
    ):
        return False
    return all(_is_selected_outcome(item) for item in selected) and all(
        _is_adoption_outcome(item) for item in missed
    )


def _is_selected_outcome(value: object) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("champion_id"), str)
        and isinstance(value.get("role"), str)
        and value.get("outcome") in {"HIT", "FALSE_ALERT"}
    )


def _is_adoption_outcome(value: object) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("champion_id"), str)
        and isinstance(value.get("role"), str)
    )


def _decision_outcomes_summary(evaluations: list[object]) -> dict[str, int]:
    selected = [
        candidate
        for evaluation in evaluations
        if isinstance(evaluation, dict)
        for candidate in evaluation.get("selected_candidates", [])
        if isinstance(candidate, dict)
    ]
    return {
        "evaluated_cutoff_count": len(evaluations),
        "selected_candidate_count": len(selected),
        "hit_count": sum(candidate.get("outcome") == "HIT" for candidate in selected),
        "false_alert_count": sum(
            candidate.get("outcome") == "FALSE_ALERT" for candidate in selected
        ),
        "missed_adoption_count": sum(
            len(evaluation.get("missed_adoptions", []))
            for evaluation in evaluations
            if isinstance(evaluation, dict)
        ),
    }


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
    if "DECISION_OUTCOMES_VALID" in failed:
        return "REBUILD_DECISION_OUTCOMES"
    if "HISTORY_OUTCOMES_PAIRED" in failed:
        return "RESTORE_PAIRED_DECISION_OUTCOMES"
    if isinstance(history_status, dict) and isinstance(history_status.get("next_action"), str):
        return history_status["next_action"]
    return "KEEP_DAILY_COLLECTION"


def _public_watchdog_next_action(failed: list[str]) -> str:
    if "PUBLIC_BOUNDARY_SAFE" in failed:
        return "HALT_PUBLICATION"
    if "PUBLIC_FEED_READY" in failed:
        return "RESTORE_RADAR_FEED"
    if "CREATOR_FEED_READY" in failed or "RADAR_CREATOR_PAIRED" in failed:
        return "RESTORE_PAIRED_CREATOR_FEED"
    if "HISTORY_STATUS_VALID" in failed or "RADAR_HISTORY_PAIRED" in failed:
        return "REBUILD_HISTORY_STATUS"
    if "DECISION_OUTCOMES_VALID" in failed:
        return "REBUILD_DECISION_OUTCOMES"
    if "HISTORY_OUTCOMES_PAIRED" in failed:
        return "RESTORE_PAIRED_DECISION_OUTCOMES"
    if "SCHEDULE_FEED_READY" in failed:
        return "RESTORE_SCHEDULE_FEED"
    if "RADAR_PUBLICATION_FRESHNESS" in failed:
        return "RUN_OE_SYNC_NOW"
    if "SCHEDULE_PUBLICATION_FRESHNESS" in failed:
        return "RUN_SCHEDULE_REFRESH_NOW"
    return "KEEP_MONITORING"
