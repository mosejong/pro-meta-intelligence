from __future__ import annotations

import json
import os
import tempfile
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class FeedJobOperationResult:
    exit_code: int
    payload: dict[str, Any]


@dataclass(frozen=True)
class FeedJobResult:
    exit_code: int
    audit: dict[str, Any]


class FeedJobAlreadyRunning(RuntimeError):
    """Raised when another writer currently owns the local feed job lock."""


class FeedJobRunner:
    """Run one local feed refresh at a time and retain immutable audit records."""

    def __init__(self, run_dir: Path) -> None:
        self.run_dir = run_dir
        self.runs_dir = run_dir / "runs"
        self.lock_path = run_dir / "feed-job.lock.json"

    def run(
        self,
        operation: Callable[[], FeedJobOperationResult],
        *,
        config_path: Path,
        started_at: datetime | None = None,
    ) -> FeedJobResult:
        start = started_at or datetime.now(UTC)
        if start.tzinfo is None or start.utcoffset() is None:
            raise ValueError("started_at must be timezone-aware")
        run_id = f"{start.strftime('%Y%m%dT%H%M%S.%fZ')}--{uuid.uuid4().hex[:8]}"
        lock = {
            "schema_version": "1",
            "run_id": run_id,
            "started_at": start.isoformat(),
            "process_id": os.getpid(),
            "config_path": str(config_path.resolve()),
        }
        self._acquire(lock)
        try:
            try:
                result = operation()
                status = "SUCCEEDED" if result.exit_code == 0 else "REJECTED"
                audit = {
                    **lock,
                    "finished_at": datetime.now(UTC).isoformat(),
                    "status": status,
                    "exit_code": result.exit_code,
                    "result": result.payload,
                }
            except Exception as error:  # audit unexpected failures before returning control
                audit = {
                    **lock,
                    "finished_at": datetime.now(UTC).isoformat(),
                    "status": "FAILED",
                    "exit_code": 1,
                    "error": {"type": type(error).__name__, "message": str(error)},
                }
            self._write_audit(run_id, audit)
            return FeedJobResult(exit_code=int(audit["exit_code"]), audit=audit)
        finally:
            self._release(run_id)

    def _acquire(self, lock: dict[str, Any]) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as error:
            raise FeedJobAlreadyRunning(
                f"feed job lock already exists: {self.lock_path}"
            ) from error
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(_json(lock))
            handle.flush()
            os.fsync(handle.fileno())

    def _release(self, run_id: str) -> None:
        try:
            current = json.loads(self.lock_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return
        if current.get("run_id") == run_id:
            self.lock_path.unlink(missing_ok=True)

    def _write_audit(self, run_id: str, audit: dict[str, Any]) -> None:
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        content = _json(audit)
        _exclusive_write(self.runs_dir / f"{run_id}.json", content)
        _atomic_write(self.run_dir / "latest.json", content)


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _atomic_write(path: Path, content: str) -> None:
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


def _exclusive_write(path: Path, content: str) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
