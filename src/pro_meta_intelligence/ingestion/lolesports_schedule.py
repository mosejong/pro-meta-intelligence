"""Policy-gated adapter for the official LoL Esports schedule page."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from urllib.parse import quote, urlparse

from pro_meta_intelligence._version import USER_AGENT
from pro_meta_intelligence.ingestion.http import HttpTransport, UrllibTransport
from pro_meta_intelligence.models import require_aware
from pro_meta_intelligence.sources import (
    PolicyGate,
    RawSourceArtifact,
    SourceRegistration,
    SourceRegistry,
)
from pro_meta_intelligence.temporal import parse_datetime

LOCALE_PATTERN = re.compile(r"^[a-z]{2}-[A-Z]{2}$")
LEAGUE_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
BEST_OF_PATTERN = re.compile(r"^best of ([1-9][0-9]?)$", re.IGNORECASE)


class SchedulePayloadError(ValueError):
    """The schedule page could not be read; keeps the public page body when one arrived."""

    def __init__(self, message: str, *, body: bytes | None = None) -> None:
        super().__init__(message)
        self.body = body


class ScheduleFetchIntervalError(RuntimeError):
    def __init__(self, retry_at: datetime) -> None:
        self.retry_at = retry_at
        super().__init__(f"schedule source cannot be fetched again before {retry_at.isoformat()}")


@dataclass(frozen=True, slots=True)
class ScheduleParticipant:
    name: str
    code: str

    def to_dict(self) -> dict[str, str]:
        return {"name": self.name, "code": self.code}


@dataclass(frozen=True, slots=True)
class ScheduleEvent:
    event_id: str
    start_at: datetime
    league: str
    block: str
    best_of: int | None
    participants: tuple[ScheduleParticipant, ScheduleParticipant]

    def __post_init__(self) -> None:
        require_aware(self.start_at, "start_at")
        if not self.event_id or len(self.participants) != 2:
            raise ValueError("schedule events require an ID and two participants")

    def to_dict(self) -> dict[str, object]:
        return {
            "event_id": self.event_id,
            "start_at": self.start_at.isoformat(),
            "league": self.league,
            "block": self.block,
            "best_of": self.best_of,
            "participants": [participant.to_dict() for participant in self.participants],
        }


@dataclass(frozen=True, slots=True)
class ScheduleSnapshot:
    locale: str
    league_slugs: tuple[str, ...]
    events: tuple[ScheduleEvent, ...]
    artifact: RawSourceArtifact

    def to_dict(self) -> dict[str, object]:
        tbd_count = sum(
            participant.name.upper() == "TBD"
            for event in self.events
            for participant in event.participants
        )
        return {
            "schema_version": "1",
            "artifact_type": "pro-schedule-snapshot",
            "source_id": self.artifact.source_id,
            "source_url": self.artifact.final_url,
            "retrieved_at": self.artifact.retrieved_at.isoformat(),
            "available_at": self.artifact.retrieved_at.isoformat(),
            "content_hash": self.artifact.content_hash,
            "locale": self.locale,
            "league_slugs": list(self.league_slugs),
            "events": [event.to_dict() for event in self.events],
            "quality": {
                "event_count": len(self.events),
                "tbd_participant_count": tbd_count,
            },
            "boundary": (
                "Official public schedule facts only. Times and participants may change at the "
                "source; no match outcome, roster, or private team intent is inferred."
            ),
        }


@dataclass(slots=True)
class _EventBuilder:
    start_at: datetime
    teams: list[dict[str, object]]
    league: str = ""
    block: str = ""
    best_of: int | None = None
    filled_slots: set[int] = field(default_factory=set)


class _ScheduleHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[ScheduleEvent] = []
        self.current: _EventBuilder | None = None
        self.team_slot: int | None = None
        self.team_text: list[str] = []
        self.subtext = False
        self.subtext_parts: list[str] = []
        self.incomplete_card_count = 0

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        if tag == "time" and attrs.get("datetime"):
            self._flush()
            try:
                start_at = parse_datetime(str(attrs["datetime"]))
            except ValueError as exc:
                raise SchedulePayloadError("schedule contains an invalid datetime") from exc
            self.current = _EventBuilder(start_at=start_at, teams=[{}, {}])
            return
        if self.current is None:
            return
        if tag == "section" and attrs.get("data-tag"):
            # date/empty/media feed separators always close the open card
            self._flush()
            return
        if tag == "p":
            classes = attrs.get("class") or ""
            slot = None
            if "c_home.card.subtext" in classes:
                self.subtext = True
                self.subtext_parts = []
            elif "grid-c_1_/_1" in classes:
                slot = 0
            elif "grid-c_3_/_3" in classes:
                slot = 1
            if slot is not None:
                if self.current.league or slot in self.current.filled_slots:
                    # a team row after this card's league label, or a repeated slot, belongs to a
                    # following card without a start time; never merge it into this card
                    self._flush()
                    return
                self.current.filled_slots.add(slot)
                self.team_slot = slot
                self.team_text = []
            aria_label = attrs.get("aria-label") or ""
            match = BEST_OF_PATTERN.fullmatch(aria_label.strip())
            if match:
                self.current.best_of = int(match.group(1))
        elif tag == "img" and self.team_slot is not None:
            alt = (attrs.get("alt") or "").strip()
            if alt:
                self.current.teams[self.team_slot]["name"] = alt

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.current is None:
            return
        text = data.strip()
        if not text:
            return
        if self.team_slot is not None:
            self.team_text.append(text)
        if self.subtext:
            self.subtext_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if self.current is None or tag != "p":
            return
        if self.team_slot is not None:
            code = " ".join(self.team_text).strip()
            if code:
                self.current.teams[self.team_slot]["code"] = code
            self.team_slot = None
            self.team_text = []
        if self.subtext:
            label = " ".join(self.subtext_parts).strip()
            if "•" in label:
                league, block = (part.strip() for part in label.split("•", 1))
                self.current.league = league
                self.current.block = block
            self.subtext = False
            self.subtext_parts = []

    def close(self) -> None:
        super().close()
        self._flush()

    def _flush(self) -> None:
        if self.current is None:
            return
        teams: list[ScheduleParticipant] = []
        for raw in self.current.teams:
            name = str(raw.get("name") or raw.get("code") or "").strip()
            code = str(raw.get("code") or name).strip()
            if not name:
                break
            teams.append(ScheduleParticipant(name=name, code=code))
        if len(teams) != 2:
            self.incomplete_card_count += 1
        if len(teams) == 2:
            identity = "|".join(
                [
                    self.current.start_at.isoformat(),
                    self.current.league,
                    teams[0].name,
                    teams[1].name,
                ]
            )
            digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
            self.events.append(
                ScheduleEvent(
                    event_id=f"lolesports:{digest}",
                    start_at=self.current.start_at,
                    league=self.current.league or "UNKNOWN",
                    block=self.current.block or "UNSPECIFIED",
                    best_of=self.current.best_of,
                    participants=(teams[0], teams[1]),
                )
            )
        self.current = None


EMPTY_SCHEDULE_TITLE = "No More Upcoming Matches Available"
EMPTY_SCHEDULE_SUBTITLE = "Check back soon to find more matches"
_ACCEPTED_EMPTY_TEXTS = frozenset(
    {EMPTY_SCHEDULE_TITLE, f"{EMPTY_SCHEDULE_TITLE} {EMPTY_SCHEDULE_SUBTITLE}"}
)
# React streaming SSR: `<template id="B:n">` placeholder, `<div hidden id="S:n">` content, and a
# `$RC("B:n","S:n")` script that swaps the content into the placeholder.
_STREAM_SWAP_CALL = re.compile(r'\$RC\("B:(\d+)","S:(\d+)"\);?$')
_STREAM_CONTENT_ID = re.compile(r"^S:(\d+)$")
_STREAM_PLACEHOLDER_ID = re.compile(r"^B:(\d+)$")
_NON_RENDERED_TAGS = frozenset({"script", "style", "template", "noscript", "head", "title"})
_VOID_TAGS = frozenset(
    {
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
        "param", "source", "track", "wbr",
    }
)  # fmt: skip
_HIDDEN_CLASS_TOKENS = frozenset({"d_none", "vis_hidden", "hidden", "sr-only"})
_HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.IGNORECASE)
CARD_LABEL_CLASS = "c_home.card.subtext"
# Classic inline script MIME types (HTML spec "JavaScript MIME type essence matches", plus the
# empty/absent type). `module` is excluded conservatively: React's swap runtime is classic.
_EXECUTABLE_SCRIPT_TYPES = frozenset(
    {
        "",
        "text/javascript",
        "application/javascript",
        "application/ecmascript",
        "application/x-javascript",
        "text/ecmascript",
        "text/jscript",
        "text/x-javascript",
        "text/x-ecmascript",
    }
)
# Scripts inside these are treated as inert (template/noscript content never runs in place;
# foreign-content and raw-text containers are excluded conservatively).
_INERT_SCRIPT_CONTAINERS = frozenset({"template", "noscript", "svg", "math", "textarea", "xmp"})


def _executable_stream_swap(script: str) -> tuple[str, str] | None:
    """Return (placeholder, content) ids only when `$RC(...)` is the script's trailing statement.

    React emits either `$RC("B:n","S:n")` alone or the runtime definition followed by `;$RC(...)`.
    A call that only appears inside a comment or string literal never runs and is ignored.
    """
    source = script.strip()
    match = _STREAM_SWAP_CALL.search(source)
    if match is None:
        return None
    prefix = source[: match.start()]
    if prefix:
        last_line = prefix.rsplit("\n", 1)[-1]
        if prefix[-1] not in ";}" or "//" in last_line or prefix.count("/*") != prefix.count("*/"):
            return None
    return match.group(1), match.group(2)


@dataclass(frozen=True, slots=True)
class _Frame:
    tag: str
    suppressed: bool
    boundaries: tuple[str, ...]
    empty_section: int | None
    text_start: int = 0


@dataclass(slots=True)
class _EmptySection:
    suppressed: bool
    boundaries: tuple[str, ...]
    texts: list[str]


class _EmptyStateScanner(HTMLParser):
    """Collects structural evidence for an explicitly rendered "no upcoming matches" feed end.

    Text inside script/style/template/noscript, `hidden`, `aria-hidden`, `display:none`,
    `visibility:hidden`, or hiding utility classes never counts as evidence. React streaming
    boundaries count as rendered only when a real swap script and a rendered placeholder exist.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[_Frame] = []
        self.time_tag_count = 0
        self.card_label_count = 0
        self.completed_card_count = 0
        self._text_runs: list[str] = []
        self._score_containers: set[int] = set()
        self.empty_sections: list[_EmptySection] = []
        self.placeholders: dict[str, tuple[bool, tuple[str, ...]]] = {}
        self.swaps: dict[str, str] = {}
        self._label_parts: list[str] | None = None
        self._script_parts: list[str] | None = None
        self._inert_script = False

    def _parent(self) -> _Frame:
        return self.stack[-1] if self.stack else _Frame("", False, (), None)

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key.lower(): value for key, value in attrs_list}
        parent = self._parent()
        classes = set((attrs.get("class") or "").split())
        element_id = (attrs.get("id") or "").strip()
        boundaries = parent.boundaries
        hidden = (
            "hidden" in attrs
            or (attrs.get("aria-hidden") or "").strip().lower() == "true"
            or bool(_HIDDEN_STYLE.search(attrs.get("style") or ""))
            or bool(classes & _HIDDEN_CLASS_TOKENS)
        )
        stream_content = _STREAM_CONTENT_ID.fullmatch(element_id)
        if tag == "div" and "hidden" in attrs and stream_content:
            boundaries = (*boundaries, stream_content.group(1))
            hidden = False
        placeholder = _STREAM_PLACEHOLDER_ID.fullmatch(element_id)
        if tag == "template" and placeholder:
            self.placeholders.setdefault(
                placeholder.group(1), (parent.suppressed, parent.boundaries)
            )
        suppressed = parent.suppressed or hidden or tag in _NON_RENDERED_TAGS
        empty_section = parent.empty_section
        if tag == "section" and (attrs.get("data-tag") or "").strip() == "empty":
            self.empty_sections.append(_EmptySection(suppressed, boundaries, []))
            empty_section = len(self.empty_sections) - 1
        if tag == "time":
            self.time_tag_count += 1
        if tag == "p" and CARD_LABEL_CLASS in classes:
            self._label_parts = []
        if (
            (attrs.get("role") or "").strip() == "separator"
            and (attrs.get("aria-orientation") or "").strip() == "vertical"
            and self.stack
        ):
            # the separator's parent holds the two score cells; upcoming cards leave them empty
            self._score_containers.add(len(self.stack) - 1)
        if tag == "script":
            # only a classic inline script the browser would run can perform a stream swap
            executable = (
                "src" not in attrs
                and "nomodule" not in attrs
                and (attrs.get("type") or "").strip().lower() in _EXECUTABLE_SCRIPT_TYPES
                and not any(frame.tag in _INERT_SCRIPT_CONTAINERS for frame in self.stack)
            )
            self._script_parts = [] if executable else None
            self._inert_script = not executable
        if tag not in _VOID_TAGS:
            self.stack.append(
                _Frame(tag, suppressed, boundaries, empty_section, len(self._text_runs))
            )

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in _VOID_TAGS:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self._script_parts is not None:
            self._script_parts.append(data)
            return
        if self._inert_script:
            return
        if self._label_parts is not None:
            self._label_parts.append(data)
        text = " ".join(data.split())
        if text:
            self._text_runs.append(text)
        frame = self._parent()
        if text and frame.empty_section is not None and not frame.suppressed:
            self.empty_sections[frame.empty_section].texts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._script_parts is not None:
            swap = _executable_stream_swap("".join(self._script_parts))
            if swap is not None:
                self.swaps.setdefault(swap[1], swap[0])
            self._script_parts = None
        if tag == "script":
            self._inert_script = False
        if tag == "p" and self._label_parts is not None:
            if "•" in "".join(self._label_parts):
                self.card_label_count += 1
            self._label_parts = None
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                for depth in sorted(depth for depth in self._score_containers if depth >= index):
                    self._score_containers.discard(depth)
                    scores = self._text_runs[self.stack[depth].text_start :]
                    if len(scores) == 2 and all(score.isdigit() for score in scores):
                        self.completed_card_count += 1
                del self.stack[index:]
                break

    def _boundary_rendered(self, content_id: str, seen: frozenset[str] = frozenset()) -> bool:
        if content_id in seen:
            return False
        placeholder_id = self.swaps.get(content_id)
        if placeholder_id is None or placeholder_id not in self.placeholders:
            return False
        suppressed, boundaries = self.placeholders[placeholder_id]
        return not suppressed and all(
            self._boundary_rendered(item, seen | {content_id}) for item in boundaries
        )

    def rendered_empty_marker(self) -> bool:
        return any(
            not section.suppressed
            and " ".join(section.texts) in _ACCEPTED_EMPTY_TEXTS
            and all(self._boundary_rendered(item) for item in section.boundaries)
            for section in self.empty_sections
        )


