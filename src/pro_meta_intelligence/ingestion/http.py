"""Small HTTPS transport with response-size and redirect-host controls."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


@dataclass(frozen=True, slots=True)
class HttpResponse:
    request_url: str
    final_url: str
    status: int
    media_type: str
    body: bytes
    retrieved_at: datetime


class HttpTransport(Protocol):
    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse: ...


class HttpTransportError(RuntimeError):
    pass


class _AllowlistedRedirectHandler(HTTPRedirectHandler):
    def __init__(self, allowed_hosts: frozenset[str]) -> None:
        super().__init__()
        self.allowed_hosts = allowed_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        if parsed.scheme != "https" or parsed.hostname not in self.allowed_hosts:
            raise HttpTransportError("redirect target is outside the allowlisted HTTPS hosts")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class UrllibTransport:
    def __init__(
        self,
        *,
        allowed_hosts: frozenset[str],
        timeout_seconds: float = 20.0,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.allowed_hosts = allowed_hosts
        self.timeout_seconds = timeout_seconds
        self.clock = clock or (lambda: datetime.now(UTC))
        self._opener = build_opener(_AllowlistedRedirectHandler(allowed_hosts))

    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse:
        self._require_allowed_https(url)
        request = Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
        try:
            with self._opener.open(request, timeout=self.timeout_seconds) as response:
                final_url = response.geturl()
                self._require_allowed_https(final_url)
                body = response.read(maximum_bytes + 1)
                if len(body) > maximum_bytes:
                    raise HttpTransportError(
                        f"response exceeded configured maximum of {maximum_bytes} bytes"
                    )
                status = getattr(response, "status", 200)
                if status != 200:
                    raise HttpTransportError(f"unexpected HTTP status {status}")
                media_type = response.headers.get_content_type()
        except OSError as exc:
            raise HttpTransportError("request to allowlisted source failed") from exc
        return HttpResponse(url, final_url, status, media_type, body, self.clock())

    def _require_allowed_https(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in self.allowed_hosts:
            raise HttpTransportError("URL is outside the allowlisted HTTPS hosts")
