"""Policy-gated Riot Data Dragon static-data adapter."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse

from pro_meta_intelligence.ingestion.http import HttpResponse, HttpTransport, UrllibTransport
from pro_meta_intelligence.models import Provenance, require_temporal_order
from pro_meta_intelligence.sources import (
    PolicyGate,
    RawSourceArtifact,
    SourceRegistration,
    SourceRegistry,
)

VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
LOCALE_PATTERN = re.compile(r"^[a-z]{2}_[A-Z]{2}$")
USER_AGENT = "ProMetaIntelligence/0.2 (+https://github.com/mosejong/pro-meta-intelligence)"


class SourcePayloadError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ChampionStaticData:
    champion_id: str
    numeric_key: str
    name: str
    title: str
    tags: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ChampionCatalogSnapshot:
    version: str
    locale: str
    champions: tuple[ChampionStaticData, ...]
    observed_at: datetime
    available_at: datetime
    provenance: Provenance

    def __post_init__(self) -> None:
        require_temporal_order(self.observed_at, self.available_at)


@dataclass(frozen=True, slots=True)
class DataDragonVersions:
    versions: tuple[str, ...]
    artifact: RawSourceArtifact


@dataclass(frozen=True, slots=True)
class DataDragonCatalog:
    version: str
    locale: str
    champions: tuple[ChampionStaticData, ...]
    artifact: RawSourceArtifact

    def to_snapshot(self, *, release_at: datetime) -> ChampionCatalogSnapshot:
        require_temporal_order(release_at, self.artifact.retrieved_at)
        return ChampionCatalogSnapshot(
            version=self.version,
            locale=self.locale,
            champions=self.champions,
            observed_at=release_at,
            available_at=self.artifact.retrieved_at,
            provenance=Provenance(
                source_id=self.artifact.source_id,
                source_type="official_static_data",
                source_uri=self.artifact.final_url,
                source_version=self.version,
                retrieved_at=self.artifact.retrieved_at,
                content_hash=self.artifact.content_hash,
                schema_version="1",
            ),
        )


class DataDragonAdapter:
    source_id = "riot-data-dragon"

    def __init__(
        self,
        registry: SourceRegistry,
        *,
        transport: HttpTransport | None = None,
        clock: Callable[[], datetime] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.registry = registry
        self.gate = PolicyGate(registry)
        self.clock = clock or (lambda: datetime.now(UTC))
        registration = registry.get(self.source_id)
        if registration is None:
            raise ValueError("riot-data-dragon is missing from the source registry")
        hosts = frozenset(urlparse(url).hostname or "" for url in registration.base_urls)
        self.transport = transport or UrllibTransport(allowed_hosts=hosts, clock=self.clock)
        self.sleeper = sleeper
        self._last_request_at: datetime | None = None

    def fetch_versions(self) -> DataDragonVersions:
        registration = self._authorize("FETCH_VERSION_INDEX")
        url = f"{registration.base_urls[0].rstrip('/')}/api/versions.json"
        response = self._fetch(url, registration.maximum_response_bytes)
        raw = self._parse_json(response)
        if not isinstance(raw, list) or not raw:
            raise SourcePayloadError("Data Dragon version index must be a non-empty list")
        versions = tuple(
            item for item in raw if isinstance(item, str) and VERSION_PATTERN.fullmatch(item)
        )
        if not versions:
            raise SourcePayloadError("Data Dragon version index contains no supported versions")
        return DataDragonVersions(versions, self._artifact(response))

    def fetch_champion_catalog(self, version: str, locale: str = "en_US") -> DataDragonCatalog:
        if not VERSION_PATTERN.fullmatch(version):
            raise ValueError("version must match N.N.N")
        if not LOCALE_PATTERN.fullmatch(locale):
            raise ValueError("locale must match ll_CC")
        registration = self._authorize("FETCH_CHAMPION_CATALOG")
        base = registration.base_urls[0].rstrip("/")
        url = f"{base}/cdn/{version}/data/{locale}/champion.json"
        response = self._fetch(url, registration.maximum_response_bytes)
        raw = self._parse_json(response)
        if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict):
            raise SourcePayloadError("champion catalog must contain a data object")
        payload_version = raw.get("version")
        if payload_version != version:
            raise SourcePayloadError(
                f"champion catalog version {payload_version!r} does not match request {version!r}"
            )
        champions: list[ChampionStaticData] = []
        for slug, item in sorted(raw["data"].items()):
            if not isinstance(item, dict):
                raise SourcePayloadError(f"champion {slug!r} is not an object")
            try:
                champion = ChampionStaticData(
                    champion_id=str(item["id"]),
                    numeric_key=str(item["key"]),
                    name=str(item["name"]),
                    title=str(item["title"]),
                    tags=tuple(str(tag) for tag in item["tags"]),
                )
            except (KeyError, TypeError) as exc:
                raise SourcePayloadError(f"champion {slug!r} is missing required fields") from exc
            champions.append(champion)
        if not champions:
            raise SourcePayloadError("champion catalog cannot be empty")
        return DataDragonCatalog(version, locale, tuple(champions), self._artifact(response))

    def _authorize(self, operation: str) -> SourceRegistration:
        return self.gate.require(self.source_id, operation, self.clock())

    def _fetch(self, url: str, maximum_bytes: int) -> HttpResponse:
        registration = self.registry.get(self.source_id)
        if registration is None:  # pragma: no cover - guarded in __init__
            raise AssertionError("source disappeared from registry")
        now = self.clock()
        if self._last_request_at is not None:
            elapsed = (now - self._last_request_at).total_seconds()
            remaining = registration.minimum_interval_seconds - elapsed
            if remaining > 0:
                self.sleeper(remaining)
        response = self.transport.fetch(url, maximum_bytes=maximum_bytes, user_agent=USER_AGENT)
        self._last_request_at = response.retrieved_at
        return response

    def _artifact(self, response: HttpResponse) -> RawSourceArtifact:
        return RawSourceArtifact.create(
            source_id=self.source_id,
            request_url=response.request_url,
            final_url=response.final_url,
            media_type=response.media_type,
            retrieved_at=response.retrieved_at,
            body=response.body,
        )

    @staticmethod
    def _parse_json(response: HttpResponse):
        try:
            return json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SourcePayloadError("source returned invalid UTF-8 JSON") from exc
