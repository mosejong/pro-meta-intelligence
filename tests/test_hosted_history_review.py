"""Independent end-to-end check of failed annual attempts across encrypted restore."""

import json
import re
from pathlib import Path

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.ingestion.http import HttpTransportError
from pro_meta_intelligence.ingestion.oe_download import OracleElixirPublishedDownloadAdapter
from pro_meta_intelligence.operations.private_archive import (
    pack_private_oe_archive,
    restore_private_oe_archive,
)
from pro_meta_intelligence.sources import SourceAttemptLedger
from tests.test_fetch_oe_history import NOW
from tests.test_private_archive import KEY_ENV, SOURCE_ID, _archive, _key


def test_intervening_diagnostics_cannot_skip_attempt_state_preservation():
    workflow = (
        Path(__file__).resolve().parents[1] / ".github/workflows/hosted-oe-sync.yml"
    ).read_text(encoding="utf-8")
    sync = workflow.split("\n  sync:\n", 1)[1].split("\n  deploy:\n", 1)[0]
    steps = re.split(r"\n(?=      - )", sync.split("\n    steps:\n", 1)[1])
    start = next(i for i, block in enumerate(steps) if "id: history-acquisition" in block)
    end = next(i for i, block in enumerate(steps) if "name: Repack authenticated" in block)
    assert start < end
    for block in steps[start + 1 : end]:
        # Either the step cannot run in history mode, or its failure must not poison success().
        assert "env.HISTORY_ONLY != 'true'" in block or "continue-on-error: true" in block


def test_null_restore_report_never_authorizes_acquisition(tmp_path):
    from ops.hosted_history_acquisition import check_preconditions

    archive = tmp_path / "source"
    _archive(archive)
    restore = tmp_path / "restore.json"
    restore.write_text("null", encoding="utf-8")
    assert check_preconditions(archive, restore, now=NOW)


def test_empty_archive_never_authorizes_acquisition(tmp_path):
    from ops.hosted_history_acquisition import check_preconditions

    archive = tmp_path / "source"
    archive.mkdir()
    restore = tmp_path / "restore.json"
    restore.write_text(
        json.dumps(
            {
                "artifact_type": "restored-private-oe-archive",
                "source_id": SOURCE_ID,
                "authenticated": True,
            }
        ),
        encoding="utf-8",
    )
    assert check_preconditions(archive, restore, now=NOW)


def test_failed_historical_request_survives_restore_and_blocks_current_year(tmp_path, monkeypatch):
    class FailingTransport:
        calls = 0

        def fetch(self, *args, **kwargs):
            self.calls += 1
            raise HttpTransportError("independent simulated provider failure")

    transport = FailingTransport()
    monkeypatch.setattr(
        "pro_meta_intelligence.cli.OracleElixirPublishedDownloadAdapter",
        lambda registry: OracleElixirPublishedDownloadAdapter(
            registry, transport=transport, clock=lambda: NOW
        ),
    )
    source, restored = tmp_path / "source", tmp_path / "restored"
    _archive(source)
    assert (
        main(
            [
                "fetch-oe",
                "--year",
                "2015",
                "--historical-usage-only",
                "--archive-dir",
                str(source),
                "--output",
                str(tmp_path / "failed.json"),
            ]
        )
        == 4
    )
    monkeypatch.setenv(KEY_ENV, _key())
    encrypted = tmp_path / "state.pmi"
    pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)
    restore_private_oe_archive(encrypted, restored, key_environment_variable=KEY_ENV)
    assert (
        SourceAttemptLedger(restored).latest_attempted_at(SOURCE_ID, "FETCH_PUBLISHED_CSV") == NOW
    )
    assert (
        main(
            [
                "fetch-oe",
                "--year",
                "2026",
                "--archive-dir",
                str(restored),
                "--output",
                str(tmp_path / "blocked.json"),
            ]
        )
        == 3
    )
    assert transport.calls == 1
