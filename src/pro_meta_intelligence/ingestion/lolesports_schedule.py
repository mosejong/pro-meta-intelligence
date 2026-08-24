"""Policy-gated adapter for the official LoL Esports schedule page."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
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
    pass


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


class _ScheduleHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[ScheduleEvent] = []
        self.current: _EventBuilder | None = None
        self.team_slot: int | None = None
        self.team_text: list[str] = []
        self.subtext = False
        self.subtext_parts: list[str] = []

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
        if tag == "p":
            classes = attrs.get("class") or ""
            if "c_home.card.subtext" in classes:
                self.subtext = True
                self.subtext_parts = []
            elif "grid-c_1_/_1" in classes:
                self.team_slot = 0
                self.team_text = []
            elif "grid-c_3_/_3" in classes:
                self.team_slot = 1
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


def parse_schedule_html(body: bytes) -> tuple[ScheduleEvent, ...]:
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SchedulePayloadError("schedule page is not valid UTF-8") from exc
    parser = _ScheduleHTMLParser()
    parser.feed(text)
    parser.close()
    if not parser.events:
        raise SchedulePayloadError("schedule page contains no semantic upcoming events")
    unique = {event.event_id: event for event in parser.events}
    return tuple(sorted(unique.values(), key=lambda event: (event.start_at, event.event_id)))


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
    ) -> ScheduleSnapshot:
        registration = self._authorize("FETCH_SCHEDULE_HTML")
        normalized_slugs = self._validate_inputs(league_slugs, locale)
        if last_retrieved_at is not None:
            require_aware(last_retrieved_at, "last_retrieved_at")
            retry_at = last_retrieved_at + timedelta(seconds=registration.minimum_interval_seconds)
            if self.clock() < retry_at:
                raise ScheduleFetchIntervalError(retry_at)
        encoded_leagues = quote(",".join(normalized_slugs), safe="")
        url = f"{registration.base_urls[0].rstrip('/')}/{locale}/leagues/{encoded_leagues}"
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
        future_events = tuple(
            event
            for event in parse_schedule_html(response.body)
            if event.start_at >= response.retrieved_at
        )
        if not future_events:
            raise SchedulePayloadError("schedule page contains no future events at retrieval time")
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
