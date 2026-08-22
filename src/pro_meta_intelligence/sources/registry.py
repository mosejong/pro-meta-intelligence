"""Fail-closed registry and policy gate for every external data source."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from importlib.resources import files
from pathlib import Path
from urllib.parse import urlparse

from pro_meta_intelligence.models import require_aware
from pro_meta_intelligence.temporal import parse_datetime


class SourceStatus(StrEnum):
    ENABLED = "ENABLED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    BLOCKED = "BLOCKED"


class SourceAccessMethod(StrEnum):
    OFFICIAL_STATIC_DATA = "OFFICIAL_STATIC_DATA"
    OFFICIAL_API = "OFFICIAL_API"
    PERMITTED_PUBLIC_WEB = "PERMITTED_PUBLIC_WEB"


@dataclass(frozen=True, slots=True)
class SourceRegistration:
    source_id: str
    display_name: str
    owner: str
    status: SourceStatus
    access_method: SourceAccessMethod
    base_urls: tuple[str, ...]
    allowed_operations: tuple[str, ...]
    policy_urls: tuple[str, ...]
    policy_reviewed_at: datetime
    review_interval_days: int
    credential_requirement: str
    minimum_interval_seconds: float
    maximum_response_bytes: int
    robots_policy: str
    retention_policy: str
    redistribution_policy: str
    availability_policy: str
    notes: str

    def __post_init__(self) -> None:
        require_aware(self.policy_reviewed_at, "policy_reviewed_at")
        if not self.source_id or not self.display_name or not self.owner:
            raise ValueError("source identity fields cannot be empty")
        if not self.base_urls or not self.policy_urls:
            raise ValueError("source registrations require base and policy URLs")
        if self.review_interval_days < 1:
            raise ValueError("review_interval_days must be positive")
        if self.minimum_interval_seconds < 0:
            raise ValueError("minimum_interval_seconds cannot be negative")
        if self.maximum_response_bytes < 1:
            raise ValueError("maximum_response_bytes must be positive")
        for url in (*self.base_urls, *self.policy_urls):
            parsed = urlparse(url)
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError(f"registry URLs must use HTTPS: {url}")

    def is_review_current(self, at: datetime) -> bool:
        require_aware(at, "at")
        return at <= self.policy_reviewed_at + timedelta(days=self.review_interval_days)

    def to_dict(self, at: datetime) -> dict[str, object]:
        return {
            "source_id": self.source_id,
            "display_name": self.display_name,
            "owner": self.owner,
            "status": self.status.value,
            "access_method": self.access_method.value,
            "base_urls": list(self.base_urls),
            "allowed_operations": list(self.allowed_operations),
            "policy_urls": list(self.policy_urls),
            "policy_reviewed_at": self.policy_reviewed_at.isoformat(),
            "review_interval_days": self.review_interval_days,
            "policy_review_current": self.is_review_current(at),
            "credential_requirement": self.credential_requirement,
            "minimum_interval_seconds": self.minimum_interval_seconds,
            "maximum_response_bytes": self.maximum_response_bytes,
            "robots_policy": self.robots_policy,
            "retention_policy": self.retention_policy,
            "redistribution_policy": self.redistribution_policy,
            "availability_policy": self.availability_policy,
            "notes": self.notes,
        }


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    allowed: bool
    source_id: str
    operation: str
    reason_code: str
    explanation: str


class SourcePolicyError(PermissionError):
    def __init__(self, decision: PolicyDecision) -> None:
        self.decision = decision
        super().__init__(f"{decision.reason_code}: {decision.explanation}")


class SourceRegistry:
    def __init__(self, registrations: tuple[SourceRegistration, ...]) -> None:
        by_id = {registration.source_id: registration for registration in registrations}
        if len(by_id) != len(registrations):
            raise ValueError("source_id values must be unique")
        self._registrations = by_id

    @classmethod
    def from_json(cls, path: Path) -> SourceRegistry:
        return cls._from_raw(json.loads(path.read_text(encoding="utf-8")))

    @classmethod
    def _from_raw(cls, raw) -> SourceRegistry:
        if raw.get("schema_version") != "1":
            raise ValueError("unsupported source registry schema_version")
        registrations = tuple(
            SourceRegistration(
                source_id=item["source_id"],
                display_name=item["display_name"],
                owner=item["owner"],
                status=SourceStatus(item["status"]),
                access_method=SourceAccessMethod(item["access_method"]),
                base_urls=tuple(item["base_urls"]),
                allowed_operations=tuple(item["allowed_operations"]),
                policy_urls=tuple(item["policy_urls"]),
                policy_reviewed_at=parse_datetime(item["policy_reviewed_at"]),
                review_interval_days=item["review_interval_days"],
                credential_requirement=item["credential_requirement"],
                minimum_interval_seconds=item["minimum_interval_seconds"],
                maximum_response_bytes=item["maximum_response_bytes"],
                robots_policy=item["robots_policy"],
                retention_policy=item["retention_policy"],
                redistribution_policy=item["redistribution_policy"],
                availability_policy=item["availability_policy"],
                notes=item["notes"],
            )
            for item in raw["sources"]
        )
        return cls(registrations)

    @classmethod
    def load_default(cls) -> SourceRegistry:
        resource = files("pro_meta_intelligence").joinpath("config/source_registry.json")
        return cls._from_raw(json.loads(resource.read_text(encoding="utf-8")))

    def get(self, source_id: str) -> SourceRegistration | None:
        return self._registrations.get(source_id)

    def registrations(self) -> tuple[SourceRegistration, ...]:
        return tuple(self._registrations[key] for key in sorted(self._registrations))


class PolicyGate:
    def __init__(self, registry: SourceRegistry) -> None:
        self.registry = registry

    def evaluate(self, source_id: str, operation: str, at: datetime) -> PolicyDecision:
        require_aware(at, "at")
        registration = self.registry.get(source_id)
        if registration is None:
            return PolicyDecision(
                False,
                source_id,
                operation,
                "UNREGISTERED_SOURCE",
                "External access is denied until the source has a reviewed registry entry.",
            )
        if registration.status is not SourceStatus.ENABLED:
            return PolicyDecision(
                False,
                source_id,
                operation,
                "SOURCE_NOT_ENABLED",
                f"Source status is {registration.status.value}.",
            )
        if not registration.is_review_current(at):
            return PolicyDecision(
                False,
                source_id,
                operation,
                "POLICY_REVIEW_EXPIRED",
                "The source policy review interval has expired.",
            )
        if operation not in registration.allowed_operations:
            return PolicyDecision(
                False,
                source_id,
                operation,
                "OPERATION_NOT_ALLOWED",
                "The requested operation is not allowlisted for this source.",
            )
        return PolicyDecision(
            True,
            source_id,
            operation,
            "ALLOWED",
            "The source, operation, and policy review are allowlisted.",
        )

    def require(self, source_id: str, operation: str, at: datetime) -> SourceRegistration:
        decision = self.evaluate(source_id, operation, at)
        if not decision.allowed:
            raise SourcePolicyError(decision)
        registration = self.registry.get(source_id)
        if registration is None:  # pragma: no cover - protected by evaluate
            raise AssertionError("allowed source disappeared from registry")
        return registration
