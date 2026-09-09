"""Private, persistent request-attempt timestamps for rate-limited sources."""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

from pro_meta_intelligence.models import require_aware
from pro_meta_intelligence.sources.artifacts import ATTEMPT_LEDGER_FILENAME, SAFE_SOURCE_ID

SAFE_OPERATION = re.compile(r"^[A-Z][A-Z0-9_]*$")


class SourceAttemptLedgerError(RuntimeError):
    """Raised when persistent request-attempt state is malformed."""


class SourceAttemptLedger:
    """Store request start times beside raw snapshots, inside private encrypted state."""

    def __init__(self, archive_root: Path) -> None:
        self.root = archive_root.resolve()

    def latest_attempted_at(self, source_id: str, operation: str) -> datetime | None:
        attempts = self._read(source_id)
        return attempts.get(self._validated_operation(operation))

    def record(self, source_id: str, operation: str, attempted_at: datetime) -> None:
        require_aware(attempted_at, "attempted_at")
        operation = self._validated_operation(operation)
        attempts = self._read(source_id)
        previous = attempts.get(operation)
        if previous is not None and attempted_at < previous:
            raise SourceAttemptLedgerError("request-attempt timestamps must not move backwards")
        attempts[operation] = attempted_at
        source_dir = self._source_dir(source_id)
        source_dir.mkdir(parents=True, exist_ok=True)
        path = source_dir / ATTEMPT_LEDGER_FILENAME
        payload = {
            "schema_version": "1",
            "source_id": source_id,
            "attempts": {key: value.isoformat() for key, value in sorted(attempts.items())},
        }
        content = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=source_dir)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def validate(self, source_id: str) -> bool:
        """Validate existing state and report whether a ledger is present."""

        path = self._source_dir(source_id) / ATTEMPT_LEDGER_FILENAME
        if not path.exists():
            return False
        self._read(source_id)
        return True

    def _read(self, source_id: str) -> dict[str, datetime]:
        path = self._source_dir(source_id) / ATTEMPT_LEDGER_FILENAME
        if not path.exists():
            return {}
        if not path.is_file():
            raise SourceAttemptLedgerError("request-attempt ledger is not a regular file")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SourceAttemptLedgerError("request-attempt ledger is not valid JSON") from error
        if not isinstance(payload, dict) or set(payload) != {
            "schema_version",
            "source_id",
            "attempts",
        }:
            raise SourceAttemptLedgerError("request-attempt ledger has an invalid structure")
        if payload["schema_version"] != "1" or payload["source_id"] != source_id:
            raise SourceAttemptLedgerError("request-attempt ledger identity is invalid")
        raw_attempts = payload["attempts"]
        if not isinstance(raw_attempts, dict):
            raise SourceAttemptLedgerError("request-attempt ledger attempts must be an object")
        attempts: dict[str, datetime] = {}
        for operation, raw_time in raw_attempts.items():
            try:
                operation = self._validated_operation(operation)
                attempted_at = datetime.fromisoformat(raw_time)
                require_aware(attempted_at, "attempted_at")
            except (TypeError, ValueError) as error:
                raise SourceAttemptLedgerError(
                    "request-attempt ledger contains an invalid entry"
                ) from error
            attempts[operation] = attempted_at
        return attempts

    def _source_dir(self, source_id: str) -> Path:
        if not isinstance(source_id, str) or not SAFE_SOURCE_ID.fullmatch(source_id):
            raise ValueError("source_id is not safe for request-attempt storage")
        source_dir = (self.root / source_id).resolve()
        if self.root not in source_dir.parents:
            raise ValueError("resolved request-attempt storage escaped archive root")
        return source_dir

    @staticmethod
    def _validated_operation(operation: str) -> str:
        if not isinstance(operation, str) or not SAFE_OPERATION.fullmatch(operation):
            raise ValueError("operation is not safe for request-attempt storage")
        return operation
