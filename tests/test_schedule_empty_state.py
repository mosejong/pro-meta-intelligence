"""Explicit official empty schedule acceptance and its fail-closed boundaries."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.ingestion.http import HttpResponse
from pro_meta_intelligence.ingestion.lolesports_schedule import (
    LoLEsportsScheduleAdapter,
    SchedulePayloadError,
    is_explicit_empty_schedule,
    parse_schedule_html,
    parse_schedule_page,
)
from pro_meta_intelligence.publishing.health import _schedule_publication_check
from pro_meta_intelligence.sources import SourceRegistry

FIXTURES = Path(__file__).parent / "fixtures"
EMPTY_FIXTURE = FIXTURES / "lolesports_schedule_empty.html"
NORMAL_FIXTURE = FIXTURES / "lolesports_schedule.html"
RETRIEVED_AT = datetime(2026, 11, 19, 5, 0, tzinfo=UTC)
MARKER = "No More Upcoming Matches Available"
EMPTY_SECTION_OPEN = 'data-tag="empty">'
SWAP = '<script>$RC("B:1","S:1")</script>'
TRANSLATION_SCRIPT = (
    '<script>self.__next_f.push([1,"{\\"noMoreUpcomingMatchesAvailable\\":'
    '\\"No More Upcoming Matches Available\\",\\"checkBackSoon\\":'
    '\\"Check back soon to find more matches\\"}"])</script>'
)
UPCOMING_CARD = (
    '<div class="match-card"><time datetime="{start}">8:00 AM</time>'
    '<p class="team grid-c_1_/_1">T1<img alt="T1" src="t1.png"/></p>'
    '<p class="team grid-c_3_/_3"><img alt="Gen.G Esports" src="gen.png"/>GEN</p>'
    '<p class="c_home.card.subtext">LCK <span>•</span> Finals</p></div>'
)
DAMAGED_CARD = (
    '<div class="match-card"><time datetime="2026-11-25T08:00:00Z">8:00 AM</time>'
    '<p class="c_home.card.subtext">LCK <span>•</span> Finals</p></div>'
)


def empty_page() -> str:
    return EMPTY_FIXTURE.read_text(encoding="utf-8")


def with_feed_cards(cards: str) -> bytes:
    """Insert cards into the rendered upcoming feed just before the empty end marker."""
    page = empty_page()
    anchor = '<!--$--><div class="d_flex w_100% h_auto'
    assert page.count(anchor) == 1
    return page.replace(anchor, cards + anchor).encode("utf-8")


class FakeTransport:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.calls: list[str] = []

    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse:
        self.calls.append(url)
        assert len(self.body) <= maximum_bytes
        return HttpResponse(url, url, 200, "text/html", self.body, RETRIEVED_AT)


def build_adapter(body: bytes) -> tuple[LoLEsportsScheduleAdapter, FakeTransport]:
    transport = FakeTransport(body)
    adapter = LoLEsportsScheduleAdapter(
        SourceRegistry.load_default(), transport=transport, clock=lambda: RETRIEVED_AT
    )
    return adapter, transport


# --- accepted -------------------------------------------------------------------------------


def test_minimal_real_empty_page_is_an_explicit_empty_schedule() -> None:
    body = EMPTY_FIXTURE.read_bytes()

    assert is_explicit_empty_schedule(body)
    assert parse_schedule_page(body) == ()
    # the legacy strict API keeps its contract: no events is still an error there
    with pytest.raises(SchedulePayloadError, match="no semantic upcoming events"):
        parse_schedule_html(body)


def test_marker_title_without_subtitle_is_still_accepted() -> None:
    page = empty_page().replace(
        '<span class="c_home.empty.subtitle textStyle_label/sm">'
        "Check back soon to find more matches</span>",
        "",
    )
    assert is_explicit_empty_schedule(page.encode("utf-8"))


@pytest.mark.parametrize("script_type", ["text/javascript", "application/javascript", " "])
def test_explicit_classic_script_type_still_performs_the_swap(script_type: str) -> None:
    page = empty_page().replace(SWAP, f'<script type="{script_type}">$RC("B:1","S:1")</script>')
    assert is_explicit_empty_schedule(page.encode("utf-8"))


def test_adapter_returns_zero_event_snapshot_for_explicit_empty_page() -> None:
    adapter, transport = build_adapter(EMPTY_FIXTURE.read_bytes())

    snapshot = adapter.fetch(["lck", "worlds"])
    payload = snapshot.to_dict()

    assert transport.calls == ["https://lolesports.com/en-US/leagues/lck%2Cworlds"]
    assert snapshot.events == ()
    assert payload["events"] == []
    assert payload["quality"] == {"event_count": 0, "tbd_participant_count": 0}
    assert payload["content_hash"] == snapshot.artifact.content_hash
    assert snapshot.artifact.body == EMPTY_FIXTURE.read_bytes()


# --- rejected: no rendered evidence ---------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"<html><body></body></html>",
        b"<html><body>No schedule</body></html>",
        b"<html><body><h1>502 Bad Gateway</h1></body></html>",
        b'<html><body><form action="/login"><h1>Sign in</h1></form></body></html>',
        f"<html><body>{TRANSLATION_SCRIPT}</body></html>".encode(),
        f"<html><body><p>{MARKER}</p><span>Check back soon</span></body></html>".encode(),
        f'<html><body><section data-tag="other"><span>{MARKER}</span></section>'
        f"</body></html>".encode(),
        f'<html><body><template><section data-tag="empty"><span>{MARKER}</span></section>'
        f"</template></body></html>".encode(),
        f'<html><body><noscript><section data-tag="empty"><span>{MARKER}</span></section>'
        f"</noscript></body></html>".encode(),
        f'<html><body><script>document.body.innerHTML=\'<section data-tag="empty">'
        f"<span>{MARKER}</span></section>'</script></body></html>".encode(),
        "﻿<html>".encode("utf-16"),
    ],
    ids=[
        "empty-body",
        "unknown-empty-html",
        "unrelated-text",
        "error-page",
        "login-page",
        "translation-dictionary-only",
        "static-text-without-semantic-section",
        "wrong-section-tag",
        "inside-template",
        "inside-noscript",
        "inside-script-string",
        "non-utf8",
    ],
)
def test_pages_without_rendered_empty_evidence_fail_closed(body: bytes) -> None:
    assert not is_explicit_empty_schedule(body)
    with pytest.raises(SchedulePayloadError):
        parse_schedule_page(body)


def test_translation_dictionary_alone_is_not_evidence_even_on_the_real_shell() -> None:
    start = empty_page().index('<!--$--><div class="d_flex w_100% h_auto')
    end = empty_page().index("</section></div><!--/$-->") + len("</section></div><!--/$-->")
    page = empty_page()[:start] + empty_page()[end:]
    assert MARKER in page  # still present in the translation script
    assert not is_explicit_empty_schedule(page.encode("utf-8"))


@pytest.mark.parametrize(
    ("old", "new"),
    [
        (EMPTY_SECTION_OPEN, 'data-tag="empty" hidden>'),
        (EMPTY_SECTION_OPEN, 'data-tag="empty" aria-hidden="true">'),
        (EMPTY_SECTION_OPEN, 'data-tag="empty" style="display:none">'),
        (EMPTY_SECTION_OPEN, 'data-tag="empty" style="visibility: hidden">'),
        ('<section class="pos_relative d_flex"', '<section class="pos_relative d_none"'),
        (
            '<span class="c_white.100 textStyle_body/md">',
            '<span class="c_white.100 textStyle_body/md" aria-hidden="true">',
        ),
        (
            '<!--$?--><template id="B:1"></template>',
            '<div hidden><template id="B:1"></template></div>',
        ),
        ('<script>$RC("B:1","S:1")</script>', ""),
        ('<script>$RC("B:1","S:1")</script>', '<p>$RC("B:1","S:1")</p>'),
        ('<script>$RC("B:1","S:1")</script>', '<script>// $RC("B:1","S:1")</script>'),
        ('<script>$RC("B:1","S:1")</script>', '<script>/* x */ "$RC("B:1","S:1")</script>'),
        ('<script>$RC("B:1","S:1")</script>', '<script>var s = "$RC("B:1","S:1")";</script>'),
        (SWAP, '<script type="application/json">$RC("B:1","S:1")</script>'),
        (SWAP, '<script src="/unloaded-runtime.js">$RC("B:1","S:1")</script>'),
        (SWAP, '<script nomodule>$RC("B:1","S:1")</script>'),
        (SWAP, '<script type="module">$RC("B:1","S:1")</script>'),
        (SWAP, '<script type="text/plain">$RC("B:1","S:1")</script>'),
        (SWAP, '<template><script>$RC("B:1","S:1")</script></template>'),
        ('<template id="B:1"></template>', ""),
        ('<div hidden id="S:1">', '<div hidden id="S:9">'),
        ('<span class="vis_hidden">0</span>', '<span class="vis_hidden"></span>'),
    ],
    ids=[
        "hidden-attribute",
        "aria-hidden-section",
        "display-none",
        "visibility-hidden",
        "d_none-class",
        "aria-hidden-title",
        "placeholder-inside-hidden",
        "stream-never-swapped",
        "swap-call-only-as-text",
        "swap-call-in-line-comment",
        "swap-call-after-open-string",
        "swap-call-in-string-literal",
        "swap-in-json-script",
        "swap-in-external-src-script",
        "swap-in-nomodule-script",
        "swap-in-module-script",
        "swap-in-unknown-type-script",
        "swap-inside-template",
        "placeholder-missing",
        "boundary-id-mismatch",
        "completed-card-without-score",
    ],
)
def test_hidden_or_unswapped_markers_are_not_evidence(old: str, new: str) -> None:
    page = empty_page()
    assert old in page
    body = page.replace(old, new, 1).encode("utf-8")

    assert not is_explicit_empty_schedule(body)
    with pytest.raises(SchedulePayloadError, match="no semantic upcoming events"):
        parse_schedule_page(body)


def test_marker_section_with_extra_visible_text_is_not_evidence() -> None:
    page = empty_page().replace(
        "Check back soon to find more matches</span>",
        "Check back soon to find more matches</span><span>Something went wrong</span>",
    )
    assert not is_explicit_empty_schedule(page.encode("utf-8"))


# --- rejected: card markup present ----------------------------------------------------------


def test_damaged_time_card_with_end_marker_fails_closed() -> None:
    body = with_feed_cards(DAMAGED_CARD)

    assert not is_explicit_empty_schedule(body)
    with pytest.raises(SchedulePayloadError, match="no semantic upcoming events"):
        parse_schedule_page(body)
    adapter, _ = build_adapter(body)
    with pytest.raises(SchedulePayloadError) as caught:
        adapter.fetch(["lck"])
    assert caught.value.body == body


def test_unparseable_time_card_with_end_marker_fails_closed() -> None:
    body = with_feed_cards('<div><time>soon</time><p class="c_home.card.subtext">LCK • X</p></div>')
    assert not is_explicit_empty_schedule(body)
    with pytest.raises(SchedulePayloadError):
        parse_schedule_page(body)


def test_card_label_without_time_or_score_with_end_marker_fails_closed() -> None:
    """An upcoming card whose time markup drifted must not be mistaken for a completed card."""
    drifted = (
        '<div><p class="grid-c_1_/_1">T1<img alt="T1" src="t1.png"/></p>'
        '<span class="start">Nov 25 8:00 AM</span>'
        # real upcoming cards carry the same separator, but with empty score cells
        '<div><span class=""></span><div aria-orientation="vertical" role="separator"></div>'
        '<span class=""></span></div>'
        '<p class="grid-c_3_/_3"><img alt="Gen.G Esports" src="gen.png"/>GEN</p>'
        '<p class="c_home.card.subtext">LCK <span>•</span> Finals</p></div>'
    )
    body = with_feed_cards(drifted)
    assert not is_explicit_empty_schedule(body)
    with pytest.raises(SchedulePayloadError, match="no semantic upcoming events"):
        parse_schedule_page(body)


def test_valid_cards_take_priority_over_end_marker() -> None:
    body = with_feed_cards(UPCOMING_CARD.format(start="2026-11-25T08:00:00Z"))

    events = parse_schedule_page(body)
    assert len(events) == 1
    assert [participant.name for participant in events[0].participants] == ["T1", "Gen.G Esports"]
    assert not is_explicit_empty_schedule(body)
    snapshot, _ = build_adapter(body)
    assert len(snapshot.fetch(["lck"]).events) == 1


def test_valid_and_damaged_cards_with_end_marker_fail_closed() -> None:
    body = with_feed_cards(UPCOMING_CARD.format(start="2026-11-25T08:00:00Z") + DAMAGED_CARD)

    with pytest.raises(SchedulePayloadError, match="incomplete event cards"):
        parse_schedule_page(body)
    adapter, _ = build_adapter(body)
    with pytest.raises(SchedulePayloadError, match="incomplete event cards") as caught:
        adapter.fetch(["lck"])
    assert caught.value.body == body


def test_past_cards_only_with_end_marker_still_fail_closed() -> None:
    body = with_feed_cards(UPCOMING_CARD.format(start="2026-11-14T08:00:00Z"))
    adapter, _ = build_adapter(body)

    with pytest.raises(SchedulePayloadError, match="no future events") as caught:
        adapter.fetch(["lck"])
    assert caught.value.body == body


def test_existing_normal_schedule_contract_is_unchanged() -> None:
    body = NORMAL_FIXTURE.read_bytes()

    assert parse_schedule_page(body) == parse_schedule_html(body)
    assert not is_explicit_empty_schedule(body)
    # without an end marker, the legacy tolerance for an incomplete card is preserved
    tolerant = body.replace(b"</body>", DAMAGED_CARD.encode("utf-8") + b"</body>")
    assert parse_schedule_page(tolerant) == parse_schedule_html(body)


# --- CLI / health / web contracts -----------------------------------------------------------


def test_cli_publishes_explicit_empty_snapshot_with_no_next_match(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = FakeTransport(EMPTY_FIXTURE.read_bytes())

    def adapter_with_fake_network(registry: SourceRegistry) -> LoLEsportsScheduleAdapter:
        return LoLEsportsScheduleAdapter(registry, transport=transport, clock=lambda: RETRIEVED_AT)

    monkeypatch.setattr(
        "pro_meta_intelligence.cli.LoLEsportsScheduleAdapter", adapter_with_fake_network
    )
    output = tmp_path / "schedule.json"
    changes = tmp_path / "schedule-changes.json"
    diagnostics = tmp_path / "diagnostics"

    exit_code = main(
        [
            "fetch-schedule",
            "--archive-dir",
            str(tmp_path / "raw"),
            "--output",
            str(output),
            "--changes-output",
            str(changes),
            "--watch-team",
            "T1",
            "--diagnostics-dir",
            str(diagnostics),
        ]
    )

    assert exit_code == 0
    assert len(transport.calls) == 1
    assert not diagnostics.exists()
    stdout = capsys.readouterr().out
    assert "SOURCE_UNAVAILABLE" not in stdout
    snapshot = json.loads(output.read_text(encoding="utf-8"))
    assert snapshot["events"] == []
    assert snapshot["quality"] == {"event_count": 0, "tbd_participant_count": 0}
    assert snapshot["retrieved_at"] == RETRIEVED_AT.isoformat()
    assert not any("next" in key for key in snapshot)
    raw_files = [path for path in (tmp_path / "raw").rglob("*.html")]
    assert len(raw_files) == 1
    assert raw_files[0].read_bytes() == EMPTY_FIXTURE.read_bytes()

    change_log = json.loads(changes.read_text(encoding="utf-8"))
    assert change_log["current_snapshot"]["content_hash"] == snapshot["content_hash"]
    assert change_log["latest_run"]["changes"] == []

    health = _schedule_publication_check(snapshot)
    assert health["passed"] is True
    assert health["observed"]["event_count"] == 0

    # mirrors web/app/radar-types.ts isScheduleSnapshot
    assert snapshot["schema_version"] == "1"
    assert snapshot["artifact_type"] == "pro-schedule-snapshot"
    for key in ("source_id", "source_url", "retrieved_at", "available_at", "content_hash"):
        assert isinstance(snapshot[key], str)
    assert isinstance(snapshot["locale"], str)
    assert all(isinstance(item, str) for item in snapshot["league_slugs"])
    assert isinstance(snapshot["boundary"], str)


def test_cli_rejected_lookalike_preserves_last_snapshot(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    body = with_feed_cards(DAMAGED_CARD)
    transport = FakeTransport(body)

    def adapter_with_fake_network(registry: SourceRegistry) -> LoLEsportsScheduleAdapter:
        return LoLEsportsScheduleAdapter(registry, transport=transport, clock=lambda: RETRIEVED_AT)

    monkeypatch.setattr(
        "pro_meta_intelligence.cli.LoLEsportsScheduleAdapter", adapter_with_fake_network
    )
    output = tmp_path / "schedule.json"
    original = json.dumps(
        {
            "schema_version": "1",
            "artifact_type": "pro-schedule-snapshot",
            "retrieved_at": "2026-11-18T00:00:00+00:00",
            "content_hash": f"sha256:{'a' * 64}",
            "events": [],
        }
    )
    output.write_text(original, encoding="utf-8")

    exit_code = main(
        [
            "fetch-schedule",
            "--archive-dir",
            str(tmp_path / "raw"),
            "--output",
            str(output),
            "--changes-output",
            str(tmp_path / "schedule-changes.json"),
            "--diagnostics-dir",
            str(tmp_path / "diagnostics"),
        ]
    )

    assert exit_code == 4
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "SOURCE_UNAVAILABLE"
    assert result["existing_snapshot_preserved"] is True
    assert output.read_text(encoding="utf-8") == original
    assert (tmp_path / "diagnostics" / "source-page.html").read_bytes() == body
