from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.ingestion.ddragon import DataDragonAdapter, SourcePayloadError
from pro_meta_intelligence.ingestion.http import HttpResponse
from pro_meta_intelligence.sources import (
    SnapshotArchive,
    SourcePolicyError,
    SourceRegistry,
    SourceStatus,
)

RETRIEVED_AT = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"


class FakeTransport:
    def __init__(self, responses: dict[str, bytes]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse:
        self.calls.append(url)
        body = self.responses[url]
        assert len(body) <= maximum_bytes
        assert "ProMetaIntelligence" in user_agent
        return HttpResponse(url, url, 200, "application/json", body, RETRIEVED_AT)


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def build_adapter() -> tuple[DataDragonAdapter, FakeTransport]:
    base = "https://ddragon.leagueoflegends.com"
    transport = FakeTransport(
        {
            f"{base}/api/versions.json": fixture_bytes("ddragon_versions.json"),
            f"{base}/cdn/16.15.1/data/en_US/champion.json": fixture_bytes("ddragon_champions.json"),
        }
    )
    adapter = DataDragonAdapter(
        SourceRegistry.load_default(),
        transport=transport,
        clock=lambda: RETRIEVED_AT,
        sleeper=lambda _: None,
    )
    return adapter, transport


def test_adapter_fetches_allowlisted_version_and_catalog_paths() -> None:
    adapter, transport = build_adapter()

    versions = adapter.fetch_versions()
    catalog = adapter.fetch_champion_catalog(versions.versions[0])

    assert versions.versions == ("16.15.1", "16.14.1", "15.24.1")
    assert [champion.champion_id for champion in catalog.champions] == ["Annie", "Olaf"]
    assert transport.calls == [
        "https://ddragon.leagueoflegends.com/api/versions.json",
        "https://ddragon.leagueoflegends.com/cdn/16.15.1/data/en_US/champion.json",
    ]


def test_normalization_requires_explicit_release_time_and_preserves_provenance() -> None:
    adapter, _ = build_adapter()
    catalog = adapter.fetch_champion_catalog("16.15.1")

    snapshot = catalog.to_snapshot(release_at=datetime(2026, 8, 20, tzinfo=UTC))

    assert snapshot.observed_at == datetime(2026, 8, 20, tzinfo=UTC)
    assert snapshot.available_at == RETRIEVED_AT
    assert snapshot.provenance.content_hash.startswith("sha256:")
    assert snapshot.provenance.source_uri.endswith("/champion.json")

    with pytest.raises(ValueError, match="available_at"):
        catalog.to_snapshot(release_at=RETRIEVED_AT + timedelta(days=1))


def test_adapter_rejects_untrusted_path_inputs_before_transport() -> None:
    adapter, transport = build_adapter()

    with pytest.raises(ValueError, match="version"):
        adapter.fetch_champion_catalog("../../secrets")
    with pytest.raises(ValueError, match="locale"):
        adapter.fetch_champion_catalog("16.15.1", "../../ko_KR")
    assert transport.calls == []


def test_policy_gate_blocks_transport_when_source_is_not_enabled() -> None:
    registry = SourceRegistry.load_default()
    registration = registry.get("riot-data-dragon")
    blocked_registry = SourceRegistry((replace(registration, status=SourceStatus.REVIEW_REQUIRED),))
    _, transport = build_adapter()
    adapter = DataDragonAdapter(
        blocked_registry,
        transport=transport,
        clock=lambda: RETRIEVED_AT,
        sleeper=lambda _: None,
    )

    with pytest.raises(SourcePolicyError, match="SOURCE_NOT_ENABLED"):
        adapter.fetch_versions()
    assert transport.calls == []


def test_adapter_rejects_payload_version_mismatch() -> None:
    adapter, transport = build_adapter()
    url = "https://ddragon.leagueoflegends.com/cdn/16.15.1/data/en_US/champion.json"
    transport.responses[url] = fixture_bytes("ddragon_champions.json").replace(
        b'"16.15.1"', b'"0.0.0"', 1
    )

    with pytest.raises(SourcePayloadError, match="does not match"):
        adapter.fetch_champion_catalog("16.15.1")


def test_snapshot_archive_is_content_addressed_and_idempotent(tmp_path) -> None:
    adapter, _ = build_adapter()
    artifact = adapter.fetch_champion_catalog("16.15.1").artifact
    archive = SnapshotArchive(tmp_path)

    first = archive.store(artifact)
    second = archive.store(artifact)

    assert first == second
    assert first.data_path.read_bytes() == artifact.body
    assert first.metadata_path.is_file()


def test_snapshot_archive_keeps_distinct_retrieval_metadata_for_unchanged_bytes(tmp_path) -> None:
    adapter, _ = build_adapter()
    artifact = adapter.fetch_champion_catalog("16.15.1").artifact
    later = replace(artifact, retrieved_at=artifact.retrieved_at + timedelta(hours=1))
    archive = SnapshotArchive(tmp_path)

    first = archive.store(artifact)
    second = archive.store(later)

    assert first.data_path == second.data_path
    assert first.metadata_path != second.metadata_path
    assert first.metadata_path.is_file() and second.metadata_path.is_file()
