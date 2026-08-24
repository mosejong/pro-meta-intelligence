"""Reusable point-in-time guards for feature materialization."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Protocol, TypeVar

from pro_meta_intelligence.models import require_aware


class AvailableRecord(Protocol):
    available_at: datetime


RecordT = TypeVar("RecordT", bound=AvailableRecord)


class FutureDataError(ValueError):
    """Raised when a record unavailable at the cutoff enters a strict snapshot."""


def is_available(record: AvailableRecord, cutoff: datetime) -> bool:
    require_aware(cutoff, "cutoff")
    require_aware(record.available_at, "available_at")
    return record.available_at <= cutoff


def filter_available(records: Iterable[RecordT], cutoff: datetime) -> tuple[RecordT, ...]:
    """Return only records the system could have known at ``cutoff``."""

    return tuple(record for record in records if is_available(record, cutoff))


def reject_future(records: Iterable[RecordT], cutoff: datetime) -> tuple[RecordT, ...]:
    """Validate and return records, raising if any record violates the cutoff."""

    materialized = tuple(records)
    future = [record for record in materialized if not is_available(record, cutoff)]
    if future:
        first = min(future, key=lambda record: record.available_at)
        raise FutureDataError(
            f"record available at {first.available_at.isoformat()} exceeds cutoff "
            f"{cutoff.isoformat()}"
        )
    return materialized
