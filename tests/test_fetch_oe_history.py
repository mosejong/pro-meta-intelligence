"""Historical seasons share one persisted provider-attempt interval."""

import json
from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.ingestion.http import HttpTransportError
from pro_meta_intelligence.ingestion.oe_download import (
    OracleElixirDownloadError,
    OracleElixirPublishedDownloadAdapter,
    archive_for_year,
)
from pro_meta_intelligence.sources import (
    ArchivedSnapshot,
    ArchiveInspection,
    SourceAttemptLedger,
    SourceRegistry,
)
from tests.test_oe_download import FakeTransport, fixture_csv
from tests.test_player_career import archive

NOW = datetime(2026, 11, 18, tzinfo=UTC)


def test_reviewed_historical_file_ids_are_exact_and_unreviewed_year_fails_closed():
    expected = {
        2015: "1qyckLuw0-hJM8XqFhlV9l1xAbr3H78T_",
        2020: "1dlSIczXShnv1vIfGNvBjgk-thMKA5j7d",
        2021: "1fzwTTz77hcnYjOnO9ONeoPrkWCoOSecA",
        2022: "1EHmptHyzY8owv0BAcNKtkQpMwfkURwRy",
    }
    for year, file_id in expected.items():
        transport = FakeTransport(fixture_csv())
        adapter = OracleElixirPublishedDownloadAdapter(
            SourceRegistry.load_default(), transport=transport, clock=lambda: NOW
        )
        downloaded = adapter.fetch_year(year)
        assert downloaded.file.year == year
        assert transport.calls == [
            f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
        ]
    transport = FakeTransport(fixture_csv())
    adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(), transport=transport, clock=lambda: NOW
    )
    with pytest.raises(ValueError, match="not present"):
        adapter.fetch_year(2013)
    assert not transport.calls


def test_manifest_covers_every_reviewed_year_from_2014_to_2026():
    adapter = OracleElixirPublishedDownloadAdapter(SourceRegistry.load_default(), clock=lambda: NOW)
    assert set(adapter.files) == set(range(2014, 2027))
    assert adapter.files[2025].file_id == "1v6LRphp2kYciU4SXp0PCjEMuev1bDejc"


def test_sparse_historical_acquisition_does_not_relax_current_draft_schema():
    text, _ = archive()
    transport = FakeTransport(text.encode())
    adapter = OracleElixirPublishedDownloadAdapter(
        SourceRegistry.load_default(), transport=transport, clock=lambda: NOW
    )
    assert adapter.fetch_year(2015, historical_usage_only=True).file.year == 2015
    with pytest.raises(OracleElixirDownloadError, match="missing required columns"):
        adapter.fetch_year(2015)
    count = len(transport.calls)
    with pytest.raises(ValueError, match="limited to past"):
        adapter.fetch_year(2026, historical_usage_only=True)
    assert len(transport.calls) == count


def test_newer_historical_download_is_not_a_current_year_cache(tmp_path):
    def snapshot(year, when):
        file_id = {
            2022: "1EHmptHyzY8owv0BAcNKtkQpMwfkURwRy",
            2026: "1hnpbrUpBMS1TZI7IovfpKeZfWJH1Aptm",
        }[year]
        return ArchivedSnapshot(
            tmp_path / f"{year}.csv",
            tmp_path / f"{year}.meta.json",
            when,
            "sha256:test",
            f"https://drive.usercontent.google.com/download?id={file_id}",
            1,
        )

    current = snapshot(2026, NOW.replace(day=11))
    historical = snapshot(2022, NOW)
    inspection = ArchiveInspection("oracles-elixir-match-data", (current, historical), ())
    assert archive_for_year(inspection, 2026).snapshots == (current,)
    assert archive_for_year(inspection, 2022).snapshots == (historical,)
    assert archive_for_year(inspection, 2015).snapshots == ()


@pytest.mark.parametrize("transport_failure", [False, True])
def test_failed_fetch_cannot_retry_with_another_year(tmp_path, monkeypatch, transport_failure):
    class Transport(FakeTransport):
        def fetch(self, *args, **kwargs):
            if transport_failure:
                self.calls.append(args[0])
                raise HttpTransportError("synthetic connection failure")
            return super().fetch(*args, **kwargs)

    transport = Transport(b"<!DOCTYPE html>quota", "text/html")
    monkeypatch.setattr(
        "pro_meta_intelligence.cli.OracleElixirPublishedDownloadAdapter",
        lambda registry: OracleElixirPublishedDownloadAdapter(
            registry, transport=transport, clock=lambda: NOW
        ),
    )
    archive = tmp_path / "raw"
    first, second = tmp_path / "first.json", tmp_path / "second.json"
    assert (
        main(["fetch-oe", "--year", "2022", "--archive-dir", str(archive), "--output", str(first)])
        == 4
    )
    assert json.loads(first.read_text())["status"] == "SOURCE_UNAVAILABLE"
    assert (
        SourceAttemptLedger(archive).latest_attempted_at(
            "oracles-elixir-match-data", "FETCH_PUBLISHED_CSV"
        )
        == NOW
    )
    assert (
        main(["fetch-oe", "--year", "2020", "--archive-dir", str(archive), "--output", str(second)])
        == 3
    )
    assert json.loads(second.read_text())["network_collection_performed"] is False
    assert len(transport.calls) == 1
