"""Content-addressed storage for raw external-source snapshots."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pro_meta_intelligence.models import require_aware

SAFE_SOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


@dataclass(frozen=True, slots=True)
class RawSourceArtifact:
    source_id: str
    request_url: str
    final_url: str
    media_type: str
    retrieved_at: datetime
    body: bytes
    content_hash: str

    @classmethod
    def create(
        cls,
        *,
        source_id: str,
        request_url: str,
        final_url: str,
        media_type: str,
        retrieved_at: datetime,
        body: bytes,
    ) -> RawSourceArtifact:
        require_aware(retrieved_at, "retrieved_at")
        digest = hashlib.sha256(body).hexdigest()
        return cls(
            source_id=source_id,
            request_url=request_url,
            final_url=final_url,
            media_type=media_type,
            retrieved_at=retrieved_at,
            body=body,
            content_hash=f"sha256:{digest}",
        )

    def __post_init__(self) -> None:
        require_aware(self.retrieved_at, "retrieved_at")
        if not SAFE_SOURCE_ID.fullmatch(self.source_id):
            raise ValueError("source_id is not safe for content-addressed storage")
        expected = f"sha256:{hashlib.sha256(self.body).hexdigest()}"
        if self.content_hash != expected:
            raise ValueError("content_hash does not match artifact body")


@dataclass(frozen=True, slots=True)
class ArchivedArtifact:
    data_path: Path
    metadata_path: Path
    content_hash: str


@dataclass(frozen=True, slots=True)
class ArchivedSnapshot:
    data_path: Path
    metadata_path: Path
    retrieved_at: datetime
    content_hash: str
    final_url: str
    byte_length: int


@dataclass(frozen=True, slots=True)
class ArchiveIntegrityIssue:
    code: str
    metadata_file: str | None
    detail: str

    def to_dict(self) -> dict[str, str | None]:
        return {
            "code": self.code,
            "metadata_file": self.metadata_file,
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class ArchiveInspection:
    source_id: str
    snapshots: tuple[ArchivedSnapshot, ...]
    issues: tuple[ArchiveIntegrityIssue, ...]


class SnapshotArchiveIntegrityError(RuntimeError):
    """Raised when an operational lookup encounters a corrupt immutable archive."""


class SnapshotArchive:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def store(self, artifact: RawSourceArtifact) -> ArchivedArtifact:
        digest = artifact.content_hash.removeprefix("sha256:")
        source_dir = (self.root / artifact.source_id).resolve()
        if self.root not in source_dir.parents:
            raise ValueError("resolved source archive escaped archive root")
        source_dir.mkdir(parents=True, exist_ok=True)
        extension = ".csv" if artifact.media_type == "text/csv" else ".json"
        data_path = source_dir / f"{digest}{extension}"
        retrieval_key = artifact.retrieved_at.astimezone(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        metadata_path = source_dir / f"{digest}.{retrieval_key}.meta.json"
        self._write_once(data_path, artifact.body)
        metadata = {
            "schema_version": "1",
            "source_id": artifact.source_id,
            "request_url": artifact.request_url,
            "final_url": artifact.final_url,
            "media_type": artifact.media_type,
            "retrieved_at": artifact.retrieved_at.isoformat(),
            "content_hash": artifact.content_hash,
            "byte_length": len(artifact.body),
            "data_file": data_path.name,
        }
        metadata_bytes = (
            json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        self._write_once(metadata_path, metadata_bytes)
        return ArchivedArtifact(data_path, metadata_path, artifact.content_hash)

    @staticmethod
    def _write_once(path: Path, content: bytes) -> None:
        if path.exists():
            if path.read_bytes() != content:
                raise FileExistsError(f"immutable archive collision: {path}")
            return
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != content:
                    raise FileExistsError(f"immutable archive collision: {path}") from None
        finally:
            temporary.unlink(missing_ok=True)

    def latest_retrieved_at(self, source_id: str) -> datetime | None:
        latest = self.latest(source_id)
        return latest.retrieved_at if latest else None

    def latest(self, source_id: str) -> ArchivedSnapshot | None:
        inspection = self.inspect(source_id)
        if inspection.issues:
            codes = ", ".join(sorted({issue.code for issue in inspection.issues}))
            raise SnapshotArchiveIntegrityError(f"archive integrity check failed: {codes}")
        return inspection.snapshots[-1] if inspection.snapshots else None

    def inspect(self, source_id: str) -> ArchiveInspection:
        if not SAFE_SOURCE_ID.fullmatch(source_id):
            raise ValueError("source_id is not safe for archive lookup")
        source_dir = self.root / source_id
        if not source_dir.is_dir():
            return ArchiveInspection(source_id, (), ())
        snapshots: list[ArchivedSnapshot] = []
        issues: list[ArchiveIntegrityIssue] = []
        referenced_data_files: set[str] = set()
        verified_data: dict[str, tuple[int, str]] = {}
        for path in sorted(source_dir.glob("*.meta.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                issues.append(_archive_issue("MALFORMED_METADATA", path, str(error)))
                continue
            if not isinstance(payload, dict) or payload.get("schema_version") != "1":
                issues.append(_archive_issue("UNSUPPORTED_METADATA_SCHEMA", path))
                continue
            if payload.get("source_id") != source_id:
                issues.append(_archive_issue("SOURCE_ID_MISMATCH", path))
                continue
            content_hash = payload.get("content_hash")
            valid_content_hash = isinstance(content_hash, str) and re.fullmatch(
                r"sha256:[0-9a-f]{64}", content_hash
            )
            if not valid_content_hash:
                issues.append(_archive_issue("INVALID_CONTENT_HASH", path))
                continue
            data_file = payload.get("data_file")
            if not isinstance(data_file, str) or Path(data_file).name != data_file:
                issues.append(_archive_issue("INVALID_DATA_FILE", path))
                continue
            referenced_data_files.add(data_file)
            data_path = source_dir / data_file
            if not data_path.is_file():
                issues.append(_archive_issue("MISSING_DATA_FILE", path, data_file))
                continue
            try:
                retrieved_at = datetime.fromisoformat(str(payload["retrieved_at"]))
                require_aware(retrieved_at, "retrieved_at")
            except (KeyError, TypeError, ValueError) as error:
                issues.append(_archive_issue("INVALID_RETRIEVED_AT", path, str(error)))
                continue
            final_url = payload.get("final_url")
            if not isinstance(final_url, str) or not final_url:
                issues.append(_archive_issue("INVALID_FINAL_URL", path))
                continue
            byte_length = payload.get("byte_length")
            if not isinstance(byte_length, int) or byte_length < 0:
                issues.append(_archive_issue("INVALID_BYTE_LENGTH", path))
                continue
            if data_file not in verified_data:
                body = data_path.read_bytes()
                actual_hash = f"sha256:{hashlib.sha256(body).hexdigest()}"
                verified_data[data_file] = (len(body), actual_hash)
            actual_length, actual_hash = verified_data[data_file]
            if actual_length != byte_length:
                issues.append(_archive_issue("BYTE_LENGTH_MISMATCH", path, data_file))
                continue
            if actual_hash != content_hash:
                issues.append(_archive_issue("CONTENT_HASH_MISMATCH", path, data_file))
                continue
            snapshots.append(
                ArchivedSnapshot(
                    data_path=data_path,
                    metadata_path=path,
                    retrieved_at=retrieved_at,
                    content_hash=content_hash,
                    final_url=final_url,
                    byte_length=byte_length,
                )
            )

        data_files = {
            path.name
            for path in source_dir.iterdir()
            if path.is_file() and not path.name.endswith(".meta.json")
        }
        for orphan in sorted(data_files - referenced_data_files):
            issues.append(ArchiveIntegrityIssue("ORPHAN_DATA_FILE", None, orphan))
        return ArchiveInspection(
            source_id,
            tuple(sorted(snapshots, key=lambda item: (item.retrieved_at, item.content_hash))),
            tuple(issues),
        )


def _archive_issue(
    code: str,
    path: Path,
    detail: str | None = None,
) -> ArchiveIntegrityIssue:
    return ArchiveIntegrityIssue(code, path.name, detail or code.lower().replace("_", " "))
