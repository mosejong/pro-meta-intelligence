"""Policy-gated download of explicitly verified Oracle's Elixir annual CSV files."""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from typing import Any
from urllib.parse import urlencode, urlparse

from pro_meta_intelligence._version import USER_AGENT
from pro_meta_intelligence.ingestion.http import HttpTransport, UrllibTransport
from pro_meta_intelligence.sources import PolicyGate, RawSourceArtifact, SourceRegistry

REQUIRED_COLUMNS = frozenset(
    {
        "gameid",
        "datacompleteness",
        "league",
        "date",
        "patch",
        "participantid",
        "side",
        "position",
        "teamid",
        "firstpick",
        "champion",
        "pick1",
        "pick2",
        "pick3",
        "pick4",
        "pick5",
    }
)


class OracleElixirDownloadError(RuntimeError):
    pass


class OracleElixirDownloadIntervalError(OracleElixirDownloadError):
    def __init__(self, retry_at: datetime) -> None:
        self.retry_at = retry_at
        super().__init__(f"provider file may be downloaded again at {retry_at.isoformat()}")


@dataclass(frozen=True, slots=True)
class PublishedFile:
    year: int
    file_id: str
    filename: str
    verified_at: datetime


@dataclass(frozen=True, slots=True)
class PublishedCSVDownload:
    file: PublishedFile
    artifact: RawSourceArtifact


class OracleElixirPublishedDownloadAdapter:
    source_id = "oracles-elixir-match-data"

    def __init__(
        self,
        registry: SourceRegistry,
        *,
        transport: HttpTransport | None = None,
        manifest: dict[str, Any] | None = None,
        clock=None,
    ) -> None:
        self.registry = registry
        self.gate = PolicyGate(registry)
        self.clock = clock or _utc_now
        registration = registry.get(self.source_id)
        if registration is None:
            raise ValueError("oracles-elixir-match-data is missing from the source registry")
        hosts = frozenset(urlparse(url).hostname or "" for url in registration.base_urls)
        self.transport = transport or UrllibTransport(allowed_hosts=hosts, clock=self.clock)
        self.files = _load_manifest(manifest)

    def fetch_year(
        self,
        year: int,
        *,
        last_retrieved_at: datetime | None = None,
    ) -> PublishedCSVDownload:
        now = self.clock()
        registration = self.gate.require(self.source_id, "FETCH_PUBLISHED_CSV", now)
        published = self.files.get(year)
        if published is None:
            raise ValueError("year is not present in the reviewed Oracle's Elixir manifest")
        if last_retrieved_at is not None:
            retry_at = last_retrieved_at + timedelta(seconds=registration.minimum_interval_seconds)
            if now < retry_at:
                raise OracleElixirDownloadIntervalError(retry_at)
        query = urlencode({"id": published.file_id, "export": "download", "confirm": "t"})
        url = f"https://drive.usercontent.google.com/download?{query}"
        response = self.transport.fetch(
            url,
            maximum_bytes=registration.maximum_response_bytes,
            user_agent=USER_AGENT,
        )
        _validate_csv(response.body, response.media_type)
        artifact = RawSourceArtifact.create(
            source_id=self.source_id,
            request_url=response.request_url,
            final_url=response.final_url,
            media_type="text/csv",
            retrieved_at=response.retrieved_at,
            body=response.body,
        )
        return PublishedCSVDownload(published, artifact)


def _load_manifest(raw: dict[str, Any] | None) -> dict[int, PublishedFile]:
    if raw is None:
        resource = files("pro_meta_intelligence").joinpath("config/oe_published_files.json")
        raw = json.loads(resource.read_text(encoding="utf-8"))
    if raw.get("schema_version") != "1" or not isinstance(raw.get("files"), list):
        raise ValueError("unsupported Oracle's Elixir published-file manifest")
    result: dict[int, PublishedFile] = {}
    for item in raw["files"]:
        published = PublishedFile(
            year=int(item["year"]),
            file_id=str(item["file_id"]),
            filename=str(item["filename"]),
            verified_at=_parse_manifest_time(item["verified_at"]),
        )
        if published.year in result:
            raise ValueError("published-file years must be unique")
        if published.filename != (
            f"{published.year}_LoL_esports_match_data_from_OraclesElixir.csv"
        ):
            raise ValueError("published filename does not match the reviewed naming contract")
        if (
            not published.file_id
            or not published.file_id.replace("-", "").replace("_", "").isalnum()
        ):
            raise ValueError("published Google Drive file ID contains unsupported characters")
        result[published.year] = published
    return result


def _validate_csv(body: bytes, media_type: str) -> None:
    if media_type == "text/html" or body.lstrip().lower().startswith(b"<!doctype html"):
        raise OracleElixirDownloadError(
            "provider returned HTML instead of CSV; the public file may be quota-limited"
        )
    try:
        header = next(csv.reader(io.StringIO(body[:65536].decode("utf-8-sig"))))
    except (UnicodeDecodeError, StopIteration, csv.Error) as error:
        raise OracleElixirDownloadError("provider response is not a readable UTF-8 CSV") from error
    normalized = {name.strip().lower() for name in header}
    missing = sorted(REQUIRED_COLUMNS - normalized)
    if missing:
        raise OracleElixirDownloadError(
            f"provider CSV is missing required columns: {', '.join(missing)}"
        )


def _parse_manifest_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("manifest verified_at must be timezone-aware")
    return parsed


def _utc_now() -> datetime:
    return datetime.now(UTC)
