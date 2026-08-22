"""Immutable snapshot publication with atomic current and index feed updates."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from pro_meta_intelligence.models import require_aware
from pro_meta_intelligence.temporal import parse_datetime


@dataclass(frozen=True, slots=True)
class PublicationResult:
    snapshot_id: str
    created: bool
    snapshot_path: Path
    creator_brief_path: Path
    current_path: Path
    current_creator_path: Path
    index_path: Path

    def to_dict(self, root: Path) -> dict[str, object]:
        return {
            "schema_version": "1",
            "snapshot_id": self.snapshot_id,
            "created": self.created,
            "paths": {
                "snapshot": self.snapshot_path.relative_to(root).as_posix(),
                "creator_brief": self.creator_brief_path.relative_to(root).as_posix(),
                "current": self.current_path.relative_to(root).as_posix(),
                "current_creator": self.current_creator_path.relative_to(root).as_posix(),
                "index": self.index_path.relative_to(root).as_posix(),
            },
        }


class SnapshotFeedPublisher:
    """Publish immutable radar/creator pairs before moving mutable feed heads."""

    def __init__(self, root: Path, *, max_index_entries: int = 50) -> None:
        if max_index_entries < 1:
            raise ValueError("max_index_entries must be positive")
        self.root = root
        self.max_index_entries = max_index_entries

    def publish(
        self,
        radar: dict[str, Any],
        creator_brief: dict[str, Any],
        *,
        published_at: datetime,
    ) -> PublicationResult:
        require_aware(published_at, "published_at")
        self._validate_pair(radar, creator_brief)
        if published_at < parse_datetime(radar["cutoff"]):
            raise ValueError("published_at cannot be earlier than the radar cutoff")
        self.root.mkdir(parents=True, exist_ok=True)
        snapshots_root = self.root / "snapshots"
        snapshots_root.mkdir(parents=True, exist_ok=True)

        radar_json = _json(radar)
        creator_json = _json(creator_brief)
        radar_hash = _sha256(radar_json)
        creator_hash = _sha256(creator_json)
        snapshot_id = _snapshot_id(radar, radar_hash)
        snapshot_dir = snapshots_root / snapshot_id
        created = not snapshot_dir.exists()

        if created:
            self._create_snapshot(
                snapshot_dir,
                radar_json=radar_json,
                creator_json=creator_json,
                radar=radar,
                radar_hash=radar_hash,
                creator_hash=creator_hash,
                published_at=published_at,
            )
        else:
            self._verify_existing(snapshot_dir, radar_json, creator_json)

        manifest = json.loads((snapshot_dir / "manifest.json").read_text(encoding="utf-8"))
        index_path = self.root / "index.json"
        index = self._next_index(index_path, manifest)
        current_path = self.root / "current.json"
        current_creator_path = self.root / "current-creator.json"
        current_snapshot = snapshots_root / index["current_snapshot_id"]
        _atomic_write(
            current_creator_path,
            (current_snapshot / "creator-brief.json").read_text(encoding="utf-8"),
        )
        _atomic_write(
            current_path,
            (current_snapshot / "radar.json").read_text(encoding="utf-8"),
        )
        _atomic_write(index_path, _json(index))
        return PublicationResult(
            snapshot_id=snapshot_id,
            created=created,
            snapshot_path=snapshot_dir / "radar.json",
            creator_brief_path=snapshot_dir / "creator-brief.json",
            current_path=current_path,
            current_creator_path=current_creator_path,
            index_path=index_path,
        )

    def _create_snapshot(
        self,
        snapshot_dir: Path,
        *,
        radar_json: str,
        creator_json: str,
        radar: dict[str, Any],
        radar_hash: str,
        creator_hash: str,
        published_at: datetime,
    ) -> None:
        staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=self.root / "snapshots"))
        try:
            (staging / "radar.json").write_text(radar_json, encoding="utf-8")
            (staging / "creator-brief.json").write_text(creator_json, encoding="utf-8")
            manifest = {
                "schema_version": "1",
                "snapshot_id": snapshot_dir.name,
                "patch_id": radar["patch_id"],
                "cutoff": radar["cutoff"],
                "published_at": published_at.isoformat(),
                "radar_content_hash": radar_hash,
                "creator_brief_content_hash": creator_hash,
                "paths": {
                    "radar": f"snapshots/{snapshot_dir.name}/radar.json",
                    "creator_brief": f"snapshots/{snapshot_dir.name}/creator-brief.json",
                },
            }
            (staging / "manifest.json").write_text(_json(manifest), encoding="utf-8")
            os.replace(staging, snapshot_dir)
        finally:
            if staging.exists():
                shutil.rmtree(staging)

    @staticmethod
    def _verify_existing(snapshot_dir: Path, radar_json: str, creator_json: str) -> None:
        expected = {
            "radar.json": radar_json,
            "creator-brief.json": creator_json,
        }
        for name, content in expected.items():
            path = snapshot_dir / name
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"immutable snapshot content mismatch: {snapshot_dir.name}/{name}")
        if not (snapshot_dir / "manifest.json").is_file():
            raise ValueError(f"immutable snapshot manifest is missing: {snapshot_dir.name}")

    def _next_index(self, path: Path, manifest: dict[str, Any]) -> dict[str, Any]:
        records: list[dict[str, Any]] = []
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            if existing.get("schema_version") != "1" or not isinstance(
                existing.get("snapshots"), list
            ):
                raise ValueError("snapshot feed index is malformed")
            records = existing["snapshots"]
        records = [item for item in records if item.get("snapshot_id") != manifest["snapshot_id"]]
        records.append(manifest)
        records.sort(
            key=lambda item: (
                parse_datetime(item["cutoff"]),
                parse_datetime(item["published_at"]),
                item["snapshot_id"],
            ),
            reverse=True,
        )
        return {
            "schema_version": "1",
            "current_snapshot_id": records[0]["snapshot_id"],
            "snapshots": records[: self.max_index_entries],
            "archive_policy": "immutable snapshot directories are retained beyond index trimming",
        }

    @staticmethod
    def _validate_pair(radar: dict[str, Any], creator_brief: dict[str, Any]) -> None:
        if (
            radar.get("schema_version") != "1"
            or not radar.get("patch_id")
            or not radar.get("cutoff")
        ):
            raise ValueError("publisher requires Meta Radar schema_version 1")
        source = creator_brief.get("source_snapshot")
        if creator_brief.get("schema_version") != "1" or not isinstance(source, dict):
            raise ValueError("publisher requires Creator Brief schema_version 1")
        if source.get("patch_id") != radar["patch_id"] or source.get("cutoff") != radar["cutoff"]:
            raise ValueError("creator brief does not reference the supplied radar snapshot")
        if source.get("radar_schema_version") != radar["schema_version"]:
            raise ValueError("creator brief does not reference the supplied radar schema")
        if source.get("fixture_only") != radar.get("fixture_only"):
            raise ValueError("creator brief fixture status does not match the radar snapshot")
        radar_sources = radar.get("evidence_index", {}).get("source_versions")
        if source.get("source_versions") != radar_sources:
            raise ValueError("creator brief sources do not match the radar snapshot")


def _snapshot_id(radar: dict[str, Any], radar_hash: str) -> str:
    patch = re.sub(r"[^A-Za-z0-9._-]+", "-", str(radar["patch_id"])).strip("-")
    cutoff = re.sub(r"[^0-9]", "", str(radar["cutoff"]))[:14]
    digest = radar_hash.removeprefix("sha256:")
    return f"patch-{patch}--{cutoff}--{digest[:12]}"


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _sha256(content: str) -> str:
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()


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