@dataclass(frozen=True, slots=True)
class _ParsedSchedulePage:
    events: tuple[ScheduleEvent, ...]
    incomplete_card_count: int
    explicit_empty: bool
    has_empty_section: bool


def _decode(body: bytes) -> str:
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SchedulePayloadError("schedule page is not valid UTF-8") from exc


def _parse_page(body: bytes) -> _ParsedSchedulePage:
    text = _decode(body)
    parser = _ScheduleHTMLParser()
    parser.feed(text)
    parser.close()
    unique = {event.event_id: event for event in parser.events}
    events = tuple(sorted(unique.values(), key=lambda event: (event.start_at, event.event_id)))
    scanner = _EmptyStateScanner()
    scanner.feed(text)
    scanner.close()
    explicit_empty = (
        not parser.events
        and parser.incomplete_card_count == 0
        and scanner.time_tag_count == 0
        # every league•block card label must belong to a completed-match card (two numeric score
        # cells); an unaccounted label may be an upcoming card whose time markup drifted
        and scanner.card_label_count == scanner.completed_card_count
        and scanner.rendered_empty_marker()
    )
    return _ParsedSchedulePage(
        events=events,
        incomplete_card_count=parser.incomplete_card_count,
        explicit_empty=explicit_empty,
        has_empty_section=bool(scanner.empty_sections),
    )


