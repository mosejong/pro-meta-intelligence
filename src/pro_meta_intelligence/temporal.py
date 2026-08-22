"""Shared parsing helpers for timezone-aware external timestamps."""

from datetime import datetime

from pro_meta_intelligence.models import require_aware


def parse_datetime(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    require_aware(parsed, "timestamp")
    return parsed
