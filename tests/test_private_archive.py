import base64
import json
import secrets
from datetime import UTC, datetime, timedelta

import pytest

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.operations.private_archive import (
    PrivateArchiveError,
    pack_private_oe_archive,
    restore_private_oe_archive,
)
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive

SOURCE_ID = "oracles-elixir-match-data"
KEY_ENV = "PMI_TEST_ARCHIVE_KEY"


def _key() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")


def _archive(root):
    archive = SnapshotArchive(root)
    started = datetime(2026, 8, 23, 3, 0, tzinfo=UTC)
    for index, body in enumerate(
        (
            b"gameid,patch,champion\n1,16.16,Vi\n" * 2048,
            b"gameid,patch,champion\n1,16.16,Vi\n2,16.16,Ahri\n" * 2048,
        )
    ):
        archive.store(
            RawSourceArtifact.create(
                source_id=SOURCE_ID,
                request_url="https://example.com/reviewed",
                final_url="https://example.com/reviewed",
                media_type="text/csv",
                retrieved_at=started + timedelta(days=index),
                body=body,
            )
        )
    return archive


def test_round_trip(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    _archive(source)
    encrypted = tmp_path / "history.pmi"
    restored = tmp_path / "restored"
    monkeypatch.setenv(KEY_ENV, _key())

    packed = pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)
    restored_report = restore_private_oe_archive(
        encrypted, restored, key_environment_variable=KEY_ENV
    )

    assert packed["snapshot_count"] == 2
    assert packed["unique_content_count"] == 2
    assert packed["raw_rows_in_output"] is False
    assert packed["encrypted_content_hash"].startswith("sha256:")
    assert restored_report["authenticated"] is True
    assert restored_report["snapshot_count"] == 2
    inspection = SnapshotArchive(restored).inspect(SOURCE_ID)
    assert inspection.issues == ()
    assert len(inspection.snapshots) == 2
    assert b"gameid,patch,champion" not in encrypted.read_bytes()
    assert {path.name: path.read_bytes() for path in (source / SOURCE_ID).glob("*.csv")} == {
        path.name: path.read_bytes() for path in (restored / SOURCE_ID).glob("*.csv")
    }


def test_rejects_tampering(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    _archive(source)
    encrypted = tmp_path / "history.pmi"
    monkeypatch.setenv(KEY_ENV, _key())
    pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)

    monkeypatch.setenv(KEY_ENV, _key())
    wrong_key_target = tmp_path / "wrong-key"
    with pytest.raises(PrivateArchiveError, match="authentication failed"):
        restore_private_oe_archive(encrypted, wrong_key_target, key_environment_variable=KEY_ENV)
    assert not wrong_key_target.exists()

    monkeypatch.setenv(KEY_ENV, _key())
    replacement = tmp_path / "replacement.pmi"
    monkeypatch.setenv("PMI_ORIGINAL_KEY", _key())
    # Build a second valid container, then corrupt an authenticated byte after its header.
    pack_private_oe_archive(source, replacement, key_environment_variable="PMI_ORIGINAL_KEY")
    content = bytearray(replacement.read_bytes())
    content[32] ^= 1
    replacement.write_bytes(content)
    tampered_target = tmp_path / "tampered"
    with pytest.raises(PrivateArchiveError, match="authentication failed"):
        restore_private_oe_archive(
            replacement,
            tampered_target,
            key_environment_variable="PMI_ORIGINAL_KEY",
        )
    assert not tampered_target.exists()


def test_rejects_unsafe_targets(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    _archive(source)
    encrypted = tmp_path / "history.pmi"
    monkeypatch.delenv(KEY_ENV, raising=False)

    with pytest.raises(PrivateArchiveError, match="key is missing"):
        pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)

    monkeypatch.setenv(KEY_ENV, _key())
    encrypted.write_bytes(b"do not replace")
    with pytest.raises(FileExistsError, match="already exists"):
        pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)

    existing_target = tmp_path / "existing"
    existing_target.mkdir()
    with pytest.raises(FileExistsError, match="must not already exist"):
        restore_private_oe_archive(encrypted, existing_target, key_environment_variable=KEY_ENV)


def test_cli_reports(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    _archive(source)
    encrypted = tmp_path / "history.pmi"
    restored = tmp_path / "restored"
    pack_report = tmp_path / "pack.json"
    restore_report = tmp_path / "restore.json"
    secret = _key()
    monkeypatch.setenv(KEY_ENV, secret)

    assert (
        main(
            [
                "pack-private-oe-archive",
                "--archive-dir",
                str(source),
                "--output",
                str(encrypted),
                "--key-env",
                KEY_ENV,
                "--report",
                str(pack_report),
            ]
        )
        == 0
    )
    assert (
        main(
            [
                "restore-private-oe-archive",
                "--input",
                str(encrypted),
                "--archive-dir",
                str(restored),
                "--key-env",
                KEY_ENV,
                "--report",
                str(restore_report),
            ]
        )
        == 0
    )
    reports = pack_report.read_text(encoding="utf-8") + restore_report.read_text(encoding="utf-8")
    assert secret not in reports
    assert json.loads(pack_report.read_text(encoding="utf-8"))["snapshot_count"] == 2
    assert json.loads(restore_report.read_text(encoding="utf-8"))["authenticated"] is True