def parse_schedule_html(body: bytes) -> tuple[ScheduleEvent, ...]:
    text = _decode(body)
    parser = _ScheduleHTMLParser()
    parser.feed(text)
    parser.close()
    if not parser.events:
        raise SchedulePayloadError("schedule page contains no semantic upcoming events")
    unique = {event.event_id: event for event in parser.events}
    return tuple(sorted(unique.values(), key=lambda event: (event.start_at, event.event_id)))


def is_explicit_empty_schedule(body: bytes) -> bool:
    """True only for a page that visibly renders the official "no upcoming matches" feed end
    with no upcoming-card markup at all; source errors, scripts, and hidden text never qualify."""
    try:
        return _parse_page(body).explicit_empty
    except SchedulePayloadError:
        return False


def parse_schedule_page(body: bytes) -> tuple[ScheduleEvent, ...]:
    """Parse schedule cards, returning `()` only for an explicitly rendered empty schedule."""
    page = _parse_page(body)
    if page.events:
        if page.incomplete_card_count and page.has_empty_section:
            raise SchedulePayloadError(
                "schedule page mixes incomplete event cards with an end-of-feed marker"
            )
        return page.events
    if page.explicit_empty:
        return ()
    raise SchedulePayloadError("schedule page contains no semantic upcoming events")


