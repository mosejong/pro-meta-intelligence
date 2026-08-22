from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.ingestion.http import HttpResponse
from pro_meta_intelligence.ingestion.oe_download import (
    OracleElixirDownloadError,
    OracleElixirDownloadIntervalError,
    OracleElixirPublishedDownloadAdapter,
)
from pro_meta_intelligence.sources import SnapshotArchive, SourceRegistry

RETRIEVED_AT = datetime(2026, 8, 22, 10, 30, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"


class FakeTransport:
    def __init__(self, body: bytes, media_type: str = "text/csv") -> None:
        self.body = body
        self.media_type = media_type
        self.calls: list[str] = []

    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse:
        self.calls.append(url)
        assert len(self.body) <= maximum_bytes
        assert "ProMetaIntelligence" in user_agent
        return HttpResponse(url, url, 200, self.media_type, self.body, RETRIEVED_AT)


def fixture_csv() -> bytes:
    return (FIXTURES / "oracles_elixir_game.csv").read_bytes()


def test_adapter_fetches_only_manifested_official_file_and_validates_csv() -> None:
    transport = FakeTransport(fixture_csv())
    adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(),
        transport=transport,
        clock=lambda: RETRIEVED_AT,
    )

    downloaded = adapter.fetch_year(2026)

    assert downloaded.file.filename.startswith("2026_")
    assert downloaded.artifact.media_type == "text/csv"
    assert downloaded.artifact.content_hash.startswith("sha256:")
    assert transport.calls == [
        "https://drive.usercontent.google.com/download?"
        "id=1hnpbrUpBMS1TZI7IovfpKeZfWJH1Aptm&export=download&confirm=t"
    ]

    with pytest.raises(ValueError, match="not present"):
        adapter.fetch_year(2025)


def test_adapter_enforces_provider_daily_interval_before_network() -> None:
    transport = FakeTransport(fixture_csv())
    adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(),
        transport=transport,
        clock=lambda: RETRIEVED_AT,
    )

    with pytest.raises(OracleElixirDownloadIntervalError) as raised:
        adapter.fetch_year(2026, last_retrieved_at=RETRIEVED_AT - timedelta(hours=1))

    assert raised.value.retry_at == RETRIEVED_AT + timedelta(hours=23)
    assert transport.calls == []


def test_adapter_rejects_drive_quota_html_and_schema_drift() -> None:
    quota = FakeTransport(
        b"<!DOCTYPE html><title>Google Drive - Quota exceeded</title>", "text/html"
    )
    quota_adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(), transport=quota, clock=lambda: RETRIEVED_AT
    )
    with pytest.raises(OracleElixirDownloadError, match="quota-limited"):
        quota_adapter.fetch_year(2026)

    drift = FakeTransport(b"wrong,header\n1,2\n")
    drift_adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(), transport=drift, clock=lambda: RETRIEVED_AT
    )
    with pytest.raises(OracleElixirDownloadError, match="missing required columns"):
        drift_adapter.fetch_year(2026)


def test_csv_archive_uses_csv_extension_and_tracks_latest_retrieval(tmp_path) -> None:
    transport = FakeTransport(fixture_csv())
    adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(), transport=transport, clock=lambda: RETRIEVED_AT
    )
    archive = SnapshotArchive(tmp_path)

    stored = archive.store(adapter.fetch_year(2026).artifact)

    assert stored.data_path.suffix == ".csv"
    assert stored.data_path.read_bytes() == fixture_csv()
    assert archive.latest_retrieved_at(adapter.source_id) == RETRIEVED_AT
