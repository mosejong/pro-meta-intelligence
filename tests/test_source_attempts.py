from datetime import UTC, datetime, timedelta

import pytest

from pro_meta_intelligence.sources import (
    RawSourceArtifact,
    SnapshotArchive,
    SourceAttemptLedger,
    SourceAttemptLedgerError,
)

SOURCE_ID = "oracles-elixir-match-data"
OPERATION = "FETCH_PUBLISHED_CSV"
ATTEMPTED_AT = datetime(2026, 9, 9, 7, 13, tzinfo=UTC)


def test_attempt_ledger_round_trips_and_is_not_treated_as_raw_snapshot(tmp_path) -> None:
    archive = SnapshotArchive(tmp_path)
    archive.store(
        RawSourceArtifact.create(
            source_id=SOURCE_ID,
            request_url="https://example.com/reviewed",
            final_url="https://example.com/reviewed",
            media_type="text/csv",
            retrieved_at=ATTEMPTED_AT - timedelta(days=2),
            body=b"gameid,patch\n1,16.16\n",
        )
    )
    ledger = SourceAttemptLedger(tmp_path)

    ledger.record(SOURCE_ID, OPERATION, ATTEMPTED_AT)

    assert ledger.latest_attempted_at(SOURCE_ID, OPERATION) == ATTEMPTED_AT
    assert ledger.validate(SOURCE_ID) is True
    assert archive.inspect(SOURCE_ID).issues == ()


def test_attempt_ledger_rejects_clock_rollback_and_malformed_state(tmp_path) -> None:
    ledger = SourceAttemptLedger(tmp_path)
    ledger.record(SOURCE_ID, OPERATION, ATTEMPTED_AT)

    with pytest.raises(SourceAttemptLedgerError, match="must not move backwards"):
        ledger.record(SOURCE_ID, OPERATION, ATTEMPTED_AT - timedelta(seconds=1))

    path = tmp_path / SOURCE_ID / "_request_attempts.json"
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(SourceAttemptLedgerError, match="invalid structure"):
        ledger.latest_attempted_at(SOURCE_ID, OPERATION)
