from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.ingestion.http import HttpResponse
from pro_meta_intelligence.ingestion.lolesports_schedule import (
    LoLEsportsScheduleAdapter,
    ScheduleFetchIntervalError,
    SchedulePayloadError,
    parse_schedule_html,
)
from pro_meta_intelligence.sources import (
    SnapshotArchive,
    SourcePolicyError,
    SourceRegistry,
    SourceStatus,
)

RETRIEVED_AT = datetime(2026, 8, 24, 8, 0, tzinfo=UTC)
FIXTURE = Path(__file__).parent / "fixtures" / "lolesports_schedule.html"


class FakeTransport:
    def __init__(self, body: bytes | None = None, media_type: str = "text/html") -> None:
        self.body = body if body is not None else FIXTURE.read_bytes()
        self.media_type = media_type
        self.calls: list[str] = []

    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse:
        self.calls.append(url)
        assert len(self.body) <= maximum_bytes
        assert "ProMetaIntelligence" in user_agent
        return HttpResponse(url, url, 200, self.media_type, self.body, RETRIEVED_AT)


def build_adapter(
    transport: FakeTransport | None = None,
) -> tuple[LoLEsportsScheduleAdapter, FakeTransport]:
    selected = transport or FakeTransport()
    return (
        LoLEsportsScheduleAdapter(
            SourceRegistry.load_default(),
            transport=selected,
            clock=lambda: RETRIEVED_AT,
        ),
        selected,
    )


def test_parser_extracts_semantic_upcoming_schedule_cards() -> None:
    events = parse_schedule_html(FIXTURE.read_bytes())

    assert len(events) == 2
    assert events[0].start_at == datetime(2026, 8, 26, 8, 0, tzinfo=UTC)
    assert events[0].league == "LCK"
    assert events[0].block == "Play-Ins"
    assert events[0].best_of == 5
    assert [participant.name for participant in events[0].participants] == [
        "kt Rolster",
        "HANJIN BRION",
    ]
    assert [participant.code for participant in events[1].participants] == ["TBD", "T1"]
    assert events[0].event_id.startswith("lolesports:")


def test_adapter_uses_one_allowlisted_official_schedule_url_and_normalizes_snapshot() -> None:
    adapter, transport = build_adapter()

    snapshot = adapter.fetch(["LCK", "lec", "lck"], locale="en-US")
    payload = snapshot.to_dict()

    assert transport.calls == ["https://lolesports.com/en-US/leagues/lck%2Clec"]
    assert snapshot.league_slugs == ("lck", "lec")
    assert payload["artifact_type"] == "pro-schedule-snapshot"
    assert payload["quality"] == {"event_count": 2, "tbd_participant_count": 1}
    assert payload["retrieved_at"] == RETRIEVED_AT.isoformat()
    assert payload["events"][0]["participants"][0]["name"] == "kt Rolster"


def test_adapter_rejects_arbitrary_paths_wrong_media_and_empty_markup() -> None:
    adapter, transport = build_adapter()

    with pytest.raises(ValueError, match="league slugs"):
        adapter.fetch(["../../admin"])
    with pytest.raises(ValueError, match="locale"):
        adapter.fetch(["lck"], locale="../ko-KR")
    assert transport.calls == []

    wrong_media, _ = build_adapter(FakeTransport(media_type="application/json"))
    with pytest.raises(SchedulePayloadError, match="text/html"):
        wrong_media.fetch(["lck"])

    with pytest.raises(SchedulePayloadError, match="no semantic upcoming events"):
        parse_schedule_html(b"<html><body>No schedule</body></html>")


def test_adapter_excludes_events_that_are_already_past_at_retrieval() -> None:
    body = FIXTURE.read_bytes().replace(
        b"2026-08-26T08:00:00Z",
        b"2026-08-23T08:00:00Z",
        1,
    )
    adapter, _ = build_adapter(FakeTransport(body=body))

    snapshot = adapter.fetch(["lck"])

    assert len(snapshot.events) == 1
    assert snapshot.events[0].start_at == datetime(2026, 8, 29, 8, 0, tzinfo=UTC)


def test_adapter_enforces_registry_status_and_cross_process_fetch_interval() -> None:
    registry = SourceRegistry.load_default()
    registration = registry.get("lol-esports-schedule")
    assert registration is not None
    blocked = SourceRegistry((replace(registration, status=SourceStatus.REVIEW_REQUIRED),))
    transport = FakeTransport()
    adapter = LoLEsportsScheduleAdapter(
        blocked,
        transport=transport,
        clock=lambda: RETRIEVED_AT,
    )
    with pytest.raises(SourcePolicyError, match="SOURCE_NOT_ENABLED"):
        adapter.fetch(["lck"])
    assert transport.calls == []

    enabled, _ = build_adapter()
    with pytest.raises(ScheduleFetchIntervalError) as error:
        enabled.fetch(["lck"], last_retrieved_at=RETRIEVED_AT - timedelta(hours=1))
    assert error.value.retry_at == RETRIEVED_AT + timedelta(hours=5)


def test_schedule_raw_html_is_archived_with_provenance(tmp_path: Path) -> None:
    adapter, _ = build_adapter()
    snapshot = adapter.fetch(["lck"])

    stored = SnapshotArchive(tmp_path).store(snapshot.artifact)

    assert stored.data_path.suffix == ".html"
    assert stored.data_path.read_bytes() == FIXTURE.read_bytes()
    assert stored.metadata_path.is_file()
