import csv
import io
import json
import os
import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from ops.audit_player_career_archive import audit_archive, main
from pro_meta_intelligence.ingestion.oe_download import OracleElixirPublishedDownloadAdapter
from pro_meta_intelligence.opponent.player_career import CORE
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceRegistry
from tests.test_player_career import archive, rows

# Inside the reviewed policy window (2026-11-03 + 30 days).
NOW = datetime(2026, 11, 18, tzinfo=UTC)
SOURCE = "oracles-elixir-match-data"
FILES = OracleElixirPublishedDownloadAdapter(SourceRegistry.load_default()).files


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def url(year):
    return f"https://drive.usercontent.google.com/download?id={FILES[year].file_id}"


def store(root, year, body: bytes, at=NOW):
    return SnapshotArchive(root).store(
        RawSourceArtifact.create(
            source_id=SOURCE,
            request_url=url(year),
            final_url=url(year),
            media_type="text/csv",
            retrieved_at=at,
            body=body,
        )
    )


def valid(year, data=None):
    return archive(
        data if data is not None else rows(year, date=f"{year}-06-01 12:00:00"), year=year
    )[0].encode()


def no_core(year):
    stream = io.StringIO()
    fields = [c for c in CORE if c != "champion"]
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows(year, date=f"{year}-06-01 12:00:00"))
    return stream.getvalue().encode()


def year_entry(report, year):
    return next(entry for entry in report["years"] if entry["season"] == year)


def audit(root, **kwargs):
    return audit_archive(root, cutoff=kwargs.pop("cutoff", NOW), **kwargs)


def test_empty_archive_is_not_downloaded_and_players_stay_unknown(tmp_path):
    report = audit(tmp_path, player_ids=("p1",))
    assert report["requested_years"] == list(range(2014, 2027))
    assert report["status_counts"] == {"NOT_DOWNLOADED": 13}
    assert all(
        e["players"] == [{"player_id": "p1", "status": "UNKNOWN_YEAR_NOT_USABLE", "games": None}]
        for e in report["years"]
    )
    assert report["network_collection_performed"] is False
    assert report["publication_permitted"] is False
    assert report["complete_coverage_claimed"] is False


def test_future_only_snapshot_is_not_available_and_does_not_leak(tmp_path):
    later = NOW + timedelta(days=1)
    stored = store(tmp_path, 2022, valid(2022), at=later)
    report = audit(tmp_path, years=(2022,))
    entry = year_entry(report, 2022)
    assert entry["status"] == "NOT_AVAILABLE_AT_CUTOFF"
    assert entry["archived_versions"] == 1 and entry["eligible_versions"] == 0
    text = json.dumps(report)
    assert stored.content_hash.removeprefix("sha256:") not in text
    assert later.isoformat() not in text


def test_valid_fixture_reports_provenance_and_known_unseen_unsupported_ids(tmp_path):
    body = valid(2022)
    stored = store(tmp_path, 2022, body)
    report = audit(tmp_path, years=(2022,), player_ids=("p1", "ghost", " p1"))
    entry = year_entry(report, 2022)
    assert entry["status"] == "USABLE"
    assert entry["sources"] == [
        {
            "source_id": SOURCE,
            "season": 2022,
            "content_hash": stored.content_hash.removeprefix("sha256:"),
            "retrieved_at": NOW.isoformat(),
        }
    ]
    assert entry["coverage"]["accepted_games"] == 1
    players = {p["player_id"]: p for p in entry["players"]}
    assert players["p1"]["status"] == "OBSERVED" and players["p1"]["games"] == 1
    assert players["p1"]["chapters"] == [{"team_id": "a", "role": "top", "games": 1}]
    assert players["ghost"]["status"] == "NOT_OBSERVED_UNKNOWN"
    assert players[" p1"]["status"] == "UNKNOWN_UNSUPPORTED_ID"
    text = json.dumps(report)
    assert "same name" not in text  # no name joins / raw rows
    assert "c1" not in text