class LoLEsportsScheduleAdapter:
    source_id = "lol-esports-schedule"

    def __init__(
        self,
        registry: SourceRegistry,
        *,
        transport: HttpTransport | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.registry = registry
        self.gate = PolicyGate(registry)
        self.clock = clock or (lambda: datetime.now(UTC))
        registration = registry.get(self.source_id)
        if registration is None:
            raise ValueError("lol-esports-schedule is missing from the source registry")
        hosts = frozenset(urlparse(url).hostname or "" for url in registration.base_urls)
        self.transport = transport or UrllibTransport(allowed_hosts=hosts, clock=self.clock)

    def fetch(
        self,
        league_slugs: Sequence[str],
        *,
        locale: str = "en-US",
        last_retrieved_at: datetime | None = None,
        last_attempted_at: datetime | None = None,
        on_request_started: Callable[[datetime], None] | None = None,
    ) -> ScheduleSnapshot:
        """Fetch one schedule page.

        `last_attempted_at` (a persisted request start time) shares the source interval with
        `last_retrieved_at`. `on_request_started` runs only after the policy gate, input
        validation, and interval check pass, immediately before the network call; if it raises,
        no request is made.
        """
        registration = self._authorize("FETCH_SCHEDULE_HTML")
        normalized_slugs = self._validate_inputs(league_slugs, locale)
        previous_times = []
        for value, name in (
            (last_retrieved_at, "last_retrieved_at"),
            (last_attempted_at, "last_attempted_at"),
        ):
            if value is not None:
                require_aware(value, name)
                previous_times.append(value)
        now = self.clock()
        if previous_times:
            retry_at = max(previous_times) + timedelta(
                seconds=registration.minimum_interval_seconds
            )
            if now < retry_at:
                raise ScheduleFetchIntervalError(retry_at)
        encoded_leagues = quote(",".join(normalized_slugs), safe="")
        url = f"{registration.base_urls[0].rstrip('/')}/{locale}/leagues/{encoded_leagues}"
        if on_request_started is not None:
            on_request_started(now)
        response = self.transport.fetch(
            url,
            maximum_bytes=registration.maximum_response_bytes,
            user_agent=USER_AGENT,
        )
        if response.media_type != "text/html":
            raise SchedulePayloadError("schedule source must return text/html")
        artifact = RawSourceArtifact.create(
            source_id=self.source_id,
            request_url=response.request_url,
            final_url=response.final_url,
            media_type=response.media_type,
            retrieved_at=response.retrieved_at,
            body=response.body,
        )
        try:
            parsed_events = parse_schedule_page(response.body)
        except SchedulePayloadError as error:
            raise SchedulePayloadError(str(error), body=response.body) from error
        future_events = tuple(
            event for event in parsed_events if event.start_at >= response.retrieved_at
        )
        # An explicit official empty state is a valid zero-event snapshot. Cards that are all in
        # the past are not: the page did not say the feed is empty, so keep failing closed.
        if parsed_events and not future_events:
            raise SchedulePayloadError(
                "schedule page contains no future events at retrieval time", body=response.body
            )
        return ScheduleSnapshot(
            locale=locale,
            league_slugs=normalized_slugs,
            events=future_events,
            artifact=artifact,
        )

    def _authorize(self, operation: str) -> SourceRegistration:
        return self.gate.require(self.source_id, operation, self.clock())

    @staticmethod
    def _validate_inputs(league_slugs: Sequence[str], locale: str) -> tuple[str, ...]:
        if not LOCALE_PATTERN.fullmatch(locale):
            raise ValueError("locale must match ll-CC")
        normalized = tuple(dict.fromkeys(slug.lower() for slug in league_slugs))
        if not normalized or len(normalized) > 12:
            raise ValueError("one to twelve league slugs are required")
        if any(not LEAGUE_SLUG_PATTERN.fullmatch(slug) for slug in normalized):
            raise ValueError("league slugs contain unsupported characters")
        return normalized
