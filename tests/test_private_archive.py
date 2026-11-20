import base64
import json
import os
import secrets
import tarfile
from datetime import UTC, datetime, timedelta, timezone

import pytest

from pro_meta_intelligence.cli import main
from pro_meta_intelligence.operations import private_archive
from pro_meta_intelligence.operations.private_archive import (
    PrivateArchiveError,
    pack_private_oe_archive,
    restore_private_oe_archive,
)
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceAttemptLedger

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
    attempted_at = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)
    SourceAttemptLedger(source).record(SOURCE_ID, "FETCH_PUBLISHED_CSV", attempted_at)
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
    assert packed["request_attempt_ledger_present"] is True
    assert restored_report["request_attempt_ledger_present"] is True
    assert restored_report["snapshot_count"] == 2
    inspection = SnapshotArchive(restored).inspect(SOURCE_ID)
    assert inspection.issues == ()
    assert len(inspection.snapshots) == 2
    assert b"gameid,patch,champion" not in encrypted.read_bytes()
    assert {path.name: path.read_bytes() for path in (source / SOURCE_ID).glob("*.csv")} == {
        path.name: path.read_bytes() for path in (restored / SOURCE_ID).glob("*.csv")
    }
    assert (
        SourceAttemptLedger(restored).latest_attempted_at(SOURCE_ID, "FETCH_PUBLISHED_CSV")
        == attempted_at
    )


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
    pack_payload = json.loads(pack_report.read_text(encoding="utf-8"))
    restore_payload = json.loads(restore_report.read_text(encoding="utf-8"))
    assert pack_payload["snapshots"] == restore_payload["snapshots"]
    assert len(pack_payload["snapshots"]) == 2


PACK_REPORT_FIELDS = {
    "schema_version",
    "artifact_type",
    "source_id",
    "snapshot_count",
    "unique_content_count",
    "source_file_count",
    "source_byte_count",
    "request_attempt_ledger_present",
    "encrypted_byte_count",
    "encrypted_content_hash",
    "compression",
    "encryption",
    "key_source",
    "raw_rows_in_output",
}
RESTORE_REPORT_FIELDS = {
    "schema_version",
    "artifact_type",
    "source_id",
    "snapshot_count",
    "request_attempt_ledger_present",
    "unique_content_count",
    "encrypted_byte_count",
    "encrypted_content_hash",
    "authenticated",
    "key_source",
}
MANIFEST_ENTRY_FIELDS = {"content_hash", "retrieved_at", "byte_length"}
REQUEST_URL = "https://provider.invalid/private-reviewed-export.csv"


def _store(archive, body: bytes, retrieved_at: datetime) -> None:
    archive.store(
        RawSourceArtifact.create(
            source_id=SOURCE_ID,
            request_url=REQUEST_URL,
            final_url=REQUEST_URL,
            media_type="text/csv",
            retrieved_at=retrieved_at,
            body=body,
        )
    )


def _tree_bytes(root) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_manifest_round_trip_matches_verified_inspection(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    _archive(source)
    SourceAttemptLedger(source).record(
        SOURCE_ID, "FETCH_PUBLISHED_CSV", datetime(2026, 8, 25, 3, 0, tzinfo=UTC)
    )
    before = _tree_bytes(source)
    encrypted = tmp_path / "history.pmi"
    restored = tmp_path / "restored"
    monkeypatch.setenv(KEY_ENV, _key())

    packed = pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)
    restored_report = restore_private_oe_archive(
        encrypted, restored, key_environment_variable=KEY_ENV
    )

    # Existing fields are unchanged; the manifest is the only addition.
    assert set(packed) == PACK_REPORT_FIELDS | {"snapshots"}
    assert set(restored_report) == RESTORE_REPORT_FIELDS | {"snapshots"}
    assert packed["schema_version"] == restored_report["schema_version"] == "1"

    manifest = packed["snapshots"]
    assert manifest == restored_report["snapshots"]
    assert len(manifest) == packed["snapshot_count"] == restored_report["snapshot_count"]
    assert len({entry["content_hash"] for entry in manifest}) == packed["unique_content_count"]
    expected = [
        {
            "content_hash": snapshot.content_hash,
            "retrieved_at": snapshot.retrieved_at.astimezone(UTC).isoformat(),
            "byte_length": snapshot.data_path.stat().st_size,
        }
        for snapshot in SnapshotArchive(restored).inspect(SOURCE_ID).snapshots
    ]
    assert manifest == expected
    # Packing and restoring never modify the source snapshots or the request ledger.
    assert _tree_bytes(source) == before


