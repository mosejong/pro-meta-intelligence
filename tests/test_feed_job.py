from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.publishing import (
    FeedJobAlreadyRunning,
    FeedJobOperationResult,
    FeedJobRunner,
)


def test_feed_job_records_success_and_releases_lock(tmp_path) -> None:
    runner = FeedJobRunner(tmp_path)
    started_at = datetime(2026, 8, 22, 4, 0, tzinfo=UTC)

    result = runner.run(
        lambda: FeedJobOperationResult(0, {"snapshot_id": "snapshot-1"}),
        config_path=tmp_path / "job.json",
        started_at=started_at,
    )

    assert result.exit_code == 0
    assert result.audit["status"] == "SUCCEEDED"
    assert result.audit["result"] == {"snapshot_id": "snapshot-1"}
    assert not runner.lock_path.exists()
    latest = json.loads((tmp_path / "latest.json").read_text(encoding="utf-8"))
    immutable = json.loads(
        (tmp_path / "runs" / f"{result.audit['run_id']}.json").read_text(encoding="utf-8")
    )
    assert latest == immutable == result.audit


def test_feed_job_records_failure_and_releases_lock(tmp_path) -> None:
    runner = FeedJobRunner(tmp_path)

    def fail() -> FeedJobOperationResult:
        raise ValueError("broken input")

    result = runner.run(fail, config_path=tmp_path / "job.json")

    assert result.exit_code == 1
    assert result.audit["status"] == "FAILED"
    assert result.audit["error"] == {"type": "ValueError", "message": "broken input"}
    assert not runner.lock_path.exists()


def test_feed_job_refuses_overlapping_writer_without_touching_lock(tmp_path) -> None:
    runner = FeedJobRunner(tmp_path)
    lock = {"schema_version": "1", "run_id": "existing"}
    runner.lock_path.write_text(json.dumps(lock), encoding="utf-8")

    with pytest.raises(FeedJobAlreadyRunning, match="lock already exists"):
        runner.run(
            lambda: FeedJobOperationResult(0, {}),
            config_path=tmp_path / "job.json",
        )

    assert json.loads(runner.lock_path.read_text(encoding="utf-8")) == lock