def test_missing_core_is_invalid_even_next_to_a_valid_version(tmp_path):
    store(tmp_path, 2021, no_core(2021))
    assert year_entry(audit(tmp_path, years=(2021,)), 2021)["status"] == "INVALID_ARCHIVE"
    store(tmp_path, 2021, valid(2021), at=NOW - timedelta(hours=1))
    entry = year_entry(audit(tmp_path, years=(2021,), player_ids=("p1",)), 2021)
    assert entry["status"] == "INVALID_ARCHIVE"
    assert entry["reasons"] == ["MISSING_CORE_COLUMNS"]
    assert entry["players"][0]["status"] == "UNKNOWN_YEAR_NOT_USABLE"


def test_hash_failure_blocks_only_its_year(tmp_path):
    stored = store(tmp_path, 2022, valid(2022))
    store(tmp_path, 2021, valid(2021))
    stored.data_path.write_bytes(stored.data_path.read_bytes().replace(b"LCK", b"LPL"))
    report = audit(tmp_path, years=(2021, 2022))
    assert year_entry(report, 2022)["status"] == "BLOCKED_INTEGRITY"
    assert year_entry(report, 2022)["reasons"] == ["CONTENT_HASH_MISMATCH"]
    assert year_entry(report, 2021)["status"] == "USABLE"
    assert report["archive_integrity"]["unattributable_issues"] == []


def test_unattributable_integrity_issue_blocks_every_year(tmp_path):
    store(tmp_path, 2021, valid(2021))
    (tmp_path / SOURCE / "orphan.csv").write_bytes(b"x")
    report = audit(tmp_path, years=(2021, 2022))
    assert report["status_counts"] == {"BLOCKED_INTEGRITY": 2}
    assert report["archive_integrity"]["unattributable_issues"][0]["code"] == "ORPHAN_DATA_FILE"


def test_conflicting_versions_are_poisoned_not_latest_wins(tmp_path):
    first, second = rows(2022), rows(2022)
    second[0]["champion"] = "different"
    store(tmp_path, 2022, valid(2022, first), at=NOW - timedelta(hours=2))
    store(tmp_path, 2022, valid(2022, second), at=NOW - timedelta(hours=1))
    entry = year_entry(audit(tmp_path, years=(2022,), player_ids=("p1",)), 2022)
    assert entry["status"] == "NO_ACCEPTED_GAMES"
    assert entry["eligible_versions"] == 2 and len(entry["sources"]) == 2
    assert entry["coverage"]["rejection_counts"] == {"CONFLICTING_GAME": 1}
    assert entry["players"][0]["status"] == "UNKNOWN_YEAR_NOT_USABLE"


def test_partial_rejections_are_labelled_and_policy_expiry_fails_closed(tmp_path):
    good = rows(2023, game="g1", date="2023-06-01 12:00:00")
    bad = rows(2023, game="g2", date="2023-06-02 12:00:00")[:-1]  # incomplete participants
    store(tmp_path, 2023, valid(2023, good + bad))
    entry = year_entry(audit(tmp_path, years=(2023,)), 2023)
    assert entry["status"] == "USABLE_WITH_REJECTIONS"
    assert entry["reasons"] == ["INCOMPLETE_PARTICIPANTS"]
    expired = audit(tmp_path, years=(2023,), cutoff=datetime(2026, 12, 10, tzinfo=UTC))
    assert year_entry(expired, 2023)["status"] == "BLOCKED_POLICY"
    assert year_entry(expired, 2023)["reasons"] == ["POLICY_REVIEW_EXPIRED"]


def test_multiple_years_mixed_validity_are_independent_and_ordered(tmp_path):
    store(tmp_path, 2021, valid(2021))
    store(tmp_path, 2022, no_core(2022))
    store(tmp_path, 2023, valid(2023), at=NOW + timedelta(hours=1))
    report = audit(tmp_path, years=(2024, 2023, 2022, 2021, 2021), player_ids=("p6",))
    assert report["requested_years"] == [2021, 2022, 2023, 2024]
    assert [e["status"] for e in report["years"]] == [
        "USABLE",
        "INVALID_ARCHIVE",
        "NOT_AVAILABLE_AT_CUTOFF",
        "NOT_DOWNLOADED",
    ]
    assert year_entry(report, 2021)["players"][0]["status"] == "OBSERVED"
    assert audit(tmp_path, years=(2021, 2022, 2023, 2024), player_ids=("p6",)) == report


