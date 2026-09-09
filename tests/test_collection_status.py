import json
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.publishing import (
    build_collection_status,
    publish_collection_status,
    read_collection_network_attempt,
)


def _audit(*, acquisition_status: str, error: str | None = None) -> dict[str, object]:
    return {
        "schema_version": "1",
        "run_id": "private-run-id",
        "config_path": "C:/Users/private/config.json",
        "process_id": 4242,
        "started_at": "2026-09-08T12:08:11+00:00",
        "finished_at": "2026-09-08T12:08:45+00:00",
        "status": "SUCCEEDED",
        "exit_code": 0,
        "result": {
            "status": "PUBLISHED",
            "network_collection_performed": True,
            "source_acquisition": {
                "status": acquisition_status,
                "error": error,
                "retrieved_at": "2026-08-31T23:12:19+00:00",
                "content_hash": "sha256:private",
            },
            "history_status": {
                "source_id": "oracles-elixir-match-data",
                "as_of": "2026-08-31T23:12:19+00:00",
                "status": "HISTORY_NOT_READY",
            },
            "paths": {"snapshot": "private/provider.csv"},
        },
    }


def test_collection_status_redacts_private_audit_and_classifies_quota_delay(tmp_path: Path) -> None:
    status = build_collection_status(
        _audit(
            acquisition_status="REUSED_CACHE_AFTER_SOURCE_ERROR",
            error="provider returned HTML instead of CSV; the public file may be quota-limited",
        )
    )
    path = publish_collection_status(tmp_path, status)
    text = path.read_text(encoding="utf-8")
    published = json.loads(text)

    assert published["state"] == "SOURCE_DELAYED"
    assert published["reason_code"] == "PROVIDER_QUOTA_OR_HTML_RESPONSE"
    assert published["last_attempt"]["network_request_performed"] is True
    assert published["source"]["last_verified_at"] == "2026-08-31T23:12:19+00:00"
    assert published["automation"] == {
        "operator_action_required": False,
        "retry_mode": "AUTOMATIC_POLICY_GATED",
    }
    assert "private-run-id" not in text
    assert "C:/Users" not in text
    assert ".csv" not in text
    assert "sha256:private" not in text
    assert "quota-limited" not in text


def test_collection_status_distinguishes_current_rejected_and_failed_runs() -> None:
    current = build_collection_status(_audit(acquisition_status="DOWNLOADED"))
    assert current["state"] == "CURRENT"
    assert current["reason_code"] == "NONE"

    rejected_audit = _audit(acquisition_status="DOWNLOADED")
    rejected_audit["status"] = "REJECTED"
    rejected_audit["exit_code"] = 2
    rejected_audit["result"]["status"] = "REJECTED_READINESS"  # type: ignore[index]
    rejected = build_collection_status(rejected_audit)
    assert rejected["state"] == "PUBLICATION_REJECTED"
    assert rejected["automation"]["operator_action_required"] is True

    failed = build_collection_status(
        {
            "started_at": "2026-09-08T12:08:11+00:00",
            "finished_at": "2026-09-08T12:08:12+00:00",
            "status": "FAILED",
            "exit_code": 1,
            "error": {"type": "RuntimeError", "message": "private path"},
        }
    )
    assert failed["state"] == "RUN_FAILED"
    assert failed["reason_code"] == "COLLECTOR_JOB_FAILED"


def test_collection_status_supplies_only_a_conservative_network_attempt_seed(tmp_path) -> None:
    path = publish_collection_status(
        tmp_path,
        build_collection_status(_audit(acquisition_status="REUSED_CACHE_AFTER_SOURCE_ERROR")),
    )

    assert read_collection_network_attempt(path, "oracles-elixir-match-data") == datetime(
        2026, 9, 8, 12, 8, 45, tzinfo=UTC
    )
    assert read_collection_network_attempt(path, "another-source") is None

    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["last_attempt"]["network_request_performed"] = False
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert read_collection_network_attempt(path, "oracles-elixir-match-data") is None
