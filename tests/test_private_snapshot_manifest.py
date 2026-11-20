"""Approved three-field snapshot manifest export. No test touches the network or a real archive."""

import ast
import base64
import json
import secrets
from pathlib import Path

import pytest

from ops import write_private_snapshot_manifest as wpsm
from pro_meta_intelligence.operations.private_archive import (
    pack_private_oe_archive,
    restore_private_oe_archive,
)
from tests.test_hosted_history_acquisition import (
    ARCHIVE_UPLOAD,
    REPACK,
    RETENTION,
    simulate,
    step,
)
from tests.test_private_archive import _archive as seed_archive

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = "Write the approved three-field snapshot manifest"
DIAGNOSTICS = "Preserve public-safe sync diagnostics on success or rejection"
RESTORE = "Restore the newest authenticated private history state"

HASH_A = "sha256:" + "a" * 64
HASH_B = "sha256:" + "b" * 64
SECRET = "c2VjcmV0LWtleS1zZW50aW5lbC1kby1ub3QtbGVhaw=="
ROW = "gameid,patch,champion\n42,16.20,RowSentinel"
LOCAL_PATH = "C:/Users/operator/private/outputs/oracles-elixir/raw"
URL = "https://provider.invalid/private-export.csv"
PREVIOUS = b'[{"previous": "manifest stays unchanged on failure"}]\n'


def _entry(content_hash=HASH_A, retrieved_at="2026-11-18T01:35:30.738564+00:00", size=1024):
    return {"content_hash": content_hash, "retrieved_at": retrieved_at, "byte_length": size}


def _report(snapshots, **outer):
    report = {
        "schema_version": "1",
        "artifact_type": "restored-private-oe-archive",
        "source_id": "oracles-elixir-match-data",
        "authenticated": True,
        "key_source": "ENVIRONMENT:OE_ARCHIVE_KEY",
        "snapshots": snapshots,
    }
    report.update(outer)
    return report


def _run(tmp_path, report_text, capsys):
    report = tmp_path / "restore-report.json"
    report.write_text(report_text, encoding="utf-8")
    output = tmp_path / "out" / "snapshot-manifest.json"
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(PREVIOUS)
    code = wpsm.main(["--report", str(report), "--output", str(output)])
    captured = capsys.readouterr()
    return code, output, captured.out + captured.err


# --------------------------------------------------------------------------- privacy whitelist


def test_outer_report_sentinels_never_leave_through_the_manifest(tmp_path, capsys):
    report = _report(
        [_entry()],
        snapshot_count=1,
        unique_content_count=1,
        encrypted_content_hash=HASH_B,
        archive_key=SECRET,
        raw_rows=ROW,
        player_name="PlayerSentinel",
        archive_dir=LOCAL_PATH,
        request_url=URL,
        request_attempt_ledger=[{"operation": "FETCH_PUBLISHED_CSV", "at": "2026-11-19"}],
    )
    code, output, printed = _run(tmp_path, json.dumps(report), capsys)

    assert code == 0
    manifest = json.loads(output.read_text(encoding="ascii"))
    assert manifest == [_entry()]
    assert all(list(item) == list(wpsm.APPROVED_FIELDS) for item in manifest)
    text = output.read_text(encoding="ascii") + printed
    for sentinel in (
        SECRET,
        "RowSentinel",
        "gameid",
        "PlayerSentinel",
        "operator",
        "provider.invalid",
        "FETCH_PUBLISHED_CSV",
        "2026-11-19",
        HASH_B,
        "OE_ARCHIVE_KEY",
        "restored-private-oe-archive",
        "authenticated",
    ):
        assert sentinel not in text