def test_manifest_retains_each_retrieval_of_the_same_content_in_utc_order(
    tmp_path, monkeypatch
) -> None:
    source = tmp_path / "source"
    archive = SnapshotArchive(source)
    repeated = b"gameid,patch,champion\n7,16.20,Azir\n" * 512
    distinct = b"gameid,patch,champion\n8,16.20,Orianna\n" * 512
    seoul = timezone(timedelta(hours=9))
    # Stored out of chronological order and with a non-UTC offset on purpose.
    _store(archive, repeated, datetime(2026, 11, 18, 10, 35, 30, 738564, tzinfo=seoul))
    _store(archive, distinct, datetime(2026, 11, 17, 0, 0, tzinfo=UTC))
    _store(archive, repeated, datetime(2026, 11, 11, 4, 0, tzinfo=UTC))
    encrypted = tmp_path / "history.pmi"
    restored = tmp_path / "restored"
    monkeypatch.setenv(KEY_ENV, _key())

    packed = pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)
    restored_report = restore_private_oe_archive(
        encrypted, restored, key_environment_variable=KEY_ENV
    )

    manifest = packed["snapshots"]
    assert manifest == restored_report["snapshots"]
    assert packed["snapshot_count"] == 3
    assert packed["unique_content_count"] == 2
    assert [entry["retrieved_at"] for entry in manifest] == [
        "2026-11-11T04:00:00+00:00",
        "2026-11-17T00:00:00+00:00",
        "2026-11-18T01:35:30.738564+00:00",
    ]
    for entry in manifest:
        parsed = datetime.fromisoformat(entry["retrieved_at"])
        assert parsed.utcoffset() == timedelta(0)
    repeated_entries = [entry for entry in manifest if entry["byte_length"] == len(repeated)]
    assert len(repeated_entries) == 2
    assert repeated_entries[0]["content_hash"] == repeated_entries[1]["content_hash"]
    assert manifest[1]["byte_length"] == len(distinct)
    assert manifest[1]["content_hash"] != repeated_entries[0]["content_hash"]

    # Deterministic: an independent pack of the same archive yields the same manifest.
    second = tmp_path / "second.pmi"
    again = pack_private_oe_archive(source, second, key_environment_variable=KEY_ENV)
    assert again["snapshots"] == manifest


def test_manifest_exposes_only_whitelisted_non_secret_fields(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    archive = SnapshotArchive(source)
    marker_row = b"gameid,patch,champion\n99,16.20,PrivateRowMarker\n"
    _store(archive, marker_row * 256, datetime(2026, 11, 18, 1, 35, tzinfo=UTC))
    SourceAttemptLedger(source).record(
        SOURCE_ID, "FETCH_PUBLISHED_CSV", datetime(2026, 11, 19, 1, 0, tzinfo=UTC)
    )
    encrypted = tmp_path / "history.pmi"
    restored = tmp_path / "restored"
    secret = _key()
    monkeypatch.setenv(KEY_ENV, secret)

    reports = [
        pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV),
        restore_private_oe_archive(encrypted, restored, key_environment_variable=KEY_ENV),
    ]

    for report in reports:
        for entry in report["snapshots"]:
            assert set(entry) == MANIFEST_ENTRY_FIELDS
            assert isinstance(entry["content_hash"], str)
            assert isinstance(entry["retrieved_at"], str)
            assert isinstance(entry["byte_length"], int)
        serialized = json.dumps(report["snapshots"])
        for forbidden in (
            secret,
            REQUEST_URL,
            "provider.invalid",
            "PrivateRowMarker",
            "gameid",
            "FETCH_PUBLISHED_CSV",
            "2026-11-19",
            ".meta.json",
            ".csv",
            tmp_path.name,
        ):
            assert forbidden not in serialized
        assert secret not in json.dumps(report)


def test_corrupt_inputs_fail_closed_without_a_manifest(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    _archive(source)
    monkeypatch.setenv(KEY_ENV, _key())
    key = os.environ[KEY_ENV]

    # A tampered authenticated container never yields a report or a restored target.
    encrypted = tmp_path / "history.pmi"
    pack_private_oe_archive(source, encrypted, key_environment_variable=KEY_ENV)
    content = bytearray(encrypted.read_bytes())
    content[-1] ^= 1  # last byte of the final frame's authentication tag
    encrypted.write_bytes(content)
    tampered_target = tmp_path / "tampered"
    with pytest.raises(PrivateArchiveError, match="authentication failed"):
        restore_private_oe_archive(encrypted, tampered_target, key_environment_variable=KEY_ENV)
    assert not tampered_target.exists()

    # A snapshot whose bytes no longer match its metadata is rejected before packing.
    corrupt_source = tmp_path / "corrupt-source"
    _archive(corrupt_source)
    data_file = sorted((corrupt_source / SOURCE_ID).glob("*.csv"))[0]
    data_file.write_bytes(data_file.read_bytes() + b"9,16.16,Tampered\n")
    refused_output = tmp_path / "refused.pmi"
    with pytest.raises(PrivateArchiveError, match="source archive integrity failed"):
        pack_private_oe_archive(corrupt_source, refused_output, key_environment_variable=KEY_ENV)
    assert not refused_output.exists()

    # A correctly authenticated container holding a corrupt snapshot is rejected on restore.
    unchecked = tmp_path / "unchecked.pmi"
    _pack_without_integrity_check(corrupt_source, unchecked, key)
    corrupt_target = tmp_path / "corrupt-target"
    with pytest.raises(PrivateArchiveError, match="restored archive integrity failed"):
        restore_private_oe_archive(unchecked, corrupt_target, key_environment_variable=KEY_ENV)
    assert not corrupt_target.exists()
    assert not any(path.name.startswith(".corrupt-target.") for path in tmp_path.iterdir())


def _pack_without_integrity_check(archive_root, output, encoded_key: str) -> None:
    """Build an authentic container around unverified content, as a test-only adversary."""

    AESGCM, zstandard = private_archive._hosted_dependencies()
    cipher = AESGCM(base64.urlsafe_b64decode(encoded_key.encode("ascii")))
    with output.open("wb") as handle:
        encryptor = private_archive._ChunkEncryptor(handle, cipher)
        with zstandard.ZstdCompressor().stream_writer(encryptor, closefd=False) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|") as archive:
                archive.add(
                    archive_root / SOURCE_ID,
                    arcname=SOURCE_ID,
                    recursive=True,
                    filter=private_archive._normalized_tar_info,
                )
        encryptor.finalize()
