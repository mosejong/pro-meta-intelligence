from dataclasses import replace
from datetime import UTC, datetime

import pytest

from pro_meta_intelligence.sources import (
    PolicyGate,
    SourcePolicyError,
    SourceRegistry,
    SourceStatus,
)

NOW = datetime(2026, 8, 22, tzinfo=UTC)


def test_default_registry_enables_only_reviewed_static_data() -> None:
    registry = SourceRegistry.load_default()

    assert registry.get("riot-data-dragon").status is SourceStatus.ENABLED
    assert registry.get("oracles-elixir-match-data").status is SourceStatus.ENABLED
    assert registry.get("lol-esports-schedule").status is SourceStatus.ENABLED
    assert registry.get("lol-esports-schedule").allowed_operations == ("FETCH_SCHEDULE_HTML",)
    assert registry.get("oracles-elixir-match-data").allowed_operations == (
        "FETCH_PUBLISHED_CSV",
        "IMPORT_LOCAL_CSV",
    )
    assert registry.get("riot-web-api").status is SourceStatus.REVIEW_REQUIRED


def test_policy_gate_fails_closed_for_unknown_and_disabled_sources() -> None:
    gate = PolicyGate(SourceRegistry.load_default())

    with pytest.raises(SourcePolicyError, match="UNREGISTERED_SOURCE"):
        gate.require("random-web-site", "CRAWL", NOW)
    with pytest.raises(SourcePolicyError, match="SOURCE_NOT_ENABLED"):
        gate.require("riot-web-api", "FETCH_MATCH", NOW)


def test_policy_gate_rejects_expired_review_and_unlisted_operation() -> None:
    registry = SourceRegistry.load_default()
    gate = PolicyGate(registry)

    with pytest.raises(SourcePolicyError, match="POLICY_REVIEW_EXPIRED"):
        gate.require("riot-data-dragon", "FETCH_VERSION_INDEX", datetime(2027, 1, 1, tzinfo=UTC))
    with pytest.raises(SourcePolicyError, match="OPERATION_NOT_ALLOWED"):
        gate.require("riot-data-dragon", "CRAWL_ARBITRARY_URL", NOW)


def test_duplicate_source_ids_are_rejected() -> None:
    registration = SourceRegistry.load_default().get("riot-data-dragon")

    with pytest.raises(ValueError, match="unique"):
        SourceRegistry((registration, replace(registration)))