def test_real_restore_report_round_trips_to_exactly_its_three_field_entries(tmp_path, monkeypatch):
    source = tmp_path / "source"
    seed_archive(source)
    monkeypatch.setenv(
        "PMI_TEST_MANIFEST_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
    )
    encrypted = tmp_path / "history.pmi"
    pack_private_oe_archive(source, encrypted, key_environment_variable="PMI_TEST_MANIFEST_KEY")
    report = restore_private_oe_archive(
        encrypted, tmp_path / "restored", key_environment_variable="PMI_TEST_MANIFEST_KEY"
    )
    report_path = tmp_path / "restore-report.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    output = tmp_path / "snapshot-manifest.json"

    assert wpsm.main(["--report", str(report_path), "--output", str(output)]) == 0
    exported = json.loads(output.read_text(encoding="ascii"))
    assert exported == report["snapshots"]
    assert len(exported) == report["snapshot_count"] == 2
    assert isinstance(exported, list)


# --------------------------------------------------------------------------- ordering and receipts


def test_entries_sort_by_utc_time_then_hash_and_keep_distinct_receipts(tmp_path, capsys):
    snapshots = [
        _entry(HASH_A, "2026-11-18T01:35:30.738564+00:00", 2048),
        _entry(HASH_B, "2026-11-11T04:00:00Z", 4096),
        _entry(HASH_A, "2026-11-11T04:00:00+00:00", 2048),  # same content, earlier receipt
    ]
    report = _report(snapshots, snapshot_count=3, unique_content_count=2)
    code, output, _ = _run(tmp_path, json.dumps(report), capsys)

    assert code == 0
    assert json.loads(output.read_text(encoding="ascii")) == [
        _entry(HASH_A, "2026-11-11T04:00:00+00:00", 2048),
        _entry(HASH_B, "2026-11-11T04:00:00+00:00", 4096),
        _entry(HASH_A, "2026-11-18T01:35:30.738564+00:00", 2048),
    ]
    first = output.read_bytes()
    reordered = _report(list(reversed(snapshots)))
    code, output, _ = _run(tmp_path, json.dumps(reordered), capsys)
    assert code == 0
    assert output.read_bytes() == first


# --------------------------------------------------------------------------- fail closed


MALFORMED = {
    "not-json": "{not json",
    "not-object": json.dumps([_entry()]),
    "missing-list": json.dumps({"schema_version": "1", "archive_key": SECRET}),
    "list-not-array": json.dumps(_report({"0": _entry()})),
    "empty-list": json.dumps(_report([])),
    "entry-not-object": json.dumps(_report([SECRET])),
    "extra-key": json.dumps(_report([{**_entry(), "final_url": URL}])),
    "missing-key": json.dumps(_report([{"content_hash": HASH_A, "byte_length": 1}])),
    "hash-no-prefix": json.dumps(_report([_entry("a" * 64)])),
    "hash-uppercase": json.dumps(_report([_entry("sha256:" + "A" * 64)])),
    "hash-short": json.dumps(_report([_entry("sha256:" + "a" * 63)])),
    "hash-not-string": json.dumps(_report([_entry(12345)])),
    "time-naive": json.dumps(_report([_entry(retrieved_at="2026-11-18T01:35:30")])),
    "time-non-utc": json.dumps(_report([_entry(retrieved_at="2026-11-18T10:35:30+09:00")])),
    "time-invalid": json.dumps(_report([_entry(retrieved_at="2026-13-40T99:00:00+00:00")])),
    "time-not-string": json.dumps(_report([_entry(retrieved_at=1763429730)])),
    "size-bool": json.dumps(_report([_entry(size=True)])),
    "size-negative": json.dumps(_report([_entry(size=-1)])),
    "size-float": json.dumps(_report([_entry(size=1024.0)])),
    "size-string": json.dumps(_report([_entry(size="1024")])),
    "duplicate-receipt": json.dumps(_report([_entry(), _entry()])),
    "hash-two-lengths": json.dumps(
        _report([_entry(size=1), _entry(retrieved_at="2026-11-19T00:00:00+00:00", size=2)])
    ),
    "count-mismatch": json.dumps(_report([_entry()], snapshot_count=2)),
    "unique-mismatch": json.dumps(_report([_entry()], unique_content_count=2)),
    "count-bool": json.dumps(_report([_entry()], snapshot_count=True)),
    "duplicate-json-key": ('{"snapshots": [], "snapshots": ' + json.dumps([_entry()]) + "}"),
    "nan-constant": '{"snapshots": [{"content_hash": "'
    + HASH_A
    + '", "retrieved_at": "2026-11-18T01:35:30+00:00", "byte_length": NaN}]}',
}


