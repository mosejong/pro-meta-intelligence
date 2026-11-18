"""Independent malformed-publication regression checks."""

from ops import player_career_archive as pca


def test_non_utf8_public_record_is_a_structured_block(tmp_path):
    record = tmp_path / "corrupt.json"
    record.write_bytes(b"\xff\xfe\x00")
    document, issue = pca.read_public_json(record)
    assert document is None
    assert issue in {"PUBLIC_RECORD_UNREADABLE", "PUBLIC_RECORD_INVALID_JSON"}
