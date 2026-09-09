"""Public-safe status for the latest professional-match collection attempt."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from pro_meta_intelligence.models import require_aware


def build_collection_status(audit: dict[str, Any]) -> dict[str, Any]:
    """Reduce a private job audit to stable codes that are safe to publish."""

    result = audit.get("result") if isinstance(audit.get("result"), dict) else {}
    acquisition = (
        result.get("source_acquisition")
        if isinstance(result.get("source_acquisition"), dict)
        else {}
    )
    history = result.get("history_status") if isinstance(result.get("history_status"), dict) else {}
    job_status = _string(audit.get("status")) or "UNKNOWN"
    result_status = _string(result.get("status")) or "UNKNOWN"
    acquisition_status = _string(acquisition.get("status")) or "UNKNOWN"
    state = _state(job_status, result_status, acquisition_status)
    reason_code = _reason_code(state, _string(acquisition.get("error")))

    return {
        "schema_version": "1",
        "artifact_type": "oe-collection-status",
        "updated_at": _string(audit.get("finished_at")),
        "state": state,
        "reason_code": reason_code,
        "last_attempt": {
            "started_at": _string(audit.get("started_at")),
            "finished_at": _string(audit.get("finished_at")),
            "job_status": job_status,
            "exit_code": (
                audit.get("exit_code") if isinstance(audit.get("exit_code"), int) else None
            ),
            "network_request_performed": result.get("network_collection_performed") is True,
        },
        "source": {
            "source_id": _string(history.get("source_id")) or "oracles-elixir-match-data",
            "acquisition_status": acquisition_status,
            "last_verified_at": _string(acquisition.get("retrieved_at"))
            or _string(history.get("as_of")),
        },
        "publication": {
            "result_status": result_status,
            "head_accepted": job_status == "SUCCEEDED" and result_status == "PUBLISHED",
            "history_status": _string(history.get("status")),
        },
        "automation": {
            "retry_mode": "AUTOMATIC_POLICY_GATED",
            "operator_action_required": state in {"PUBLICATION_REJECTED", "RUN_FAILED", "UNKNOWN"},
        },
        "boundary": (
            "Collection availability only; excludes raw rows, local paths, provider URLs, and "
            "predictive-quality claims."
        ),
    }


def publish_collection_status(root: Path, status: dict[str, Any]) -> Path:
    """Atomically publish the mutable collection status head."""

    path = root / "collection-status.json"
    content = json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def read_collection_network_attempt(path: Path, source_id: str) -> datetime | None:
    """Read a conservative migration seed from a valid public collection status."""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("schema_version") != "1":
        return None
    if payload.get("artifact_type") != "oe-collection-status":
        return None
    source = payload.get("source")
    attempt = payload.get("last_attempt")
    if not isinstance(source, dict) or source.get("source_id") != source_id:
        return None
    if not isinstance(attempt, dict) or attempt.get("network_request_performed") is not True:
        return None
    try:
        finished_at = datetime.fromisoformat(attempt["finished_at"])
        require_aware(finished_at, "finished_at")
    except (KeyError, TypeError, ValueError):
        return None
    return finished_at


def _state(job_status: str, result_status: str, acquisition_status: str) -> str:
    if job_status == "FAILED":
        return "RUN_FAILED"
    if (
        result_status == "SOURCE_UNAVAILABLE_NO_CACHE"
        or acquisition_status == "SOURCE_ERROR_NO_CACHE"
    ):
        return "SOURCE_UNAVAILABLE"
    if job_status == "REJECTED" or result_status.startswith("REJECTED_"):
        return "PUBLICATION_REJECTED"
    if acquisition_status == "REUSED_CACHE_AFTER_SOURCE_ERROR":
        return "SOURCE_DELAYED"
    if job_status == "SUCCEEDED" and acquisition_status in {"DOWNLOADED", "REUSED_DAILY_CACHE"}:
        return "CURRENT"
    return "UNKNOWN"


def _reason_code(state: str, error: str | None) -> str:
    normalized = (error or "").lower()
    if state in {"SOURCE_DELAYED", "SOURCE_UNAVAILABLE"}:
        if "html instead of csv" in normalized or "quota" in normalized:
            return "PROVIDER_QUOTA_OR_HTML_RESPONSE"
        if "missing required columns" in normalized or "schema" in normalized:
            return "PROVIDER_SCHEMA_REJECTED"
        return "PROVIDER_REQUEST_FAILED"
    if state == "PUBLICATION_REJECTED":
        return "READINESS_GATE_REJECTED"
    if state == "RUN_FAILED":
        return "COLLECTOR_JOB_FAILED"
    if state == "UNKNOWN":
        return "UNKNOWN_RESULT"
    return "NONE"


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