@pytest.mark.parametrize(
    "kwargs",
    [
        {"years": (2013,)},
        {"years": (2027,)},
        {"reference_patch": "latest"},
        {"reference_patch": ""},
        {"reference_season": 2013},
        {"reference_season": 2030},
        {"cutoff": datetime(2026, 11, 18)},
    ],
)
def test_invalid_inputs_are_rejected(tmp_path, kwargs):
    with pytest.raises(ValueError):
        audit(tmp_path, **kwargs)


def snapshot_tree(root):
    return sorted(
        (str(p.relative_to(root)), p.read_bytes() if p.is_file() else None) for p in root.rglob("*")
    )


def cli_args(archive_dir):
    return ["--archive-dir", str(archive_dir), "--cutoff", NOW.isoformat(), "--year", "2022"]


def test_cli_refuses_overwrite_and_naive_cutoff(tmp_path, capsys):
    archive_dir = tmp_path / "archive"
    archive_dir.mkdir()
    out = tmp_path / "reports" / "report.json"
    args = cli_args(archive_dir)
    assert main([*args, "--output", str(out)]) == 0
    first = out.read_bytes()
    with pytest.raises(SystemExit):
        main([*args, "--output", str(out)])
    assert out.read_bytes() == first
    with pytest.raises(SystemExit):
        main(["--archive-dir", str(archive_dir), "--cutoff", "2026-11-18T00:00:00"])
    with pytest.raises(SystemExit):
        main([*args, "--year", "2013"])
    assert list(archive_dir.iterdir()) == []  # archive untouched


def _inside_variants(tmp_path, archive_dir):
    outside = tmp_path / "elsewhere"
    outside.mkdir(exist_ok=True)
    return [
        archive_dir / "audit.json",
        archive_dir / SOURCE / "audit.json",  # inside the source directory itself
        archive_dir / "new" / "nested" / "audit.json",  # must not even mkdir
        outside / ".." / "archive" / "audit.json",  # normalized ".."
        archive_dir,  # the root itself
        *([Path(str(archive_dir).upper()) / "audit.json"] if os.name == "nt" else []),
    ]


def test_cli_rejects_output_inside_archive_before_any_write(tmp_path):
    archive_dir = tmp_path / "archive"
    store(archive_dir, 2022, valid(2022))
    before = snapshot_tree(archive_dir)
    for target in _inside_variants(tmp_path, archive_dir):
        with pytest.raises(SystemExit):
            main([*cli_args(archive_dir), "--output", str(target)])
        assert snapshot_tree(archive_dir) == before, target
    # A ".." archive-dir spelling is normalized too.
    spelled = tmp_path / "elsewhere" / ".." / "archive"
    with pytest.raises(SystemExit):
        main([*cli_args(spelled), "--output", str(archive_dir / "audit.json")])
    assert snapshot_tree(archive_dir) == before


def test_cli_rejects_output_through_symlink_into_archive(tmp_path):
    archive_dir = tmp_path / "archive"
    store(archive_dir, 2022, valid(2022))
    before = snapshot_tree(archive_dir)
    link = tmp_path / "link"
    try:
        link.symlink_to(archive_dir, target_is_directory=True)
    except (OSError, NotImplementedError):
        # Unprivileged Windows: a directory junction is the equivalent link.
        try:
            import _winapi

            _winapi.CreateJunction(str(archive_dir), str(link))
        except (ImportError, AttributeError, OSError):
            pytest.skip("neither symlink nor junction creation is permitted")
    for args in (
        [*cli_args(archive_dir), "--output", str(link / "audit.json")],
        [*cli_args(link), "--output", str(archive_dir / "audit.json")],
    ):
        with pytest.raises(SystemExit):
            main(args)
    assert snapshot_tree(archive_dir) == before


def test_cli_allows_sibling_with_shared_prefix(tmp_path):
    archive_dir = tmp_path / "archive"
    archive_dir.mkdir()
    out = tmp_path / "archive-reports" / "audit.json"  # prefix match only, not inside
    assert main([*cli_args(archive_dir), "--output", str(out)]) == 0
    assert out.is_file()
    assert list(archive_dir.iterdir()) == []
