"""Content-addressed storage for raw external-source snapshots."""

from __future__ import annotations

import hashlib
import json
import re
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
        with path.open("xb") as handle:
            handle.write(content)

    def latest_retrieved_at(self, source_id: str) -> datetime | None:
        latest = self.latest(source_id)
        return latest.retrieved_at if latest else None

    def latest(self, source_id: str) -> ArchivedSnapshot | None:
        if not SAFE_SOURCE_ID.fullmatch(source_id):
            raise ValueError("source_id is not safe for archive lookup")
        source_dir = self.root / source_id
        if not source_dir.is_dir():
            return None
        snapshots: list[ArchivedSnapshot] = []
        for path in source_dir.glob("*.meta.json"):
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("source_id") == source_id:
                data_file = payload.get("data_file")
                if not isinstance(data_file, str):
                    data_file = f"{payload['content_hash'].removeprefix('sha256:')}.json"
                data_path = source_dir / data_file
                if not data_path.is_file():
                    raise FileNotFoundError(f"archived source bytes are missing: {data_path}")
                snapshots.append(
                    ArchivedSnapshot(
                        data_path=data_path,
                        metadata_path=path,
                        retrieved_at=datetime.fromisoformat(payload["retrieved_at"]),
                        content_hash=payload["content_hash"],
                        final_url=payload["final_url"],
                    )
                )
        return max(snapshots, key=lambda item: item.retrieved_at) if snapshots else None
