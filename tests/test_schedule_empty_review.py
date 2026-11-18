"""Independent checks that stream placeholders really become rendered content."""

from pathlib import Path

import pytest

from pro_meta_intelligence.ingestion.lolesports_schedule import (
    SchedulePayloadError,
    is_explicit_empty_schedule,
    parse_schedule_page,
)


@pytest.mark.parametrize(
    "replacement",
    [
        '<script>/* $RC("B:1","S:1") */</script>',
        '<script>const example = \'$RC("B:1","S:1")\';</script>',
        '<script type="application/json">$RC("B:1","S:1")</script>',
        '<script src="/unloaded-runtime.js">$RC("B:1","S:1")</script>',
    ],
)
def test_inert_swap_text_does_not_confirm_hidden_empty_schedule(replacement):
    page = (Path(__file__).parent / "fixtures/lolesports_schedule_empty.html").read_text(
        encoding="utf-8"
    )
    call = '<script>$RC("B:1","S:1")</script>'
    assert page.count(call) == 1
    assert is_explicit_empty_schedule(page.encode())
    inert = page.replace(call, replacement).encode()
    assert not is_explicit_empty_schedule(inert)
    with pytest.raises(SchedulePayloadError):
        parse_schedule_page(inert)
