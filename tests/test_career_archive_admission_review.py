"""Independent verification of the offline auditor's read-only boundary."""

import pytest

from ops.audit_player_career_archive import main


def test_report_output_cannot_write_inside_the_source_archive(tmp_path):
    archive = tmp_path / "archive"
    archive.mkdir()
    output = archive / "audit.json"
    with pytest.raises(SystemExit):
        main(
            [
                "--archive-dir",
                str(archive),
                "--year",
                "2022",
                "--cutoff",
                "2026-11-18T12:00:00+00:00",
                "--output",
                str(output),
            ]
        )
    assert not output.exists()