@pytest.mark.parametrize("case", sorted(MALFORMED))
def test_malformed_metadata_fails_closed_without_overwrite_or_value_echo(tmp_path, capsys, case):
    code, output, printed = _run(tmp_path, MALFORMED[case], capsys)

    assert code == 1
    assert output.read_bytes() == PREVIOUS
    assert "snapshot manifest rejected:" in printed
    for sentinel in (SECRET, URL, "a" * 63, "+09:00", "1763429730"):
        assert sentinel not in printed
    leftovers = [p for p in output.parent.iterdir() if p.name != output.name]
    assert leftovers == []


def test_missing_report_and_same_path_output_are_refused(tmp_path, capsys):
    output = tmp_path / "snapshot-manifest.json"
    output.write_bytes(PREVIOUS)
    missing = tmp_path / "absent-report.json"
    assert wpsm.main(["--report", str(missing), "--output", str(output)]) == 1
    assert output.read_bytes() == PREVIOUS

    report = tmp_path / "restore-report.json"
    original = json.dumps(_report([_entry()])).encode("utf-8")
    report.write_bytes(original)
    assert wpsm.main(["--report", str(report), "--output", str(report)]) == 1
    alias = tmp_path / "." / "restore-report.json"
    assert wpsm.main(["--report", str(report), "--output", str(alias)]) == 1
    assert report.read_bytes() == original
    assert "output must not be the input report" in capsys.readouterr().err


def test_exporter_is_stdlib_only_and_cannot_fetch_data():
    tree = ast.parse((ROOT / "ops" / "write_private_snapshot_manifest.py").read_text("utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.add((node.module or "").split(".")[0])
    assert imported <= {
        "__future__",
        "argparse",
        "collections",
        "datetime",
        "json",
        "os",
        "pathlib",
        "re",
        "sys",
        "tempfile",
        "typing",
    }


# --------------------------------------------------------------------------- workflow routing


def test_generation_is_normal_mode_best_effort_and_needs_a_successful_restore():
    generator = step(GENERATOR)
    assert generator["id"] == "snapshot-manifest"
    assert generator["if"] == (
        "always() && env.HISTORY_ONLY != 'true' && steps.restore.outcome == 'success'"
    )
    assert "continue-on-error: true" in generator["block"]

    assert GENERATOR in simulate(False)
    assert GENERATOR not in simulate(True)
    # A failed restore stops the job before any manifest is written or state is repacked.
    failed_restore = simulate(False, failing=RESTORE)
    assert GENERATOR not in failed_restore
    assert REPACK not in failed_restore


def test_generation_failure_never_blocks_diagnostics_or_the_encrypted_backup():
    # e.g. an explicit fresh start has no restore report, so generation fails visibly.
    ran = simulate(False, failing=GENERATOR)
    for required in (GENERATOR, DIAGNOSTICS, REPACK, ARCHIVE_UPLOAD, RETENTION):
        assert required in ran
    rejected_sync = simulate(
        False, failing="Run policy-gated OE sync and fail-closed local health check"
    )
    assert GENERATOR in rejected_sync and DIAGNOSTICS in rejected_sync
    assert ARCHIVE_UPLOAD in rejected_sync

    archive_upload = step("archive-upload")["block"]
    assert "snapshot-manifest" not in archive_upload
    assert "if-no-files-found: error" in archive_upload
    assert "snapshot-manifest" not in step("Preserve history-only acquisition diagnostics")["block"]
